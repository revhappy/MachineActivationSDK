import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';

import {
  CartridgeResolveError,
  type CatalogFetcher,
  type DownloadFetcher,
  type DownloadResponse,
} from '../../src/catalog';
import { createNodeCartridgeCache } from '../../src/catalog/nodeCartridgeCache';
import { createNodeCartridgeResolver } from '../../src/catalog/nodeCartridgeResolver';
import { createNodeCartridgeZipAdapter } from '../../src/cartridge/nodeZip';
import { packCartridge } from '../../src/cartridge/nodePackCartridge';
import { createCartridgeFixture } from '../cartridge/_fixtures';
import { test } from '../_harness';
import { sampleCatalog, sampleEntry } from './_fixtures';

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'mcart-resolver-test-'));
  return Promise.resolve(fn(dir)).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

function bytesResponse(bytes: Uint8Array): DownloadResponse {
  let sent = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (sent) return Promise.resolve({ done: true, value: undefined });
            sent = true;
            return Promise.resolve({ done: false, value: bytes });
          },
        };
      },
    },
  };
}

test('createNodeCartridgeResolver returns a cached cartridge without network', async () => {
  await withTempDir(async (cacheRoot) => {
    const fixture = createCartridgeFixture();
    try {
      const cache = createNodeCartridgeCache({ rootDir: cacheRoot });
      const { cartridgeDir } = cache.paths('test.fixture.mini', '0.1.0');

      const { copyFileSync, mkdirSync, readdirSync, statSync } = await import('node:fs');
      mkdirSync(cartridgeDir, { recursive: true });
      for (const name of readdirSync(fixture.dir)) {
        const abs = pathJoin(fixture.dir, name);
        if (statSync(abs).isDirectory()) {
          mkdirSync(pathJoin(cartridgeDir, name), { recursive: true });
          for (const sub of readdirSync(abs)) {
            copyFileSync(pathJoin(abs, sub), pathJoin(cartridgeDir, name, sub));
          }
        } else {
          copyFileSync(abs, pathJoin(cartridgeDir, name));
        }
      }

      const resolver = createNodeCartridgeResolver({ cache });
      const loaded = await resolver({ id: 'test.fixture.mini' });
      assert.equal(loaded.manifest.id, 'test.fixture.mini');
      assert.equal(loaded.manifest.version, '0.1.0');
    } finally {
      fixture.cleanup();
    }
  });
});

test('createNodeCartridgeResolver throws when cartridge missing and autoPull=false', async () => {
  await withTempDir(async (cacheRoot) => {
    const cache = createNodeCartridgeCache({ rootDir: cacheRoot });
    const resolver = createNodeCartridgeResolver({ cache });
    await assert.rejects(
      resolver({ id: 'com.example.missing' }),
      (err: unknown) =>
        err instanceof CartridgeResolveError && /not in the local cache/.test(err.message),
    );
  });
});

test('createNodeCartridgeResolver autoPull downloads + unpacks into the cache', async () => {
  await withTempDir(async (cacheRoot) => {
    // 1. Build a cartridge, pack it, compute sha256 of the .mcart archive.
    const fixture = createCartridgeFixture();
    try {
      const archivePath = pathJoin(cacheRoot, 'src.mcart');
      await packCartridge(fixture.dir, archivePath, {
        zip: createNodeCartridgeZipAdapter(),
      });
      const archiveBytes = readFileSync(archivePath);
      const archiveSha = createHash('sha256').update(archiveBytes).digest('hex');

      // 2. Build a fake catalog that points at the packed bytes.
      const entry = sampleEntry({
        id: 'test.fixture.mini',
        version: '0.1.0',
        downloadUrl: 'https://example.invalid/test.mcart',
        downloadSizeBytes: archiveBytes.length,
        sha256: archiveSha,
        manifest: {
          schemaVersion: '1.0.0',
          id: 'test.fixture.mini',
          name: 'Mini Fixture',
          version: '0.1.0',
          weights: {
            format: 'gguf',
            path: 'weights/model.gguf',
            sizeBytes: fixture.weightsBytes.length,
            sha256: fixture.weightsSha256,
          },
          capabilities: {
            inputModalities: ['text'],
            outputModalities: ['text'],
          },
        },
      });
      const catalog = sampleCatalog([entry]);

      // 3. Serve catalog + archive bytes via injected fetchers.
      const catalogFetch: CatalogFetcher = async () => ({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(catalog)),
      });
      const downloadFetch: DownloadFetcher = async () =>
        bytesResponse(new Uint8Array(archiveBytes));

      // 4. Run resolver; confirm cache was populated.
      const cache = createNodeCartridgeCache({ rootDir: cacheRoot });
      const resolver = createNodeCartridgeResolver({
        cache,
        catalogUrl: 'https://example.invalid/catalog.json',
        autoPull: true,
        catalogFetch,
        downloadFetch,
      });
      const loaded = await resolver({ id: 'test.fixture.mini' });

      assert.equal(loaded.manifest.id, 'test.fixture.mini');
      assert.equal(await cache.isPresent('test.fixture.mini', '0.1.0'), true);

      // 5. A second resolve should be a pure cache hit — stub the fetchers to
      //    throw so we know they were not called.
      const trapCatalog: CatalogFetcher = async () => {
        throw new Error('should not re-fetch catalog');
      };
      const trapDownload: DownloadFetcher = async () => {
        throw new Error('should not re-download archive');
      };
      const resolver2 = createNodeCartridgeResolver({
        cache,
        catalogUrl: 'https://example.invalid/catalog.json',
        autoPull: true,
        catalogFetch: trapCatalog,
        downloadFetch: trapDownload,
      });
      const loaded2 = await resolver2({ id: 'test.fixture.mini' });
      assert.equal(loaded2.manifest.id, 'test.fixture.mini');
    } finally {
      fixture.cleanup();
    }
  });
});
