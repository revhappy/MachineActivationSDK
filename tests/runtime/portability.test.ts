import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test } from '../_harness';

// The portable/Node split is a packaging guarantee, not a style preference.
//
// A static re-export of a `node:*`-importing module from the main barrel keeps
// `node:child_process` in a bundler's dependency graph regardless of
// `sideEffects: false` and the `browser` field — this repo already paid for that
// lesson once with `nodeFs`. These assertions make the rule enforceable instead
// of documented, now that the built-in llama adapter puts portable and Node-only
// code in the same directory.

const repoRoot = process.cwd();

function readSource(...parts: string[]): string {
  return readFileSync(join(repoRoot, ...parts), 'utf8');
}

test('the runtime barrel does not re-export the Node-only process manager', () => {
  const barrel = readSource('src', 'runtime', 'index.ts');
  assert.ok(
    !barrel.includes("from './nodeLlamaServer'"),
    'src/runtime/index.ts must not re-export nodeLlamaServer — it belongs to machineai-activation/node',
  );
});

test('portable runtime sources are free of node:* imports', () => {
  for (const file of [
    'index.ts',
    'llamaServerRuntime.ts',
    'stubRuntime.ts',
    'wire.ts',
    'capabilities.ts',
    'types.ts',
  ]) {
    const source = readSource('src', 'runtime', file);
    assert.ok(
      !source.includes("from 'node:"),
      `src/runtime/${file} must stay free of node:* imports so it bundles for RN, Capacitor and the browser`,
    );
  }
});

test('the Node barrel exposes the llama-server process manager', () => {
  const nodeBarrel = readSource('src', 'node.ts');
  for (const name of ['startLlamaServer', 'ensureLlamaServer', 'discoverLlamaServer']) {
    assert.ok(nodeBarrel.includes(name), `machineai-activation/node should export ${name}`);
  }
});

test('the main barrel exposes the portable adapter', () => {
  const barrel = readSource('src', 'index.ts');
  assert.ok(
    barrel.includes("from './runtime/index'"),
    'src/index.ts should re-export the portable runtime barrel',
  );
  assert.ok(
    !barrel.includes('nodeLlamaServer'),
    'src/index.ts must not reach the Node-only process manager',
  );
});
