import type { Catalog, CatalogEntry, CartridgeSpec, ResolvedCatalogEntry } from './types';

export class CartridgeResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CartridgeResolveError';
  }
}

/**
 * Pick the catalog entry matching `{ id, version? }`.
 *
 * - No version: returns the entry with the highest-sorting version string for
 *   that id.
 * - With version: returns the entry with an exact version match, or throws.
 *
 * Semver-range resolution (`^1.2.3`, `>=2.0.0`) is deferred to a later
 * milestone; v1 only supports exact match + latest.
 */
export function resolveCartridgeEntry(
  catalog: Catalog,
  spec: CartridgeSpec,
): ResolvedCatalogEntry {
  const candidates = catalog.entries.filter((e) => e.id === spec.id);
  if (candidates.length === 0) {
    throw new CartridgeResolveError(
      `No catalog entry found for id "${spec.id}"`,
    );
  }

  if (spec.version !== undefined) {
    const exact = candidates.find((e) => e.version === spec.version);
    if (!exact) {
      const available = candidates.map((e) => e.version).join(', ');
      throw new CartridgeResolveError(
        `No catalog entry for ${spec.id}@${spec.version} (available: ${available})`,
      );
    }
    return { catalog, entry: exact };
  }

  const latest = pickLatest(candidates);
  return { catalog, entry: latest };
}

function pickLatest(entries: CatalogEntry[]): CatalogEntry {
  const sorted = [...entries].sort((a, b) => compareVersions(a.version, b.version));
  return sorted[sorted.length - 1];
}

/**
 * Loose semver-ish comparison. Splits on `.` and `-`, compares numeric parts
 * numerically and text parts lexicographically. Not RFC-compliant semver; good
 * enough to pick "1.2.0" over "1.0.0" and "2.0.0-beta" < "2.0.0".
 */
function compareVersions(a: string, b: string): number {
  const [aCore, aPre] = splitPrerelease(a);
  const [bCore, bPre] = splitPrerelease(b);

  const aParts = aCore.split('.');
  const bParts = bCore.split('.');
  const n = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < n; i += 1) {
    const av = aParts[i] ?? '0';
    const bv = bParts[i] ?? '0';
    const an = Number(av);
    const bn = Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      if (an !== bn) return an - bn;
    } else if (av !== bv) {
      return av < bv ? -1 : 1;
    }
  }

  // Core equal: no prerelease > has prerelease (per semver).
  if (aPre === '' && bPre === '') return 0;
  if (aPre === '') return 1;
  if (bPre === '') return -1;
  return aPre < bPre ? -1 : aPre > bPre ? 1 : 0;
}

function splitPrerelease(v: string): [string, string] {
  const i = v.indexOf('-');
  if (i < 0) return [v, ''];
  return [v.slice(0, i), v.slice(i + 1)];
}
