import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  CartridgeDownloadError,
  type DownloadFetcher,
  type DownloadResponse,
  type StreamingHasher,
  downloadCartridgeToStream,
} from '../../src/catalog';
import { test } from '../_harness';
import { sampleEntry } from './_fixtures';

function chunkedResponse(chunks: Uint8Array[], ok = true, status = 200): DownloadResponse {
  let i = 0;
  return {
    ok,
    status,
    body: {
      getReader() {
        return {
          read() {
            if (i >= chunks.length) {
              return Promise.resolve({ done: true, value: undefined });
            }
            const value = chunks[i];
            i += 1;
            return Promise.resolve({ done: false, value });
          },
        };
      },
    },
  };
}

function makeHasher(): StreamingHasher {
  const h = createHash('sha256');
  return {
    update(b) {
      h.update(b);
    },
    digestHex() {
      return h.copy().digest('hex');
    },
  };
}

test('downloadCartridgeToStream streams chunks, verifies sha256, returns digest', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const entry = sampleEntry({ sha256: sha, downloadSizeBytes: bytes.length });

  const received: number[] = [];
  const fetcher: DownloadFetcher = async () =>
    chunkedResponse([bytes.subarray(0, 4), bytes.subarray(4, 8), bytes.subarray(8)]);

  const result = await downloadCartridgeToStream({
    entry,
    fetch: fetcher,
    hasher: makeHasher(),
    writeChunk(chunk) {
      for (const b of chunk) received.push(b);
    },
  });
  assert.equal(result.receivedBytes, bytes.length);
  assert.equal(result.sha256, sha);
  assert.deepEqual(received, Array.from(bytes));
});

test('downloadCartridgeToStream throws on sha256 mismatch', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const entry = sampleEntry({ sha256: '0'.repeat(64), downloadSizeBytes: bytes.length });

  const fetcher: DownloadFetcher = async () => chunkedResponse([bytes]);

  await assert.rejects(
    downloadCartridgeToStream({
      entry,
      fetch: fetcher,
      hasher: makeHasher(),
      writeChunk() {
        /* discard */
      },
    }),
    (err: unknown) => err instanceof CartridgeDownloadError && /sha256 mismatch/.test(err.message),
  );
});

test('downloadCartridgeToStream throws on non-2xx response', async () => {
  const entry = sampleEntry();
  const fetcher: DownloadFetcher = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    body: null,
  });
  await assert.rejects(
    downloadCartridgeToStream({
      entry,
      fetch: fetcher,
      writeChunk() {},
    }),
    (err: unknown) => err instanceof CartridgeDownloadError && /500/.test(err.message),
  );
});

test('downloadCartridgeToStream throws when response has no body', async () => {
  const entry = sampleEntry();
  const fetcher: DownloadFetcher = async () => ({
    ok: true,
    status: 200,
    body: null,
  });
  await assert.rejects(
    downloadCartridgeToStream({
      entry,
      fetch: fetcher,
      writeChunk() {},
    }),
    (err: unknown) =>
      err instanceof CartridgeDownloadError && /no body stream/.test(err.message),
  );
});

test('downloadCartridgeToStream aborts when signal already triggered', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const entry = sampleEntry({ downloadSizeBytes: bytes.length });
  const fetcher: DownloadFetcher = async () => chunkedResponse([bytes]);

  const ctrl = new AbortController();
  ctrl.abort();

  await assert.rejects(
    downloadCartridgeToStream({
      entry,
      fetch: fetcher,
      writeChunk() {},
      signal: ctrl.signal,
    }),
    (err: unknown) => err instanceof CartridgeDownloadError && /aborted/.test(err.message),
  );
});

test('downloadCartridgeToStream emits progress with clamped fraction', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const entry = sampleEntry({ sha256: sha, downloadSizeBytes: bytes.length });

  const fractions: number[] = [];
  const fetcher: DownloadFetcher = async () =>
    chunkedResponse([bytes.subarray(0, 2), bytes.subarray(2)]);

  await downloadCartridgeToStream({
    entry,
    fetch: fetcher,
    hasher: makeHasher(),
    writeChunk() {},
    onProgress(p) {
      fractions.push(p.fraction);
    },
  });
  assert.deepEqual(fractions, [0.5, 1]);
});
