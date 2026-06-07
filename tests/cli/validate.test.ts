import assert from 'node:assert/strict';
import { join } from 'node:path';

import { createCartridgeFixture } from '../cartridge/_fixtures';
import { test } from '../_harness';
import { runCli, withTempDirAsync } from './_run';

test('machine validate exits 0 on a valid directory', () => {
  const fixture = createCartridgeFixture();
  try {
    const result = runCli(['validate', fixture.dir]);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /valid/);
  } finally {
    fixture.cleanup();
  }
});

test('machine validate exits 1 on sha256 mismatch', () => {
  const fixture = createCartridgeFixture({ manifestSha256Override: 'd'.repeat(64) });
  try {
    const result = runCli(['validate', fixture.dir]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /invalid/);
    assert.match(result.stdout, /sha256/);
  } finally {
    fixture.cleanup();
  }
});

test('machine validate --json emits structured output', () => {
  const fixture = createCartridgeFixture();
  try {
    const result = runCli(['validate', fixture.dir, '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.manifest.id, 'test.fixture.mini');
  } finally {
    fixture.cleanup();
  }
});

test('machine validate works on a packed .mcart', async () => {
  await withTempDirAsync(async (workDir) => {
    const fixture = createCartridgeFixture();
    try {
      const archive = join(workDir, 'pkg.mcart');
      assert.equal(runCli(['pack', fixture.dir, '--out', archive]).exitCode, 0);
      const result = runCli(['validate', archive]);
      assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    } finally {
      fixture.cleanup();
    }
  });
});
