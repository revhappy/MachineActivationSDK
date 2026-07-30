import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';

import {
  fetchLlamaServer,
  resolveLlamaTarget,
  supportedLlamaHosts,
  type ReleaseInfo,
} from '../../src/runtime/fetchLlamaServer';
import { discoverLlamaServer } from '../../src/runtime/nodeLlamaServer';
import { test } from '../_harness';

function release(...names: string[]): ReleaseInfo {
  return {
    tag_name: 'b7291',
    assets: names.map((name) => ({
      name,
      size: 1024,
      browser_download_url: `https://example.invalid/${name}`,
    })),
  };
}

const WIN_ASSET = 'llama-b7291-bin-win-cpu-x64.zip';
const MAC_ASSET = 'llama-b7291-bin-macos-arm64.zip';
const LINUX_ASSET = 'llama-b7291-bin-ubuntu-x64.zip';

function tempRoot(): string {
  // A space in the path: the same class of bug that broke the Python launcher.
  const base = mkdtempSync(pathJoin(tmpdir(), 'machine-fetch-'));
  const root = pathJoin(base, 'My App');
  mkdirSync(root, { recursive: true });
  return root;
}

test('resolveLlamaTarget picks the right asset pattern per host', () => {
  assert.equal(resolveLlamaTarget('win32', 'x64').slug, 'win-x64');
  assert.ok(resolveLlamaTarget('win32', 'x64').pattern.test(WIN_ASSET));
  assert.equal(resolveLlamaTarget('win32', 'x64').exe, 'llama-server.exe');

  assert.equal(resolveLlamaTarget('darwin', 'arm64').slug, 'macos-arm64');
  assert.ok(resolveLlamaTarget('darwin', 'arm64').pattern.test(MAC_ASSET));
  // macOS prebuilts ship Metal, so the contract should not claim CPU.
  assert.equal(resolveLlamaTarget('darwin', 'arm64').acceleration, 'gpu');

  assert.ok(resolveLlamaTarget('linux', 'x64').pattern.test(LINUX_ASSET));
  assert.equal(resolveLlamaTarget('linux', 'x64').exe, 'llama-server');

  // Every advertised host must actually resolve.
  for (const host of supportedLlamaHosts()) {
    const [platform, arch] = host.split(':');
    assert.ok(resolveLlamaTarget(platform, arch).slug, host);
  }
});

test('an unsupported host explains the manual route instead of throwing bare', () => {
  assert.throws(
    () => resolveLlamaTarget('sunos', 'sparc'),
    (error: Error) => {
      assert.match(error.message, /Unsupported host sunos\/sparc/);
      assert.match(error.message, /MACHINE_LLAMA_SERVER/);
      return true;
    },
  );
});

test('an asset override selects an accelerated build and reports gpu', () => {
  const target = resolveLlamaTarget(
    'win32',
    'x64',
    String.raw`llama-b\d+-bin-win-cuda-12\.4-x64\.zip`,
  );
  assert.ok(target.overridden);
  assert.ok(target.pattern.test('llama-b7291-bin-win-cuda-12.4-x64.zip'));
  assert.ok(!target.pattern.test(WIN_ASSET));
  assert.equal(target.acceleration, 'gpu');
});

test('a release with no matching asset lists what was available', async () => {
  await assert.rejects(
    fetchLlamaServer({
      rootDir: tempRoot(),
      fetchRelease: () => Promise.resolve(release('llama-b7291-bin-android-arm64.zip')),
      download: () => Promise.reject(new Error('should not download')),
    }),
    (error: Error) => {
      assert.match(error.message, /No asset matching/);
      assert.match(error.message, /llama-b7291-bin-android-arm64\.zip/);
      assert.match(error.message, /LLAMA_CPP_ASSET/);
      return true;
    },
  );
});

test('a cached build is not downloaded again, and force overrides that', async () => {
  const root = tempRoot();
  const target = resolveLlamaTarget();
  const vendorDir = pathJoin(root, 'vendor', 'llama-cpp', target.slug);
  mkdirSync(vendorDir, { recursive: true });
  // Pretend a previous run left build b7291 in place.
  writeFileSync(pathJoin(vendorDir, target.exe), '');
  writeFileSync(
    pathJoin(vendorDir, 'version.json'),
    JSON.stringify({ build: 'b7291', platform: target.slug }),
  );

  const hostAsset = `llama-b7291-bin-${target.slug === 'win-x64' ? 'win-cpu-x64' : target.slug === 'linux-x64' ? 'ubuntu-x64' : target.slug}.zip`;
  let downloads = 0;
  const options = {
    rootDir: root,
    fetchRelease: () => Promise.resolve(release(hostAsset)),
    download: () => {
      downloads += 1;
      return Promise.reject(new Error('download attempted'));
    },
  };

  const result = await fetchLlamaServer(options);
  assert.equal(result.cached, true);
  assert.equal(result.build, 'b7291');
  assert.equal(downloads, 0, 'a current cache must not re-download');

  // --force must actually try, even though the cache is current.
  await assert.rejects(fetchLlamaServer({ ...options, force: true }), /download attempted/);
  assert.equal(downloads, 1);
});

test('a version.json from another platform does not satisfy the cache', async () => {
  const root = tempRoot();
  const target = resolveLlamaTarget();
  const vendorDir = pathJoin(root, 'vendor', 'llama-cpp', target.slug);
  mkdirSync(vendorDir, { recursive: true });
  writeFileSync(pathJoin(vendorDir, target.exe), '');
  // Only a shared sibling file exists, and it describes a different host - a
  // tree that has been used cross-platform must not skip the download.
  writeFileSync(
    pathJoin(root, 'vendor', 'llama-cpp', 'version.json'),
    JSON.stringify({ build: 'b7291', platform: 'some-other-host' }),
  );

  await assert.rejects(
    fetchLlamaServer({
      rootDir: root,
      fetchRelease: () => Promise.resolve(release(`llama-b7291-bin-win-cpu-x64.zip`)),
      download: () => Promise.reject(new Error('download attempted')),
    }),
    // Either it tried to download (correct) or the host has no win-x64 target;
    // both beat silently trusting another platform's metadata.
    (error: Error) => /download attempted|No asset matching/.test(error.message),
  );
});

test('the vendored layout is exactly where discoverLlamaServer looks', () => {
  // Guards the contract between this fetcher and the runtime: if either side
  // changes its path convention, the binary becomes invisible.
  const root = tempRoot();
  const target = resolveLlamaTarget();
  const vendorDir = pathJoin(root, 'vendor', 'llama-cpp', target.slug);
  mkdirSync(vendorDir, { recursive: true });
  const binary = pathJoin(vendorDir, target.exe);
  writeFileSync(binary, '');

  const previous = process.env.MACHINE_LLAMA_SERVER;
  delete process.env.MACHINE_LLAMA_SERVER;
  try {
    assert.equal(discoverLlamaServer(root), binary);
  } finally {
    if (previous !== undefined) process.env.MACHINE_LLAMA_SERVER = previous;
  }
});

test('version.json records what the activation contract needs', async () => {
  const root = tempRoot();
  const target = resolveLlamaTarget();
  const vendorDir = pathJoin(root, 'vendor', 'llama-cpp', target.slug);

  // Stand in for a real download+extract: drop the binary where extraction would.
  const hostAsset = `llama-b7291-bin-${target.slug === 'win-x64' ? 'win-cpu-x64' : target.slug === 'linux-x64' ? 'ubuntu-x64' : target.slug}.zip`;
  await assert.rejects(
    fetchLlamaServer({
      rootDir: root,
      fetchRelease: () => Promise.resolve(release(hostAsset)),
      download: (_url, destination) => {
        writeFileSync(destination, 'not-a-zip');
        return Promise.resolve();
      },
    }),
    // Extraction of a bogus archive must fail loudly rather than leave a broken
    // vendor dir that later reports "ready".
    (error: Error) => error instanceof Error,
  );
  // And it must not have written a version.json claiming success.
  assert.throws(() => readFileSync(pathJoin(vendorDir, 'version.json'), 'utf8'));
});
