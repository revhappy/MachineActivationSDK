/**
 * Describes where cached cartridges live. Portable — no filesystem I/O. Node
 * and RN both fulfill this against their own FS.
 *
 * Cache layout:
 *   <rootDir>/
 *     <id>/
 *       <version>/
 *         manifest.json
 *         weights/...
 *         ...
 */
export interface CartridgeCachePaths {
  cartridgeDir: string;
  manifestPath: string;
}

export interface CartridgeCacheListEntry {
  id: string;
  version: string;
  cartridgeDir: string;
  manifestPath: string;
}

export interface CartridgeCache {
  /** Absolute path of the cache root. */
  readonly rootDir: string;
  /** Layout paths for a given id/version. Pure; no I/O. */
  paths(id: string, version: string): CartridgeCachePaths;
  /** Whether an id@version is fully present (manifest readable + weights file exists). */
  isPresent(id: string, version: string): Promise<boolean>;
  /** Enumerate every id@version in the cache. Does not validate cartridges. */
  list(): Promise<CartridgeCacheListEntry[]>;
}

/**
 * Pure-path helper: given a cache root + id + version, return the layout.
 * Used internally by cache adapters; exported so catalog consumers can predict
 * where a cartridge will land before pulling.
 */
export function defaultCacheLayout(
  rootDir: string,
  id: string,
  version: string,
  joinPath: (...parts: string[]) => string,
): CartridgeCachePaths {
  const cartridgeDir = joinPath(rootDir, id, version);
  return {
    cartridgeDir,
    manifestPath: joinPath(cartridgeDir, 'manifest.json'),
  };
}
