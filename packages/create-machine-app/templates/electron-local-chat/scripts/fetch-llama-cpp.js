// Downloads the latest llama.cpp prebuilt binary for the HOST platform from
// GitHub releases and extracts it into vendor/llama-cpp/<platform-slug>/.
// Idempotent — skips download if the cached version matches the latest tag.
// Records the build number in vendor/llama-cpp/version.json so the runtime can
// log which llama.cpp build is in use.
//
// We deliberately do NOT couple the app to node-llama-cpp's npm release
// cadence. Whenever a new model architecture lands upstream in llama.cpp,
// re-running the package script picks up the next prebuilt and ships it.
//
// Supported hosts: Windows x64, macOS arm64/x64, Linux x64.
// To vendor an accelerated build instead of the CPU/default one, set
// LLAMA_CPP_ASSET to a full asset name or a regex, e.g.
//   LLAMA_CPP_ASSET='llama-b\d+-bin-win-cuda-12.4-x64.zip' npm run fetch:llama

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const https = require('node:https');

const REPO = 'ggml-org/llama.cpp';
const ROOT = path.join(__dirname, '..');
const LLAMA_DIR = path.join(ROOT, 'vendor', 'llama-cpp');
const VERSION_FILE = path.join(LLAMA_DIR, 'version.json');
const TMP_ZIP = path.join(LLAMA_DIR, '_download.zip');

// Per-host asset selection. `accel` is what we report to the activation
// contract as the acceleration mode the vendored build is capable of —
// macOS prebuilts ship with Metal, the rest are CPU unless overridden.
const HOST_TARGETS = {
  'win32:x64': {
    slug: 'win-x64',
    pattern: /^llama-b(\d+)-bin-win-cpu-x64\.zip$/,
    exe: 'llama-server.exe',
    accel: 'cpu',
  },
  'darwin:arm64': {
    slug: 'macos-arm64',
    pattern: /^llama-b(\d+)-bin-macos-arm64\.zip$/,
    exe: 'llama-server',
    accel: 'gpu',
  },
  'darwin:x64': {
    slug: 'macos-x64',
    pattern: /^llama-b(\d+)-bin-macos-x64\.zip$/,
    exe: 'llama-server',
    accel: 'gpu',
  },
  'linux:x64': {
    slug: 'linux-x64',
    pattern: /^llama-b(\d+)-bin-ubuntu-x64\.zip$/,
    exe: 'llama-server',
    accel: 'cpu',
  },
};

function resolveTarget() {
  const key = `${process.platform}:${process.arch}`;
  const target = HOST_TARGETS[key];
  if (!target) {
    throw new Error(
      `Unsupported host ${key}. Supported: ${Object.keys(HOST_TARGETS).join(', ')}. ` +
        `You can still point the app at a llama-server binary you built yourself by ` +
        `placing it in vendor/llama-cpp/<slug>/.`,
    );
  }
  const override = process.env.LLAMA_CPP_ASSET;
  if (override) {
    return { ...target, pattern: new RegExp(override), overridden: true };
  }
  return { ...target, overridden: false };
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        headers: {
          'User-Agent': 'machineai-activation-build',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          fetchJson(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const follow = (currentUrl) => {
      https
        .get(
          currentUrl,
          { headers: { 'User-Agent': 'machineai-activation-build' } },
          (res) => {
            if (
              (res.statusCode === 301 || res.statusCode === 302) &&
              res.headers.location
            ) {
              follow(res.headers.location);
              return;
            }
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode} downloading ${currentUrl}`));
              return;
            }
            res.pipe(file);
            file.on('finish', () => file.close(() => resolve()));
          },
        )
        .on('error', reject);
    };
    follow(url);
  });
}

function readCachedBuild() {
  try {
    const parsed = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    return typeof parsed.build === 'string' ? parsed.build : null;
  } catch {
    return null;
  }
}

function ensureDirEmpty(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

// Node has no built-in zip reader, so shell out to whatever the host provides.
// Windows: PowerShell's Expand-Archive. POSIX: unzip, falling back to macOS ditto.
function extractZip(zipPath, destDir) {
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'`,
      ],
      { stdio: 'inherit' },
    );
    if (ps.status !== 0) throw new Error(`Expand-Archive failed (exit ${ps.status})`);
    return;
  }

  const unzip = spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], {
    stdio: 'inherit',
  });
  if (unzip.status === 0) return;

  if (process.platform === 'darwin') {
    const ditto = spawnSync('ditto', ['-x', '-k', zipPath, destDir], { stdio: 'inherit' });
    if (ditto.status === 0) return;
  }

  throw new Error(
    `Could not extract ${zipPath}. Install \`unzip\` (macOS: preinstalled; ` +
      `Debian/Ubuntu: \`sudo apt install unzip\`; Fedora: \`sudo dnf install unzip\`) and retry.`,
  );
}

// llama.cpp zips sometimes nest everything under a single top-level directory
// (e.g. build/bin/). Flatten so the binary always lands at <vendorDir>/<exe>.
function flattenIfNested(dir, exeName) {
  if (fs.existsSync(path.join(dir, exeName))) return;
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const inner = path.join(dir, entry);
    if (!fs.statSync(inner).isDirectory()) continue;
    if (fs.existsSync(path.join(inner, exeName))) {
      for (const nested of fs.readdirSync(inner)) {
        fs.renameSync(path.join(inner, nested), path.join(dir, nested));
      }
      fs.rmSync(inner, { recursive: true, force: true });
      return;
    }
    // One more level — some builds use build/bin/.
    for (const sub of fs.readdirSync(inner)) {
      const deep = path.join(inner, sub);
      if (fs.statSync(deep).isDirectory() && fs.existsSync(path.join(deep, exeName))) {
        for (const nested of fs.readdirSync(deep)) {
          fs.renameSync(path.join(deep, nested), path.join(dir, nested));
        }
        fs.rmSync(inner, { recursive: true, force: true });
        return;
      }
    }
  }
}

// Prebuilt archives lose the executable bit on some extraction paths.
function makeExecutable(dir) {
  if (process.platform === 'win32') return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    try {
      if (fs.statSync(full).isFile()) fs.chmodSync(full, 0o755);
    } catch {
      /* best-effort */
    }
  }
}

async function main() {
  const target = resolveTarget();
  const vendorDir = path.join(LLAMA_DIR, target.slug);
  const serverBin = path.join(vendorDir, target.exe);

  console.log(
    `[fetch-llama-cpp] host ${process.platform}/${process.arch} → ${target.slug}` +
      (target.overridden ? ' (LLAMA_CPP_ASSET override)' : ''),
  );
  console.log('[fetch-llama-cpp] looking up latest release…');

  const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  const tag = release.tag_name;
  console.log(`[fetch-llama-cpp] latest tag: ${tag}`);

  const asset = release.assets.find((a) => target.pattern.test(a.name));
  if (!asset) {
    throw new Error(
      `No asset matching ${target.pattern} found in release ${tag}.\n` +
        `Available assets:\n  ${release.assets.map((a) => a.name).join('\n  ')}\n` +
        `Set LLAMA_CPP_ASSET to a regex matching one of the above to override.`,
    );
  }

  const buildMatch = /-b(\d+)-/.exec(asset.name);
  const build = buildMatch ? `b${buildMatch[1]}` : tag;

  if (readCachedBuild() === build && fs.existsSync(serverBin)) {
    console.log(`[fetch-llama-cpp] up-to-date (${build}); skipping download.`);
    return;
  }

  fs.mkdirSync(LLAMA_DIR, { recursive: true });
  console.log(`[fetch-llama-cpp] downloading ${asset.name} (${asset.size} bytes)…`);
  await downloadFile(asset.browser_download_url, TMP_ZIP);
  console.log('[fetch-llama-cpp] download complete; extracting…');

  ensureDirEmpty(vendorDir);
  extractZip(TMP_ZIP, vendorDir);
  flattenIfNested(vendorDir, target.exe);
  makeExecutable(vendorDir);

  fs.rmSync(TMP_ZIP, { force: true });
  fs.writeFileSync(
    VERSION_FILE,
    JSON.stringify(
      {
        build,
        tag,
        asset: asset.name,
        platform: target.slug,
        exe: target.exe,
        acceleration: target.accel,
        downloadedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  if (!fs.existsSync(serverBin)) {
    throw new Error(
      `Extraction succeeded but ${target.exe} was not found at ${serverBin}. ` +
        `Vendor dir contents: ${fs.readdirSync(vendorDir).join(', ')}`,
    );
  }
  console.log(`[fetch-llama-cpp] vendored llama.cpp ${build} → ${vendorDir}`);
}

main().catch((err) => {
  console.error('[fetch-llama-cpp] FAILED:', err);
  process.exit(1);
});
