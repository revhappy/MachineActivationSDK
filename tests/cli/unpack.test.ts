import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createCartridgeFixture } from '../cartridge/_fixtures';
import { test } from '../_harness';
import { runCli, withTempDirAsync } from './_run';

test('machine unpack restores weights byte-for-byte', async () => {
  await withTempDirAsync(async (workDir) => {
    const fixture = createCartridgeFixture();
    try {
      const archive = join(workDir, 'pkg.mcart');
      assert.equal(runCli(['pack', fixture.dir, '--out', archive]).exitCode, 0);

      const outDir = join(workDir, 'extracted');
      const result = runCli(['unpack', archive, '--out', outDir]);
      assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
      assert.ok(existsSync(join(outDir, 'manifest.json')));

      const restored = readFileSync(join(outDir, 'weights', 'model.gguf'));
      assert.equal(restored.length, fixture.weightsBytes.length);
      assert.deepEqual(new Uint8Array(restored), fixture.weightsBytes);
    } finally {
      fixture.cleanup();
    }
  });
});

test('machine unpack defaults output to <basename>/ next to the zip', async () => {
  await withTempDirAsync(async (workDir) => {
    const fixture = createCartridgeFixture();
    try {
      const archive = join(workDir, 'mycart.mcart');
      assert.equal(runCli(['pack', fixture.dir, '--out', archive]).exitCode, 0);
      const result = runCli(['unpack', archive]);
      assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
      assert.ok(existsSync(join(workDir, 'mycart', 'manifest.json')));
    } finally {
      fixture.cleanup();
    }
  });
});

test('machine unpack on a non-existent file exits 1', () => {
  const result = runCli(['unpack', '/nonexistent/nope.mcart']);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /unpack:/);
});
