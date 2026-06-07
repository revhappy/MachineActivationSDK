import type { CartridgeManifest, LoadedCartridge } from '../cartridge/types';

export const CATALOG_SCHEMA_VERSION = '1.0.0';

export interface CatalogAuthor {
  name: string;
  url?: string;
  email?: string;
}

/**
 * One entry in a cartridge catalog. The embedded `manifest` mirrors what the
 * `.mcart` archive contains so browsers / UIs can inspect a cartridge without
 * downloading it.
 */
export interface CatalogEntry {
  id: string;
  version: string;
  name: string;
  description?: string;
  author?: CatalogAuthor;
  homepage?: string;
  license?: string;
  tags?: string[];
  categories?: string[];
  /** Absolute URL of the `.mcart` archive. */
  downloadUrl: string;
  /** Byte size of the `.mcart` archive at downloadUrl. */
  downloadSizeBytes: number;
  /** Lowercase hex sha256 of the `.mcart` archive bytes. */
  sha256: string;
  /** Embedded cartridge manifest for offline browsing. */
  manifest: CartridgeManifest;
  publishedAt?: string;
  featured?: boolean;
  /** Reserved for ed25519 signature over this entry — optional in v1. */
  signature?: string;
}

export interface Catalog {
  schemaVersion: string;
  updatedAt?: string;
  entries: CatalogEntry[];
  /** Reserved for ed25519 signing key — optional in v1. */
  signingKey?: string;
}

/** Result of resolving a `{ id, version? }` spec against a catalog. */
export interface ResolvedCatalogEntry {
  catalog: Catalog;
  entry: CatalogEntry;
}

/** What a consumer passes into a CartridgeResolver. */
export interface CartridgeSpec {
  id: string;
  version?: string;
}

/**
 * The integration seam between `createMachine` and the catalog. Node users get
 * `createNodeCartridgeResolver(...)`; RN / browser users bring their own.
 */
export type CartridgeResolver = (spec: CartridgeSpec) => Promise<LoadedCartridge>;

/** Progress callback shape used by download + pull flows. */
export interface DownloadProgress {
  /** Bytes received so far. */
  receivedBytes: number;
  /** Total bytes expected (the entry's declared downloadSizeBytes). */
  totalBytes: number;
  /** receivedBytes / totalBytes, clamped to [0, 1]. */
  fraction: number;
}
