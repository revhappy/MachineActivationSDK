import assert from 'node:assert/strict';

import { test } from '../_harness';
import { runCli } from './_run';

test('machine describe emits a JSON snapshot of the full SDK surface', () => {
  const result = runCli(['describe']);
  assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);

  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;

  // Top-level keys an agent can rely on.
  for (const key of [
    'sdkVersion',
    'schemaVersions',
    'shippedMilestones',
    'weightFormats',
    'cli',
    'sdk',
    'manifest',
    'catalog',
    'pointers',
  ]) {
    assert.ok(key in parsed, `missing top-level key: ${key}`);
  }

  const schemaVersions = parsed.schemaVersions as Record<string, string>;
  assert.equal(schemaVersions.cartridge, '1.0.0');
  assert.equal(schemaVersions.catalog, '1.0.0');

  const cli = parsed.cli as Array<{ name: string }>;
  const cliNames = cli.map((c) => c.name).sort();
  assert.ok(cliNames.includes('describe'));
  assert.ok(cliNames.includes('pack'));
  assert.ok(cliNames.includes('pull'));

  const sdk = parsed.sdk as Array<{ name: string }>;
  const sdkNames = sdk.map((s) => s.name);
  assert.ok(sdkNames.includes('createMachine'));
  assert.ok(sdkNames.includes('generateObject'));
  assert.ok(sdkNames.includes('zodSchema'));

  const manifest = parsed.manifest as { fields: Array<{ path: string; required: boolean }> };
  const requiredManifestPaths = manifest.fields.filter((f) => f.required).map((f) => f.path);
  for (const p of ['id', 'name', 'version', 'weights.path', 'weights.sha256']) {
    assert.ok(requiredManifestPaths.includes(p), `manifest missing required field: ${p}`);
  }

  const catalog = parsed.catalog as { fields: Array<{ path: string; required: boolean }> };
  const catalogPaths = catalog.fields.map((f) => f.path);
  assert.ok(catalogPaths.includes('entries[].sha256'));
  assert.ok(catalogPaths.includes('entries[].downloadUrl'));

  const pointers = parsed.pointers as Record<string, string>;
  assert.equal(pointers.roadmap, 'CARTRIDGE_SDK_ROADMAP.md');
  assert.equal(pointers.agentsGuide, 'AGENTS.md');
});

test('machine describe <section> filters to just that section', () => {
  const result = runCli(['describe', 'cli']);
  assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);

  const parsed = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed), 'cli section should be an array');
  assert.ok(parsed.length > 0);
  assert.ok(typeof parsed[0].name === 'string');
  assert.ok(typeof parsed[0].usage === 'string');
});

test('machine describe --compact emits single-line JSON', () => {
  const result = runCli(['describe', '--compact']);
  assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);

  const trimmed = result.stdout.trim();
  assert.ok(!trimmed.includes('\n'), 'compact output should be single-line');
  assert.doesNotThrow(() => JSON.parse(trimmed));
});

test('machine describe rejects unknown sections with exit 2', () => {
  const result = runCli(['describe', 'nope']);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /unknown section/);
});
