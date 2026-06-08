export {
  CATALOG_SCHEMA_VERSION,
  type Catalog,
  type CatalogAuthor,
  type CatalogEntry,
  type CartridgeResolver,
  type CartridgeSpec,
  type DownloadProgress,
  type ResolvedCatalogEntry,
} from './types';

export {
  parseCatalog,
  type CatalogValidationIssue,
  type CatalogValidationResult,
} from './catalogSchema';

export {
  CartridgeResolveError,
  resolveCartridgeEntry,
} from './resolveCartridge';

export {
  CatalogFetchError,
  fetchCatalog,
  type CatalogFetcher,
  type CatalogFetchResponse,
  type FetchCatalogOptions,
} from './fetchCatalog';

export {
  CartridgeDownloadError,
  downloadCartridgeToStream,
  type DownloadCartridgeOptions,
  type DownloadCartridgeResult,
  type DownloadFetcher,
  type DownloadResponse,
  type StreamingHasher,
} from './downloadCartridge';

export {
  defaultCacheLayout,
  type CartridgeCache,
  type CartridgeCacheListEntry,
  type CartridgeCachePaths,
} from './cartridgeCache';

// Node-only helpers (createNodeCartridgeCache, downloadAndUnpackCartridge,
// createNodeCartridgeResolver) live in `machineai-activation/node`.
