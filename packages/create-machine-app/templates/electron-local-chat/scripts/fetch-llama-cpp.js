// Downloads the latest llama.cpp Windows x64 CPU prebuilt zip from GitHub
// releases and extracts it into vendor/llama-cpp/win-x64/. Idempotent — skips
// download if the cached version matches the latest tag. Records the build
// number in vendor/llama-cpp/version.json so the runtime can log which
// llama.cpp build is in use.
//
// We deliberately do NOT couple the app to node-llama-cpp's npm release
// cadence. Whenever a new model architecture lands upstream in llama.cpp,
// re-running the package script picks up the next prebuilt and ships it.

const fs = require('node:fs');
const path = require('node:path');
const { execSync, spawnSync } = require('node:child_process');
const https = require('node:https');

const REPO = 'ggml-org/llama.cpp';
const PLATFORM_ASSET_PATTERN = /^llama-b(\d+)-bin-win-cpu-x64\.zip$/;
const ROOT = path.join(__dirname, '..');
const VENDOR_DIR = path.join(ROOT, 'vendor', 'llama-cpp', 'win-x64');
const VERSION_FILE = path.join(ROOT, 'vendor', 'llama-cpp', 'version.json');
const TMP_ZIP = path.join(ROOT, 'vendor', 'llama-cpp', '_download.zip');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        headers: {
          'User-Agent': 'second-brain-activation-sdk-build',
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
          {
            headers: { 'User-Agent': 'second-brain-activation-sdk-build' },
          },
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
    const raw = fs.readFileSync(VERSION_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed.build === 'string' ? parsed.build : null;
  } catch {
    return null;
  }
}

function ensureDirEmpty(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  console.log('[fetch-llama-cpp] looking up latest release…');
  const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  const tag = release.tag_name;
  console.log(`[fetch-llama-cpp] latest tag: ${tag}`);

  const asset = release.assets.find((a) => PLATFORM_ASSET_PATTERN.test(a.name));
  if (!asset) {
    throw new Error(
      `No Windows x64 CPU asset found in release ${tag}. ` +
        `Available: ${release.assets.map((a) => a.name).join(', ')}`,
    );
  }
  const buildMatch = PLATFORM_ASSET_PATTERN.exec(asset.name);
  const build = buildMatch ? `b${buildMatch[1]}` : tag;

  const cached = readCachedBuild();
  const serverExe = path.join(VENDOR_DIR, 'llama-server.exe');
  if (cached === build && fs.existsSync(serverExe)) {
    console.log(`[fetch-llama-cpp] up-to-date (${build}); skipping download.`);
    return;
  }

  fs.mkdirSync(path.dirname(TMP_ZIP), { recursive: true });
  console.log(`[fetch-llama-cpp] downloading ${asset.name} (${asset.size} bytes)…`);
  await downloadFile(asset.browser_download_url, TMP_ZIP);
  console.log('[fetch-llama-cpp] download complete; extracting…');

  ensureDirEmpty(VENDOR_DIR);

  // PowerShell's Expand-Archive ships with Windows; no extra dep needed.
  const ps = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -Force -Path '${TMP_ZIP}' -DestinationPath '${VENDOR_DIR}'`,
    ],
    { stdio: 'inherit' },
  );
  if (ps.status !== 0) {
    throw new Error(`Expand-Archive failed (exit ${ps.status})`);
  }

  // Some llama.cpp zips put files in a nested directory; flatten if needed.
  const top = fs.readdirSync(VENDOR_DIR);
  if (top.length === 1) {
    const inner = path.join(VENDOR_DIR, top[0]);
    if (fs.statSync(inner).isDirectory()) {
      for (const entry of fs.readdirSync(inner)) {
        fs.renameSync(path.join(inner, entry), path.join(VENDOR_DIR, entry));
      }
      fs.rmdirSync(inner);
    }
  }

  fs.rmSync(TMP_ZIP, { force: true });
  fs.writeFileSync(
    VERSION_FILE,
    JSON.stringify({ build, tag, downloadedAt: new Date().toISOString() }, null, 2),
  );

  if (!fs.existsSync(serverExe)) {
    throw new Error(
      `Extraction succeeded but llama-server.exe was not found at ${serverExe}. ` +
        `Vendor dir contents: ${fs.readdirSync(VENDOR_DIR).join(', ')}`,
    );
  }
  console.log(`[fetch-llama-cpp] vendored llama.cpp ${build} → ${VENDOR_DIR}`);
}

main().catch((err) => {
  console.error('[fetch-llama-cpp] FAILED:', err);
  process.exit(1);
});
