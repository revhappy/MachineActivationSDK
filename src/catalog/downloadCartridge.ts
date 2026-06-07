import type { CatalogEntry, DownloadProgress } from './types';

export class CartridgeDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CartridgeDownloadError';
  }
}

/**
 * Duck-typed shape of a streaming fetch response body. Node's global `fetch`
 * returns a Web ReadableStream on `.body`; browsers + modern RN do too.
 */
export interface DownloadResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel?(): Promise<void> | void;
    };
  } | null;
}

export type DownloadFetcher = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<DownloadResponse>;

/**
 * Streaming sha256 hasher. Consumers provide an update-then-digest object so
 * the portable core doesn't need to know which crypto library is available.
 */
export interface StreamingHasher {
  update(bytes: Uint8Array): void;
  digestHex(): string;
}

export interface DownloadCartridgeOptions {
  entry: CatalogEntry;
  fetch: DownloadFetcher;
  /** Called with each streamed chunk in order. Must not buffer or drop chunks. */
  writeChunk(chunk: Uint8Array): Promise<void> | void;
  /** Optional streaming sha256 hasher. If omitted, caller is responsible for verification. */
  hasher?: StreamingHasher;
  onProgress?(progress: DownloadProgress): void;
  signal?: AbortSignal;
}

export interface DownloadCartridgeResult {
  receivedBytes: number;
  /** Lowercase hex sha256, or `undefined` if no hasher was provided. */
  sha256?: string;
}

/**
 * Stream a cartridge's `.mcart` bytes from `entry.downloadUrl` through
 * `writeChunk`, updating `hasher` as bytes pass by. Verifies the final sha256
 * against `entry.sha256` when a hasher is provided; throws
 * `CartridgeDownloadError` on mismatch.
 */
export async function downloadCartridgeToStream(
  options: DownloadCartridgeOptions,
): Promise<DownloadCartridgeResult> {
  const { entry, fetch, writeChunk, hasher, onProgress, signal } = options;

  let response: DownloadResponse;
  try {
    const init: { signal?: AbortSignal } = {};
    if (signal !== undefined) init.signal = signal;
    response = await fetch(entry.downloadUrl, init);
  } catch (error) {
    throw new CartridgeDownloadError(
      `Failed to download ${entry.id}@${entry.version}: ${errorMessage(error)}`,
    );
  }

  if (!response.ok) {
    throw new CartridgeDownloadError(
      `Download returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''} for ${entry.downloadUrl}`,
    );
  }
  if (!response.body) {
    throw new CartridgeDownloadError(
      `Download response for ${entry.downloadUrl} has no body stream`,
    );
  }

  const reader = response.body.getReader();
  const total = entry.downloadSizeBytes;
  let received = 0;

  try {
    for (;;) {
      if (signal?.aborted) {
        throw new CartridgeDownloadError(
          `Download of ${entry.id}@${entry.version} aborted`,
        );
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      if (hasher) hasher.update(value);
      await writeChunk(value);
      received += value.length;

      if (onProgress) {
        const fraction = total > 0 ? Math.min(1, received / total) : 0;
        onProgress({ receivedBytes: received, totalBytes: total, fraction });
      }
    }
  } catch (error) {
    try {
      await reader.cancel?.();
    } catch {
      /* ignore */
    }
    if (error instanceof CartridgeDownloadError) throw error;
    throw new CartridgeDownloadError(
      `Download of ${entry.id}@${entry.version} failed mid-stream: ${errorMessage(error)}`,
    );
  }

  if (hasher) {
    const actual = hasher.digestHex().toLowerCase();
    const expected = entry.sha256.toLowerCase();
    if (actual !== expected) {
      throw new CartridgeDownloadError(
        `sha256 mismatch for ${entry.id}@${entry.version}: declared ${expected}, computed ${actual}`,
      );
    }
    return { receivedBytes: received, sha256: actual };
  }

  return { receivedBytes: received };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
