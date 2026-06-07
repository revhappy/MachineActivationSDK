import assert from 'node:assert/strict';

import { CartridgeResolveError, resolveCartridgeEntry } from '../../src/catalog';
import { test } from '../_harness';
import { sampleCatalog, sampleEntry } from './_fixtures';

test('resolveCartridgeEntry with no version picks highest version', () => {
  const catalog = sampleCatalog([
    sampleEntry({ id: 'com.example.a', version: '1.0.0' }),
    sampleEntry({ id: 'com.example.a', version: '1.2.0' }),
    sampleEntry({ id: 'com.example.a', version: '0.9.0' }),
  ]);
  const { entry } = resolveCartridgeEntry(catalog, { id: 'com.example.a' });
  assert.equal(entry.version, '1.2.0');
});

test('resolveCartridgeEntry with explicit version returns exact match', () => {
  const catalog = sampleCatalog([
    sampleEntry({ id: 'com.example.a', version: '1.0.0' }),
    sampleEntry({ id: 'com.example.a', version: '1.2.0' }),
  ]);
  const { entry } = resolveCartridgeEntry(catalog, { id: 'com.example.a', version: '1.0.0' });
  assert.equal(entry.version, '1.0.0');
});

test('resolveCartridgeEntry throws for unknown id', () => {
  const catalog = sampleCatalog([sampleEntry({ id: 'com.example.a' })]);
  assert.throws(
    () => resolveCartridgeEntry(catalog, { id: 'com.example.missing' }),
    (err: unknown) => err instanceof CartridgeResolveError && /No catalog entry/.test(err.message),
  );
});

test('resolveCartridgeEntry throws for unknown version listing available versions', () => {
  const catalog = sampleCatalog([
    sampleEntry({ id: 'com.example.a', version: '1.0.0' }),
    sampleEntry({ id: 'com.example.a', version: '2.0.0' }),
  ]);
  assert.throws(
    () =>
      resolveCartridgeEntry(catalog, { id: 'com.example.a', version: '9.9.9' }),
    (err: unknown) =>
      err instanceof CartridgeResolveError && /available: 1\.0\.0, 2\.0\.0/.test(err.message),
  );
});

test('resolveCartridgeEntry ranks prereleases below stable', () => {
  const catalog = sampleCatalog([
    sampleEntry({ id: 'com.example.a', version: '2.0.0-beta' }),
    sampleEntry({ id: 'com.example.a', version: '2.0.0' }),
  ]);
  const { entry } = resolveCartridgeEntry(catalog, { id: 'com.example.a' });
  assert.equal(entry.version, '2.0.0');
});
