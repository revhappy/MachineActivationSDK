import assert from 'node:assert/strict';

import { parseCatalog } from '../../src/catalog';
import { test } from '../_harness';
import { sampleCatalog, sampleEntry } from './_fixtures';

test('parseCatalog accepts a valid minimal catalog', () => {
  const result = parseCatalog(sampleCatalog());
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.catalog.schemaVersion, '1.0.0');
    assert.equal(result.catalog.entries.length, 1);
    assert.equal(result.catalog.entries[0].id, 'com.example.demo');
  }
});

test('parseCatalog rejects non-object root', () => {
  const result = parseCatalog('nope');
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => /must be a JSON object/.test(i.message)));
  }
});

test('parseCatalog rejects missing schemaVersion', () => {
  const { schemaVersion: _sv, ...rest } = sampleCatalog();
  const result = parseCatalog(rest);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === 'schemaVersion'));
  }
});

test('parseCatalog rejects non-array entries', () => {
  const result = parseCatalog({ schemaVersion: '1.0.0', entries: 'nope' });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === 'entries'));
  }
});

test('parseCatalog rejects an entry with malformed sha256', () => {
  const entry = sampleEntry({ sha256: 'not-a-real-hash' });
  const result = parseCatalog(sampleCatalog([entry]));
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => /sha256/.test(i.path)));
  }
});

test('parseCatalog rejects entry whose manifest.id disagrees with entry.id', () => {
  const entry = sampleEntry({
    id: 'com.example.real',
    manifest: {
      ...sampleEntry().manifest,
      id: 'com.example.other',
    },
  });
  const result = parseCatalog(sampleCatalog([entry]));
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => /manifest\.id/.test(i.path)));
  }
});

test('parseCatalog surfaces nested manifest issues with path prefix', () => {
  const badEntry = sampleEntry({
    manifest: {
      ...sampleEntry().manifest,
      weights: {
        ...sampleEntry().manifest.weights,
        path: '/etc/passwd',
      },
    },
  });
  const result = parseCatalog(sampleCatalog([badEntry]));
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(
      result.issues.some((i) => i.path.startsWith('entries[0].manifest.weights.path')),
      `expected nested manifest issue, got: ${result.issues.map((i) => i.path).join(', ')}`,
    );
  }
});

test('parseCatalog normalizes uppercase sha256 to lowercase', () => {
  const entry = sampleEntry({ sha256: 'A'.repeat(64) });
  const result = parseCatalog(sampleCatalog([entry]));
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.catalog.entries[0].sha256, 'a'.repeat(64));
  }
});

test('parseCatalog accepts author object but rejects author without name', () => {
  const ok = parseCatalog(
    sampleCatalog([sampleEntry({ author: { name: 'Team', url: 'https://example.invalid' } })]),
  );
  assert.equal(ok.valid, true);

  const bad = parseCatalog(
    sampleCatalog([sampleEntry({ author: { url: 'https://example.invalid' } as unknown as { name: string } })]),
  );
  assert.equal(bad.valid, false);
});

test('parseCatalog rejects featured when not a boolean', () => {
  const entry = { ...sampleEntry(), featured: 'yes' as unknown as boolean };
  const result = parseCatalog(sampleCatalog([entry]));
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => /featured/.test(i.path)));
  }
});

test('parseCatalog keeps tags and categories when arrays of strings', () => {
  const entry = sampleEntry({ tags: ['demo', 'chat'], categories: ['text'] });
  const result = parseCatalog(sampleCatalog([entry]));
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.catalog.entries[0].tags, ['demo', 'chat']);
    assert.deepEqual(result.catalog.entries[0].categories, ['text']);
  }
});
