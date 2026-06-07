import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import yauzl from 'yauzl';

import { createCartridgeFixture } from '../cartridge/_fixtures';
import { test } from '../_harness';
import { runCli, withTempDirAsync } from './_run';

async function readArchiveManifest(zipPath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error('failed to open zip'));
        return;
      }
      let found = false;
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== 'manifest.json') {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) {
            reject(e2 ?? new Error('cannot open manifest entry'));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => {
            found = true;
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (parseErr) {
              reject(parseErr);
            }
            zip.close();
          });
        });
      });
      zip.on('end', () => {
        if (!found) reject(new Error('manifest.json not found in archive'));
      });
      zip.readEntry();
    });
  });
}

test('machine pack produces a .mcart with rehashed manifest', async () => {
  await withTempDirAsync(async (workDir) => {
    // Fixture intentionally lies about sha256/size; pack should rewrite both.
    const lyingHash = 'a'.repeat(64);
    const fixture = createCartridgeFixture({
      manifestSha256Override: lyingHash,
      manifestSizeOverride: 999_999,
    });
    try {
      const out = join(workDir, 'out.mcart');
      const result = runCli(['pack', fixture.dir, '--out', out]);
      assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
      assert.ok(existsSync(out));
      assert.ok(statSync(out).size > 0);

      const archived = await readArchiveManifest(out) as { weights: { sha256: string; sizeBytes: number } };
      assert.equal(archived.weights.sha256, fixture.weightsSha256);
      assert.equal(archived.weights.sizeBytes, fixture.weightsBytes.length);
    } finally {
      fixture.cleanup();
    }
  });
});

test('machine pack --no-rehash preserves manifest values verbatim', async () => {
  await withTempDirAsync(async (workDir) => {
    const lyingHash = 'b'.repeat(64);
    const fixture = createCartridgeFixture({
      manifestSha256Override: lyingHash,
      manifestSizeOverride: 12345,
    });
    try {
      const out = join(workDir, 'out.mcart');
      const result = runCli(['pack', fixture.dir, '--out', out, '--no-rehash']);
      assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
      const archived = await readArchiveManifest(out) as { weights: { sha256: string; sizeBytes: number } };
      assert.equal(archived.weights.sha256, lyingHash);
      assert.equal(archived.weights.sizeBytes, 12345);
    } finally {
      fixture.cleanup();
    }
  });
});

test('machine pack defaults output to <id>-<version>.mcart in cwd', async () => {
  await withTempDirAsync(async (workDir) => {
    const fixture = createCartridgeFixture();
    try {
      const expectedPath = join(workDir, 'test.fixture.mini-0.1.0.mcart');
      const result = runCli(['pack', fixture.dir], { cwd: workDir });
      assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
      assert.ok(existsSync(expectedPath));
    } finally {
      fixture.cleanup();
    }
  });
});

test('machine pack on a malformed manifest exits 1', async () => {
  await withTempDirAsync(async (workDir) => {
    const fixture = createCartridgeFixture({ malformedManifest: true });
    try {
      const out = join(workDir, 'out.mcart');
      const result = runCli(['pack', fixture.dir, '--out', out]);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /pack:/);
    } finally {
      fixture.cleanup();
    }
  });
});
