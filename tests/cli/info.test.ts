import assert from 'node:assert/strict';

import { createCartridgeFixture } from '../cartridge/_fixtures';
import { test } from '../_harness';
import { runCli } from './_run';

test('machine info prints id, name, version, weights format', () => {
  const fixture = createCartridgeFixture();
  try {
    const result = runCli(['info', fixture.dir]);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /test\.fixture\.mini/);
    assert.match(result.stdout, /Mini Fixture/);
    assert.match(result.stdout, /0\.1\.0/);
    assert.match(result.stdout, /gguf/);
  } finally {
    fixture.cleanup();
  }
});

test('machine info --json emits a parseable summary', () => {
  const fixture = createCartridgeFixture();
  try {
    const result = runCli(['info', fixture.dir, '--json']);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.id, 'test.fixture.mini');
    assert.equal(parsed.weights.format, 'gguf');
    assert.equal(parsed.capabilities.inputModalities[0], 'text');
  } finally {
    fixture.cleanup();
  }
});
