import assert from 'node:assert/strict';

import {
  CatalogFetchError,
  type CatalogFetcher,
  type CatalogFetchResponse,
  fetchCatalog,
} from '../../src/catalog';
import { test } from '../_harness';
import { sampleCatalog } from './_fixtures';

function okResponse(body: string): CatalogFetchResponse {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
  };
}

function errorResponse(status: number, statusText = ''): CatalogFetchResponse {
  return {
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(''),
  };
}

test('fetchCatalog parses a valid JSON catalog via injected fetch', async () => {
  const body = JSON.stringify(sampleCatalog());
  let capturedUrl: string | undefined;
  const fetcher: CatalogFetcher = async (url) => {
    capturedUrl = url;
    return okResponse(body);
  };

  const catalog = await fetchCatalog('https://example.invalid/catalog.json', { fetch: fetcher });
  assert.equal(capturedUrl, 'https://example.invalid/catalog.json');
  assert.equal(catalog.entries.length, 1);
});

test('fetchCatalog throws CatalogFetchError on non-2xx response', async () => {
  const fetcher: CatalogFetcher = async () => errorResponse(404, 'Not Found');
  await assert.rejects(
    fetchCatalog('https://example.invalid/catalog.json', { fetch: fetcher }),
    (err: unknown) => err instanceof CatalogFetchError && /404/.test(err.message),
  );
});

test('fetchCatalog throws CatalogFetchError on malformed JSON body', async () => {
  const fetcher: CatalogFetcher = async () => okResponse('{ not json');
  await assert.rejects(
    fetchCatalog('https://example.invalid/catalog.json', { fetch: fetcher }),
    (err: unknown) => err instanceof CatalogFetchError && /not valid JSON/.test(err.message),
  );
});

test('fetchCatalog throws CatalogFetchError on invalid catalog shape', async () => {
  const fetcher: CatalogFetcher = async () =>
    okResponse(JSON.stringify({ entries: 'nope' }));
  await assert.rejects(
    fetchCatalog('https://example.invalid/catalog.json', { fetch: fetcher }),
    (err: unknown) => err instanceof CatalogFetchError && /Invalid catalog/.test(err.message),
  );
});

test('fetchCatalog surfaces network errors as CatalogFetchError', async () => {
  const fetcher: CatalogFetcher = async () => {
    throw new Error('ECONNREFUSED');
  };
  await assert.rejects(
    fetchCatalog('https://example.invalid/catalog.json', { fetch: fetcher }),
    (err: unknown) =>
      err instanceof CatalogFetchError && /Failed to fetch catalog/.test(err.message),
  );
});
