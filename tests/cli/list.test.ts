import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createCartridgeFixture } from '../cartridge/_fixtures';
import { test } from '../_harness';
import { runCli, withTempDirAsync } from './_run';

function seedCache(cacheDir: string, id: string, version: string, fixtureDir: string): void {
  const target = join(cacheDir, id, version);
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(fixtureDir)) {
    const abs = join(fixtureDir, name);
    if (statSync(abs).isDirectory()) {
      mkdirSync(join(target, name), { recursive: true });
      for (const sub of readdirSync(abs)) {
        copyFileSync(join(abs, sub), join(target, name, sub));
      }
    } else {
      copyFileSync(abs, join(target, name));
    }
  }
}

test('machine list prints cached cartridges in human mode', async () => {
  await withTempDirAsync(async (cacheDir) => {
    const fA = createCartridgeFixture({
      manifestOverrides: { id: 'com.example.alpha', name: 'Alpha', version: '1.0.0' },
    });
    const fB = createCartridgeFixture({
      manifestOverrides: { id: 'com.example.beta', name: 'Beta', version: '0.2.0' },
    });
    try {
      seedCache(cacheDir, 'com.example.alpha', '1.0.0', fA.dir);
      seedCache(cacheDir, 'com.example.beta', '0.2.0', fB.dir);

      const result = runCli(['list', '--cache', cacheDir]);
      assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
      assert.match(result.stdout, /com\.example\.alpha@1\.0\.0/);
      assert.match(result.stdout, /com\.example\.beta@0\.2\.0/);
    } finally {
      fA.cleanup();
      fB.cleanup();
    }
  });
});

test('machine list --json emits a parseable entry array', async () => {
  await withTempDirAsync(async (cacheDir) => {
    const f = createCartridgeFixture({
      manifestOverrides: { id: 'com.example.alpha', name: 'Alpha', version: '1.0.0' },
    });
    try {
      seedCache(cacheDir, 'com.example.alpha', '1.0.0', f.dir);

      const result = runCli(['list', '--cache', cacheDir, '--json']);
      assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout) as {
        rootDir: string;
        entries: { id: string; version: string; name?: string }[];
      };
      assert.equal(parsed.entries.length, 1);
      assert.equal(parsed.entries[0].id, 'com.example.alpha');
      assert.equal(parsed.entries[0].version, '1.0.0');
      assert.equal(parsed.entries[0].name, 'Alpha');
    } finally {
      f.cleanup();
    }
  });
});

test('machine list on empty cache prints a friendly hint', async () => {
  await withTempDirAsync(async (cacheDir) => {
    const result = runCli(['list', '--cache', cacheDir]);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /No cartridges cached/);
  });
});
