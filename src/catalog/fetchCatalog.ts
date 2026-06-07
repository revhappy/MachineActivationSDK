import { parseCatalog } from './catalogSchema';
import type { Catalog } from './types';

/**
 * Duck-typed fetch interface — matches the global `fetch` function shape in
 * Node ≥20, browsers, and modern RN. Consumers can pass their own (e.g. for
 * tests or custom retry logic).
 */
export type CatalogFetcher = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<CatalogFetchResponse>;

export interface CatalogFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  text(): Promise<string>;
}

export class CatalogFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogFetchError';
  }
}

export interface FetchCatalogOptions {
  /** Custom fetcher. Defaults to `globalThis.fetch`. */
  fetch?: CatalogFetcher;
  signal?: AbortSignal;
}

/**
 * Fetch and validate a catalog JSON document from a URL. Throws
 * `CatalogFetchError` on network / non-2xx / malformed body.
 */
export async function fetchCatalog(
  url: string,
  options: FetchCatalogOptions = {},
): Promise<Catalog> {
  const fetcher = options.fetch ?? defaultFetcher();
  if (!fetcher) {
    throw new CatalogFetchError(
      'No fetch implementation available — pass `fetch` explicitly for this environment.',
    );
  }

  let response: CatalogFetchResponse;
  try {
    const init: { signal?: AbortSignal } = {};
    if (options.signal !== undefined) init.signal = options.signal;
    response = await fetcher(url, init);
  } catch (error) {
    throw new CatalogFetchError(
      `Failed to fetch catalog from ${url}: ${errorMessage(error)}`,
    );
  }

  if (!response.ok) {
    throw new CatalogFetchError(
      `Catalog fetch returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''} for ${url}`,
    );
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    throw new CatalogFetchError(
      `Failed to read catalog body from ${url}: ${errorMessage(error)}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (error) {
    throw new CatalogFetchError(
      `Catalog body is not valid JSON: ${errorMessage(error)}`,
    );
  }

  const parsed = parseCatalog(raw);
  if (!parsed.valid) {
    const detail = parsed.issues
      .map((i) => `${i.path || '<root>'}: ${i.message}`)
      .join('; ');
    throw new CatalogFetchError(`Invalid catalog at ${url}: ${detail}`);
  }
  return parsed.catalog;
}

function defaultFetcher(): CatalogFetcher | undefined {
  const g = globalThis as typeof globalThis & { fetch?: unknown };
  if (typeof g.fetch !== 'function') return undefined;
  const nativeFetch = g.fetch as (input: string, init?: unknown) => Promise<unknown>;
  return (url, init) =>
    nativeFetch(url, init).then((r) => r as CatalogFetchResponse);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
