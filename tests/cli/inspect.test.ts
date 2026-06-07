import assert from 'node:assert/strict';

import { createCartridgeFixture } from '../cartridge/_fixtures';
import { test } from '../_harness';
import { runCli } from './_run';

test('machine inspect --json includes manifest, files, and validity', () => {
  const fixture = createCartridgeFixture();
  try {
    const result = runCli(['inspect', fixture.dir, '--json']);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout) as {
      valid: boolean;
      manifest: { id: string };
      files: { path: string; sizeBytes: number }[];
    };
    assert.equal(parsed.valid, true);
    assert.equal(parsed.manifest.id, 'test.fixture.mini');
    const paths = parsed.files.map((f) => f.path);
    assert.ok(paths.includes('manifest.json'));
    assert.ok(paths.includes('weights/model.gguf'));
  } finally {
    fixture.cleanup();
  }
});

test('machine inspect on tampered cartridge surfaces sha256 issue and exits 1', () => {
  const fixture = createCartridgeFixture({ manifestSha256Override: 'c'.repeat(64) });
  try {
    const result = runCli(['inspect', fixture.dir, '--json']);
    assert.equal(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { valid: boolean; issues: { path: string }[] };
    assert.equal(parsed.valid, false);
    assert.ok(parsed.issues.some((i) => i.path === 'weights.sha256'));
  } finally {
    fixture.cleanup();
  }
});
