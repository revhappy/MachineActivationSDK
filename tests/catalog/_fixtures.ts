import type { Catalog, CatalogEntry } from '../../src/catalog';
import type { CartridgeManifest } from '../../src/cartridge/types';

export function sampleManifest(overrides: Partial<CartridgeManifest> = {}): CartridgeManifest {
  return {
    schemaVersion: '1.0.0',
    id: 'com.example.demo',
    name: 'Demo',
    version: '1.0.0',
    weights: {
      format: 'gguf',
      path: 'weights/model.gguf',
      sizeBytes: 1024,
      sha256: '0'.repeat(64),
    },
    capabilities: {
      inputModalities: ['text'],
      outputModalities: ['text'],
    },
    ...overrides,
  };
}

export function sampleEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  const id = overrides.id ?? 'com.example.demo';
  const version = overrides.version ?? '1.0.0';
  const base: CatalogEntry = {
    id,
    version,
    name: 'Demo',
    downloadUrl: `https://example.invalid/${id}-${version}.mcart`,
    downloadSizeBytes: 4096,
    sha256: '0'.repeat(64),
    manifest: sampleManifest({ id, version }),
  };
  return { ...base, ...overrides };
}

export function sampleCatalog(entries: CatalogEntry[] = [sampleEntry()]): Catalog {
  return {
    schemaVersion: '1.0.0',
    entries,
  };
}
