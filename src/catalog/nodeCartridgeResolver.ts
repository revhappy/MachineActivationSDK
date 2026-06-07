import { loadCartridge } from '../cartridge/loadCartridge';
import { createNodeCartridgeFileSystem } from '../cartridge/nodeFs';
import type { LoadedCartridge } from '../cartridge/types';

import type { CartridgeCache } from './cartridgeCache';
import { type CatalogFetcher, fetchCatalog } from './fetchCatalog';
import { createNodeCartridgeCache } from './nodeCartridgeCache';
import { downloadAndUnpackCartridge } from './nodeDownloadCartridge';
import { CartridgeResolveError, resolveCartridgeEntry } from './resolveCartridge';
import type {
  CartridgeResolver,
  CartridgeSpec,
  Catalog,
  DownloadProgress,
} from './types';

export interface NodeCartridgeResolverOptions {
  /** Cache instance. Defaults to `createNodeCartridgeCache()`. */
  cache?: CartridgeCache;
  /**
   * Catalog URL used when a cartridge is missing from cache. Required if
   * `autoPull` is true. Can also be a pre-fetched `Catalog` object.
   */
  catalogUrl?: string;
  catalog?: Catalog;
  /**
   * When true, download missing cartridges automatically on resolve. When
   * false (the default), throws a helpful error telling the user to
   * `machine pull`.
   */
  autoPull?: boolean;
  /** Custom catalog fetcher. Defaults to `globalThis.fetch`-backed. */
  catalogFetch?: CatalogFetcher;
  /** Custom download fetcher. Defaults to `globalThis.fetch`-backed. */
  downloadFetch?: Parameters<typeof downloadAndUnpackCartridge>[0]['fetch'];
  onProgress?(progress: DownloadProgress): void;
}

/**
 * Compose the pieces — cache lookup → (optional) catalog fetch → (optional)
 * download → `loadCartridge` — into a single `CartridgeResolver` suitable
 * for `createMachine({ cartridgeResolver })`.
 */
export function createNodeCartridgeResolver(
  options: NodeCartridgeResolverOptions = {},
): CartridgeResolver {
  const cache = options.cache ?? createNodeCartridgeCache();
  const fs = createNodeCartridgeFileSystem();

  return async function resolve(spec: CartridgeSpec): Promise<LoadedCartridge> {
    const listed = await cache.list();
    const cached = findBestCached(listed, spec);

    if (cached) {
      return loadCartridge(cached.cartridgeDir, { fs });
    }

    if (!options.autoPull) {
      throw new CartridgeResolveError(
        `Cartridge "${versionLabel(spec)}" is not in the local cache. `
          + 'Run `machine pull ' + versionLabel(spec) + '` first, or pass '
          + '`autoPull: true` to createNodeCartridgeResolver.',
      );
    }

    const catalog = options.catalog ?? await loadCatalog(options);
    const { entry } = resolveCartridgeEntry(catalog, spec);

    const downloadOpts: Parameters<typeof downloadAndUnpackCartridge>[0] = {
      entry,
      cache,
    };
    if (options.downloadFetch) downloadOpts.fetch = options.downloadFetch;
    if (options.onProgress) downloadOpts.onProgress = options.onProgress;

    const result = await downloadAndUnpackCartridge(downloadOpts);
    return loadCartridge(result.cartridgeDir, { fs });
  };
}

async function loadCatalog(options: NodeCartridgeResolverOptions): Promise<Catalog> {
  if (options.catalog) return options.catalog;
  if (!options.catalogUrl) {
    throw new CartridgeResolveError(
      'autoPull requires `catalogUrl` or a pre-fetched `catalog` on createNodeCartridgeResolver.',
    );
  }
  const fetchOpts: Parameters<typeof fetchCatalog>[1] = {};
  if (options.catalogFetch) fetchOpts.fetch = options.catalogFetch;
  return fetchCatalog(options.catalogUrl, fetchOpts);
}

function findBestCached(
  listed: Awaited<ReturnType<CartridgeCache['list']>>,
  spec: CartridgeSpec,
): { cartridgeDir: string } | undefined {
  const matches = listed.filter((l) => l.id === spec.id);
  if (matches.length === 0) return undefined;
  if (spec.version !== undefined) {
    return matches.find((m) => m.version === spec.version);
  }
  // Highest version string, loosely sorted.
  matches.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  return matches[matches.length - 1];
}

function versionLabel(spec: CartridgeSpec): string {
  return spec.version ? `${spec.id}@${spec.version}` : spec.id;
}
