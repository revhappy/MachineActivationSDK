import { createHash } from 'node:crypto';
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join as pathJoin } from 'node:path';

import type { CartridgeZipAdapter } from '../cartridge/zipAdapter';
import { createNodeCartridgeZipAdapter } from '../cartridge/nodeZip';
import { unpackCartridge } from '../cartridge/nodeUnpackCartridge';

import { type CartridgeCache } from './cartridgeCache';
import {
  CartridgeDownloadError,
  type DownloadFetcher,
  type DownloadResponse,
  type StreamingHasher,
  downloadCartridgeToStream,
} from './downloadCartridge';
import type { CatalogEntry, DownloadProgress } from './types';

export interface DownloadAndUnpackOptions {
  entry: CatalogEntry;
  cache: CartridgeCache;
  /** Custom fetcher. Defaults to `globalThis.fetch`. */
  fetch?: DownloadFetcher;
  /** Custom zip adapter. Defaults to `createNodeCartridgeZipAdapter()`. */
  zip?: CartridgeZipAdapter;
  onProgress?(progress: DownloadProgress): void;
  signal?: AbortSignal;
  /** If true, re-download and re-unpack even when the cartridge is already present. */
  force?: boolean;
}

export interface DownloadAndUnpackResult {
  cartridgeDir: string;
  receivedBytes: number;
  sha256: string;
  /** True if the cached cartridge was reused and nothing was downloaded. */
  fromCache: boolean;
}

/**
 * Resolve-or-download + unpack. If the cartridge is already present in the
 * cache and `force` is false, this is a no-op that returns the existing path.
 * Otherwise, streams the `.mcart` into a temp file (verifying sha256 chunk by
 * chunk), then extracts it into `cache.paths(id, version).cartridgeDir`: the
 * existing cartridgeDir is replaced only after successful verification.
 */
export async function downloadAndUnpackCartridge(
  options: DownloadAndUnpackOptions,
): Promise<DownloadAndUnpackResult> {
  const { entry, cache, onProgress, signal, force = false } = options;
  const fetch = options.fetch ?? defaultFetcher();
  if (!fetch) {
    throw new CartridgeDownloadError(
      'No fetch implementation available — pass `fetch` explicitly for this environment.',
    );
  }
  const zip = options.zip ?? createNodeCartridgeZipAdapter();

  const { cartridgeDir } = cache.paths(entry.id, entry.version);

  if (!force && (await cache.isPresent(entry.id, entry.version))) {
    return {
      cartridgeDir,
      receivedBytes: 0,
      sha256: entry.sha256.toLowerCase(),
      fromCache: true,
    };
  }

  const tempDir = mkdtempSync(pathJoin(tmpdir(), 'mcart-pull-'));
  const tempArchive = pathJoin(
    tempDir,
    `${safeName(entry.id)}-${safeName(entry.version)}.mcart.partial`,
  );

  const hash = createHash('sha256');
  const hasher: StreamingHasher = {
    update(bytes) {
      hash.update(bytes);
    },
    digestHex() {
      return hash.copy().digest('hex');
    },
  };

  const writeStream = createWriteStream(tempArchive);
  let writeError: unknown;
  writeStream.on('error', (err) => {
    writeError = err;
  });

  try {
    const downloadOptions: Parameters<typeof downloadCartridgeToStream>[0] = {
      entry,
      fetch,
      hasher,
      writeChunk(chunk) {
        return new Promise<void>((resolve, reject) => {
          if (writeError) {
            reject(writeError);
            return;
          }
          const ok = writeStream.write(Buffer.from(chunk));
          if (ok) {
            resolve();
          } else {
            writeStream.once('drain', () => resolve());
          }
        });
      },
    };
    if (onProgress) downloadOptions.onProgress = onProgress;
    if (signal) downloadOptions.signal = signal;

    const result = await downloadCartridgeToStream(downloadOptions);

    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const info = await stat(tempArchive);
    if (info.size !== entry.downloadSizeBytes) {
      throw new CartridgeDownloadError(
        `downloadSizeBytes mismatch for ${entry.id}@${entry.version}: declared ${entry.downloadSizeBytes}, received ${info.size}`,
      );
    }

    await rm(cartridgeDir, { recursive: true, force: true });
    await mkdir(dirname(cartridgeDir), { recursive: true });
    await unpackCartridge(tempArchive, cartridgeDir, {
      zip,
      verify: true,
    });

    return {
      cartridgeDir,
      receivedBytes: result.receivedBytes,
      sha256: result.sha256 ?? entry.sha256.toLowerCase(),
      fromCache: false,
    };
  } finally {
    try {
      writeStream.destroy();
    } catch {
      /* ignore */
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

function defaultFetcher(): DownloadFetcher | undefined {
  const g = globalThis as typeof globalThis & { fetch?: unknown };
  if (typeof g.fetch !== 'function') return undefined;
  const nativeFetch = g.fetch as (input: string, init?: unknown) => Promise<unknown>;
  return (url, init) =>
    nativeFetch(url, init as unknown).then((r) => r as DownloadResponse);
}
