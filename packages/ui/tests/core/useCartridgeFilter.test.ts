import type { CatalogEntry } from '@machine/activation-sdk';
import { filterCartridges } from '../../src/core/useCartridgeFilter';
import { assert, assertEqual, test } from '../_harness';

function entry(
  overrides: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'version' | 'name'>,
): CatalogEntry {
  return {
    id: overrides.id,
    version: overrides.version,
    name: overrides.name,
    description: overrides.description,
    tags: overrides.tags,
    categories: overrides.categories,
    downloadUrl: overrides.downloadUrl ?? 'https://example.test/fake.mcart',
    downloadSizeBytes: overrides.downloadSizeBytes ?? 100,
    sha256: overrides.sha256 ?? 'a'.repeat(64),
    manifest: overrides.manifest as CartridgeManifestLike ?? (null as unknown as CatalogEntry['manifest']),
    featured: overrides.featured,
    author: overrides.author,
  } as CatalogEntry;
}

// Minimal sub-type so tests don't have to invent a full CartridgeManifest.
// filterCartridges never reads `manifest`.
type CartridgeManifestLike = CatalogEntry['manifest'];

const fixtures: CatalogEntry[] = [
  entry({
    id: 'a-featured',
    version: '1.0.0',
    name: 'Featured Alpha',
    description: 'The featured one.',
    tags: ['chat', 'fast'],
    categories: ['general'],
    featured: true,
  }),
  entry({
    id: 'b-coder',
    version: '1.0.0',
    name: 'Coder Beta',
    description: 'Code completion.',
    tags: ['code'],
    categories: ['developer'],
  }),
  entry({
    id: 'c-chat',
    version: '1.0.0',
    name: 'Chat Gamma',
    description: 'A gentle chatter.',
    tags: ['chat'],
    categories: ['general'],
  }),
];

test('filterCartridges: empty query returns all entries', () => {
  const out = filterCartridges(fixtures, '', null, [], false);
  assertEqual(out.length, 3);
});

test('filterCartridges: matches name, description, and id case-insensitively', () => {
  assertEqual(filterCartridges(fixtures, 'coder', null, [], false).length, 1);
  assertEqual(filterCartridges(fixtures, 'GENTLE', null, [], false).length, 1);
  assertEqual(filterCartridges(fixtures, 'a-featured', null, [], false).length, 1);
});

test('filterCartridges: category filter narrows to matching entries only', () => {
  const out = filterCartridges(fixtures, '', 'developer', [], false);
  assertEqual(out.length, 1);
  assertEqual(out[0].id, 'b-coder');
});

test('filterCartridges: tag filter requires ALL tags to be present', () => {
  const both = filterCartridges(fixtures, '', null, ['chat', 'fast'], false);
  assertEqual(both.length, 1);
  assertEqual(both[0].id, 'a-featured');

  const chatOnly = filterCartridges(fixtures, '', null, ['chat'], false);
  assertEqual(chatOnly.length, 2);
});

test('filterCartridges: featuredFirst bubbles featured entries to the top', () => {
  const out = filterCartridges(fixtures, '', null, [], true);
  assertEqual(out[0].id, 'a-featured');
});

test('filterCartridges: non-featuredFirst preserves input order', () => {
  const out = filterCartridges(fixtures, '', null, [], false);
  assertEqual(out[0].id, 'a-featured');
  assertEqual(out[1].id, 'b-coder');
  assertEqual(out[2].id, 'c-chat');
});

test('filterCartridges: combined filters compose', () => {
  const out = filterCartridges(fixtures, 'chat', 'general', [], true);
  assertEqual(out.length, 2);
  assert(out.some((e) => e.id === 'a-featured'), 'featured survives combined filter');
  assert(out.some((e) => e.id === 'c-chat'), 'chat-gamma survives combined filter');
});
