import assert from 'node:assert/strict';

import type { Catalog } from '../../src/catalog';

import { test } from '../_harness';
import { startCatalogServer } from './_catalogServer';
import { runCli, runCliAsync } from './_run';

function fixtureCatalog(): Catalog {
  return {
    schemaVersion: '1.0.0',
    entries: [
      {
        id: 'com.example.demo-small',
        version: '0.1.0',
        name: 'Demo Small',
        description: 'Tiny sample cartridge for tests.',
        tags: ['demo', 'sample'],
        categories: ['text'],
        downloadUrl: 'http://127.0.0.1:0/demo-small.mcart',
        downloadSizeBytes: 4096,
        sha256: '0'.repeat(64),
        manifest: {
          schemaVersion: '1.0.0',
          id: 'com.example.demo-small',
          name: 'Demo Small',
          version: '0.1.0',
          weights: {
            format: 'gguf',
            path: 'weights/model.gguf',
            sizeBytes: 2048,
            sha256: '0'.repeat(64),
          },
          capabilities: { inputModalities: ['text'], outputModalities: ['text'] },
        },
      },
      {
        id: 'com.example.demo-chat',
        version: '1.0.0',
        name: 'Demo Chat',
        description: 'Another sample entry.',
        tags: ['chat'],
        categories: ['text', 'chat'],
        downloadUrl: 'http://127.0.0.1:0/demo-chat.mcart',
        downloadSizeBytes: 8192,
        sha256: '0'.repeat(64),
        manifest: {
          schemaVersion: '1.0.0',
          id: 'com.example.demo-chat',
          name: 'Demo Chat',
          version: '1.0.0',
          weights: {
            format: 'gguf',
            path: 'weights/model.gguf',
            sizeBytes: 4096,
            sha256: '0'.repeat(64),
          },
          capabilities: { inputModalities: ['text'], outputModalities: ['text'] },
        },
      },
    ],
  };
}

test('machine search matches on id and prints a human table', async () => {
  const server = await startCatalogServer({ catalog: fixtureCatalog(), archives: {} });
  try {
    const result = await runCliAsync(['search', 'chat', '--catalog', server.catalogUrl]);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /com\.example\.demo-chat/);
    assert.ok(!/com\.example\.demo-small/.test(result.stdout));
  } finally {
    await server.close();
  }
});

test('machine search --json emits an array of matching entries', async () => {
  const server = await startCatalogServer({ catalog: fixtureCatalog(), archives: {} });
  try {
    const result = await runCliAsync(['search', 'demo', '--catalog', server.catalogUrl, '--json']);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout) as { id: string }[];
    const ids = parsed.map((e) => e.id).sort();
    assert.deepEqual(ids, ['com.example.demo-chat', 'com.example.demo-small']);
  } finally {
    await server.close();
  }
});

test('machine search prints no-results hint when nothing matches', async () => {
  const server = await startCatalogServer({ catalog: fixtureCatalog(), archives: {} });
  try {
    const result = await runCliAsync(['search', 'zzz-unlikely', '--catalog', server.catalogUrl]);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /No cartridges match/);
  } finally {
    await server.close();
  }
});

test('machine search without a query exits 2', () => {
  const result = runCli(['search']);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /missing query/);
});
