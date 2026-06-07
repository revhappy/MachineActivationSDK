import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { packCartridge } from '../../src/cartridge/nodePackCartridge';
import { createNodeCartridgeZipAdapter } from '../../src/cartridge/nodeZip';
import type { Catalog } from '../../src/catalog';

import { createCartridgeFixture } from '../cartridge/_fixtures';
import { test } from '../_harness';
import { startCatalogServer } from './_catalogServer';
import { runCli, runCliAsync, withTempDirAsync } from './_run';

async function prepareFixtureArchive(workDir: string): Promise<{
  archivePath: string;
  archiveBytes: Buffer;
  archiveSha: string;
  fixture: ReturnType<typeof createCartridgeFixture>;
}> {
  const fixture = createCartridgeFixture();
  const archivePath = join(workDir, 'fixture.mcart');
  await packCartridge(fixture.dir, archivePath, {
    zip: createNodeCartridgeZipAdapter(),
  });
  const archiveBytes = readFileSync(archivePath);
  const archiveSha = createHash('sha256').update(archiveBytes).digest('hex');
  return { archivePath, archiveBytes, archiveSha, fixture };
}

test('machine pull downloads, verifies and unpacks into the cache', async () => {
  await withTempDirAsync(async (workDir) => {
    const { archiveBytes, archiveSha, fixture } = await prepareFixtureArchive(workDir);
    try {
      const catalog: Catalog = {
        schemaVersion: '1.0.0',
        entries: [
          {
            id: 'test.fixture.mini',
            version: '0.1.0',
            name: 'Mini Fixture',
            downloadUrl: '', // filled in below once we know the baseUrl
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
          },
        ],
      };

      const server = await startCatalogServer({
        catalog,
        archives: { '/fixture.mcart': archiveBytes },
      });
      catalog.entries[0].downloadUrl = `${server.baseUrl}/fixture.mcart`;
      try {
        const cacheDir = join(workDir, 'cache');
        const result = await runCliAsync([
          'pull',
          'test.fixture.mini',
          '--catalog',
          server.catalogUrl,
          '--cache',
          cacheDir,
        ]);

        assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
        assert.match(result.stdout, /Pulled test\.fixture\.mini@0\.1\.0/);
        assert.ok(existsSync(join(cacheDir, 'test.fixture.mini', '0.1.0', 'manifest.json')));
        assert.ok(
          existsSync(join(cacheDir, 'test.fixture.mini', '0.1.0', 'weights', 'model.gguf')),
        );
      } finally {
        await server.close();
      }
    } finally {
      fixture.cleanup();
    }
  });
});

test('machine pull refuses to overwrite a cached cartridge without --force', async () => {
  await withTempDirAsync(async (workDir) => {
    const { archiveBytes, archiveSha, fixture } = await prepareFixtureArchive(workDir);
    try {
      const catalog: Catalog = {
        schemaVersion: '1.0.0',
        entries: [
          {
            id: 'test.fixture.mini',
            version: '0.1.0',
            name: 'Mini Fixture',
            downloadUrl: '',
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
          },
        ],
      };

      const server = await startCatalogServer({
        catalog,
        archives: { '/fixture.mcart': archiveBytes },
      });
      catalog.entries[0].downloadUrl = `${server.baseUrl}/fixture.mcart`;
      try {
        const cacheDir = join(workDir, 'cache');
        const first = await runCliAsync([
          'pull',
          'test.fixture.mini',
          '--catalog',
          server.catalogUrl,
          '--cache',
          cacheDir,
        ]);
        assert.equal(first.exitCode, 0, `stderr: ${first.stderr}`);

        const second = await runCliAsync([
          'pull',
          'test.fixture.mini',
          '--catalog',
          server.catalogUrl,
          '--cache',
          cacheDir,
        ]);
        assert.equal(second.exitCode, 0, `stderr: ${second.stderr}`);
        assert.match(second.stdout, /Already cached/);
      } finally {
        await server.close();
      }
    } finally {
      fixture.cleanup();
    }
  });
});

test('machine pull exits 1 when the catalog does not contain the id', async () => {
  await withTempDirAsync(async (workDir) => {
    const catalog: Catalog = {
      schemaVersion: '1.0.0',
      entries: [],
    };
    const server = await startCatalogServer({ catalog, archives: {} });
    try {
      const cacheDir = join(workDir, 'cache');
      const result = runCli([
        'pull',
        'com.example.missing',
        '--catalog',
        server.catalogUrl,
        '--cache',
        cacheDir,
      ]);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /pull:/);
    } finally {
      await server.close();
    }
  });
});
