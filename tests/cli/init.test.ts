import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

import { parseCartridgeManifest } from '../../src/cartridge';
import { test } from '../_harness';
import { runCli, withTempDir } from './_run';

test('machine init creates a valid placeholder cartridge', () => {
  withTempDir((dir) => {
    const target = join(dir, 'mycart');
    const result = runCli(['init', target]);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.ok(existsSync(join(target, 'manifest.json')));
    assert.ok(existsSync(join(target, 'weights')));

    const raw = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8'));
    const parsed = parseCartridgeManifest(raw);
    assert.equal(parsed.valid, true, JSON.stringify(parsed));
    assert.equal(raw.weights.sha256, '0'.repeat(64));
  });
});

test('machine init refuses to overwrite without --force', () => {
  withTempDir((dir) => {
    const target = join(dir, 'mycart');
    assert.equal(runCli(['init', target]).exitCode, 0);
    const second = runCli(['init', target]);
    assert.equal(second.exitCode, 1);
    assert.match(second.stderr, /already exists/);
  });
});

test('machine init --force overwrites an existing manifest', () => {
  withTempDir((dir) => {
    const target = join(dir, 'mycart');
    assert.equal(runCli(['init', target]).exitCode, 0);
    const second = runCli(['init', target, '--force']);
    assert.equal(second.exitCode, 0, second.stderr);
  });
});

test('machine init without target dir exits 2 with usage', () => {
  const result = runCli(['init']);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /missing target directory/);
});
