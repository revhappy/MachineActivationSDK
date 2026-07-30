/**
 * Fetch a llama.cpp `llama-server` prebuilt for the host and vendor it where
 * {@link discoverLlamaServer} already looks: `vendor/llama-cpp/<slug>/`.
 *
 * Without this, installing the SDK into an app that already exists left no way
 * to obtain a backend at all — the runtime searched `vendor/llama-cpp/` and
 * nothing in the package ever populated it, so the only route was `--server` or
 * `MACHINE_LLAMA_SERVER`. That is exactly the manual step the SDK exists to
 * remove: "plug a local model into any app" cannot mean "first go find and build
 * an inference server".
 *
 * Deliberately **not** a `postinstall`. This downloads tens to hundreds of
 * megabytes; doing that silently during `npm install` breaks offline and CI
 * installs, is skipped entirely under `--ignore-scripts`, and is the reason
 * install-time network scripts are widely distrusted. It is one explicit
 * command, cached and idempotent.
 *
 * We do not couple to node-llama-cpp's npm release cadence either: when a new
 * model architecture lands upstream, re-running this picks up the next prebuilt.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
  createWriteStream,
} from 'node:fs';
import { get as httpsGet, request as httpsRequest } from 'node:https';
import { join as pathJoin } from 'node:path';

import type { ActivationAccelerationMode } from '../activation/activationContract';

const REPO = 'ggml-org/llama.cpp';
const USER_AGENT = 'machineai-activation';

/** A prebuilt archive we know how to pick for a given host. */
export interface LlamaServerTarget {
  /** Directory name under `vendor/llama-cpp/`, matching `discoverLlamaServer`. */
  slug: string;
  /** Matches the release asset for this host. */
  pattern: RegExp;
  exe: string;
  /**
   * What the vendored build can do, reported to the activation contract. macOS
   * prebuilts ship with Metal; the rest are CPU unless overridden via asset.
   */
  acceleration: ActivationAccelerationMode;
}

const HOST_TARGETS: Record<string, LlamaServerTarget> = {
  'win32:x64': {
    slug: 'win-x64',
    pattern: /^llama-b(\d+)-bin-win-cpu-x64\.zip$/,
    exe: 'llama-server.exe',
    acceleration: 'cpu',
  },
  'darwin:arm64': {
    slug: 'macos-arm64',
    pattern: /^llama-b(\d+)-bin-macos-arm64\.zip$/,
    exe: 'llama-server',
    acceleration: 'gpu',
  },
  'darwin:x64': {
    slug: 'macos-x64',
    pattern: /^llama-b(\d+)-bin-macos-x64\.zip$/,
    exe: 'llama-server',
    acceleration: 'gpu',
  },
  'linux:x64': {
    slug: 'linux-x64',
    pattern: /^llama-b(\d+)-bin-ubuntu-x64\.zip$/,
    exe: 'llama-server',
    acceleration: 'cpu',
  },
};

export function supportedLlamaHosts(): string[] {
  return Object.keys(HOST_TARGETS);
}

/**
 * The target for a host, with an optional asset-regex override.
 *
 * The override is how you get an accelerated build instead of the default —
 * `LLAMA_CPP_ASSET='llama-b\d+-bin-win-cuda-12.4-x64.zip'`. An overridden asset
 * is reported as `gpu`: the caller asked for a specific build and the contract
 * should not keep claiming CPU.
 */
export function resolveLlamaTarget(
  platform: string = process.platform,
  arch: string = process.arch,
  assetOverride?: string,
): LlamaServerTarget & { overridden: boolean } {
  const target = HOST_TARGETS[`${platform}:${arch}`];
  if (!target) {
    throw new Error(
      `Unsupported host ${platform}/${arch}. Supported: ${supportedLlamaHosts().join(', ')}.\n` +
        `You can still use a llama-server you built yourself: put it at ` +
        `vendor/llama-cpp/<slug>/, or set MACHINE_LLAMA_SERVER to its path.`,
    );
  }
  if (assetOverride) {
    return {
      ...target,
      pattern: new RegExp(assetOverride),
      acceleration: 'gpu',
      overridden: true,
    };
  }
  return { ...target, overridden: false };
}

export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface ReleaseInfo {
  tag_name: string;
  assets: ReleaseAsset[];
}

export interface FetchLlamaServerOptions {
  /** Project root that will hold `vendor/`. Defaults to `process.cwd()`. */
  rootDir?: string;
  /** Asset-name regex override. Defaults to `$LLAMA_CPP_ASSET`. */
  asset?: string;
  /** Re-download even when the cached build already matches. */
  force?: boolean;
  onLog?: (line: string) => void;
  /** Seams for tests; the defaults hit the network. */
  fetchRelease?: () => Promise<ReleaseInfo>;
  download?: (url: string, destination: string) => Promise<void>;
}

export interface FetchLlamaServerResult {
  binary: string;
  slug: string;
  build: string;
  tag: string;
  asset: string;
  acceleration: ActivationAccelerationMode;
  /** True when the cached build already matched and nothing was downloaded. */
  cached: boolean;
}

export async function fetchLlamaServer(
  options: FetchLlamaServerOptions = {},
): Promise<FetchLlamaServerResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const log = options.onLog ?? (() => undefined);
  const target = resolveLlamaTarget(
    process.platform,
    process.arch,
    options.asset ?? process.env.LLAMA_CPP_ASSET,
  );

  const llamaDir = pathJoin(rootDir, 'vendor', 'llama-cpp');
  const vendorDir = pathJoin(llamaDir, target.slug);
  const binary = pathJoin(vendorDir, target.exe);

  log(
    `host ${process.platform}/${process.arch} → ${target.slug}` +
      (target.overridden ? ' (asset override)' : ''),
  );

  const release = await (options.fetchRelease ?? fetchLatestRelease)();
  const asset = release.assets.find((candidate) => target.pattern.test(candidate.name));
  if (!asset) {
    throw new Error(
      `No asset matching ${target.pattern} in release ${release.tag_name}.\n` +
        `Available:\n  ${release.assets.map((a) => a.name).join('\n  ')}\n` +
        `Set LLAMA_CPP_ASSET (or --asset) to a regex matching one of these.`,
    );
  }

  const buildMatch = /-b(\d+)-/.exec(asset.name);
  const build = buildMatch ? `b${buildMatch[1]}` : release.tag_name;
  const metadata = {
    build,
    tag: release.tag_name,
    asset: asset.name,
    platform: target.slug,
    exe: target.exe,
    acceleration: target.acceleration,
    downloadedAt: new Date().toISOString(),
  };

  if (!options.force && readCachedBuild(vendorDir) === build && existsSync(binary)) {
    log(`up to date (${build}); nothing to download`);
    return {
      binary,
      slug: target.slug,
      build,
      tag: release.tag_name,
      asset: asset.name,
      acceleration: target.acceleration,
      cached: true,
    };
  }

  mkdirSync(llamaDir, { recursive: true });
  const archive = pathJoin(llamaDir, '_download.zip');
  log(`downloading ${asset.name} (${formatBytes(asset.size)})`);
  await (options.download ?? downloadFile)(asset.browser_download_url, archive);

  log('extracting');
  emptyDir(vendorDir);
  try {
    extractZip(archive, vendorDir);
    flattenIfNested(vendorDir, target.exe);
    makeExecutable(vendorDir);
  } finally {
    rmSync(archive, { force: true });
  }

  if (!existsSync(binary)) {
    throw new Error(
      `Extraction finished but ${target.exe} is not at ${binary}.\n` +
        `Contents: ${readdirSync(vendorDir).join(', ') || '(empty)'}`,
    );
  }

  const serialised = `${JSON.stringify(metadata, null, 2)}\n`;
  // Per-slug is authoritative; the sibling copy is the path
  // `readVendoredAcceleration` checks first and predates this command.
  writeFileSync(pathJoin(vendorDir, 'version.json'), serialised);
  writeFileSync(pathJoin(llamaDir, 'version.json'), serialised);

  log(`vendored llama.cpp ${build} → ${vendorDir}`);
  return {
    binary,
    slug: target.slug,
    build,
    tag: release.tag_name,
    asset: asset.name,
    acceleration: target.acceleration,
    cached: false,
  };
}

function readCachedBuild(vendorDir: string): string | null {
  for (const candidate of [
    pathJoin(vendorDir, 'version.json'),
    pathJoin(vendorDir, '..', 'version.json'),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
        build?: string;
        platform?: string;
      };
      // A sibling version.json may describe a different host in a tree that has
      // been used cross-platform; only trust it when the platform agrees.
      const sameSlug =
        parsed.platform === undefined || vendorDir.endsWith(parsed.platform);
      if (typeof parsed.build === 'string' && sameSlug) return parsed.build;
    } catch {
      /* try the next location */
    }
  }
  return null;
}

function fetchLatestRelease(): Promise<ReleaseInfo> {
  return fetchJson<ReleaseInfo>(`https://api.github.com/repos/${REPO}/releases/latest`);
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = httpsRequest(
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } },
      (response) => {
        const { statusCode, headers } = response;
        if ((statusCode === 301 || statusCode === 302) && headers.location) {
          fetchJson<T>(headers.location).then(resolve, reject);
          return;
        }
        if (statusCode !== 200) {
          reject(new Error(`HTTP ${statusCode} for ${url}`));
          response.resume();
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function downloadFile(url: string, destination: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const follow = (current: string, redirects: number): void => {
      if (redirects > 5) {
        reject(new Error(`Too many redirects downloading ${url}`));
        return;
      }
      httpsGet(current, { headers: { 'User-Agent': USER_AGENT } }, (response) => {
        const { statusCode, headers } = response;
        if ((statusCode === 301 || statusCode === 302) && headers.location) {
          response.resume();
          follow(headers.location, redirects + 1);
          return;
        }
        if (statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${statusCode} downloading ${current}`));
          return;
        }
        const file = createWriteStream(destination);
        response.pipe(file);
        file.on('error', reject);
        file.on('finish', () => file.close(() => resolve()));
      }).on('error', reject);
    };
    follow(url, 0);
  });
}

function emptyDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

/**
 * Node has no zip reader, so use what the host already provides. Windows:
 * PowerShell's Expand-Archive. POSIX: `unzip`, falling back to macOS `ditto`.
 */
function extractZip(archive: string, destination: string): void {
  // Output is captured rather than inherited: on failure the extractor's own
  // complaint belongs inside our error, not scattered above it.
  if (process.platform === 'win32') {
    // -LiteralPath, because a path containing [brackets] is a wildcard to -Path.
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -Force -LiteralPath $env:MACHINE_ZIP -DestinationPath $env:MACHINE_DEST',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, MACHINE_ZIP: archive, MACHINE_DEST: destination },
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `Could not extract ${archive} (Expand-Archive exit ${result.status ?? 'signal'}).` +
          detail(result.stderr || result.stdout),
      );
    }
    return;
  }

  const unzip = spawnSync('unzip', ['-o', '-q', archive, '-d', destination], {
    encoding: 'utf8',
  });
  if (unzip.status === 0) return;

  if (process.platform === 'darwin') {
    const ditto = spawnSync('ditto', ['-x', '-k', archive, destination], { encoding: 'utf8' });
    if (ditto.status === 0) return;
    throw new Error(`Could not extract ${archive}.${detail(ditto.stderr)}`);
  }

  throw new Error(
    `Could not extract ${archive}. Install \`unzip\` ` +
      `(Debian/Ubuntu: sudo apt install unzip; Fedora: sudo dnf install unzip) and retry.` +
      detail(unzip.stderr),
  );
}

function detail(output: string | undefined): string {
  const text = (output ?? '').trim();
  return text ? `\n  ${text.split('\n').slice(0, 4).join('\n  ')}` : '';
}

/** llama.cpp archives sometimes nest everything under `build/bin/`. */
function flattenIfNested(dir: string, exe: string): void {
  if (existsSync(pathJoin(dir, exe))) return;

  const lift = (from: string): void => {
    for (const entry of readdirSync(from)) {
      renameSync(pathJoin(from, entry), pathJoin(dir, entry));
    }
  };

  for (const entry of readdirSync(dir)) {
    const inner = pathJoin(dir, entry);
    if (!statSync(inner).isDirectory()) continue;
    if (existsSync(pathJoin(inner, exe))) {
      lift(inner);
      rmSync(inner, { recursive: true, force: true });
      return;
    }
    for (const sub of readdirSync(inner)) {
      const deep = pathJoin(inner, sub);
      if (statSync(deep).isDirectory() && existsSync(pathJoin(deep, exe))) {
        lift(deep);
        rmSync(inner, { recursive: true, force: true });
        return;
      }
    }
  }
}

/** Some extraction paths drop the executable bit. */
function makeExecutable(dir: string): void {
  if (process.platform === 'win32') return;
  for (const entry of readdirSync(dir)) {
    const full = pathJoin(dir, entry);
    try {
      if (statSync(full).isFile()) chmodSync(full, 0o755);
    } catch {
      /* best-effort */
    }
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
