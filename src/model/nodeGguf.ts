import { closeSync, openSync, readSync, statSync } from 'node:fs';

import {
  GgufTruncatedError,
  parseGguf,
  summarizeGguf,
  type GgufMetadata,
  type GgufSummary,
  type ParseGgufOptions,
} from './gguf';

/**
 * Node-side file reading for the GGUF parser. Kept in a `node*`-prefixed file
 * and out of the barrels so React Native / browser bundles never pull
 * `node:fs` into their dependency graph.
 */

const INITIAL_PREFIX_BYTES = 4 * 1024 * 1024;
const MAX_PREFIX_BYTES = 256 * 1024 * 1024;

export interface ReadGgufOptions extends ParseGgufOptions {
  /** Starting prefix size. Grows automatically if the header is bigger. */
  initialPrefixBytes?: number;
}

/**
 * Read and parse a GGUF header without loading the whole (multi-GB) file.
 *
 * We read a prefix and grow it if the header turns out to be longer — big
 * tokenizer vocabularies push the KV section past a few MB, and tensor
 * records add more. Doubling from 4 MB gets there in a couple of reads
 * without ever mapping the weights.
 */
export function readGgufMetadata(
  filePath: string,
  options: ReadGgufOptions = {},
): GgufMetadata {
  const fileSize = statSync(filePath).size;
  let prefixSize = Math.min(
    options.initialPrefixBytes ?? INITIAL_PREFIX_BYTES,
    fileSize,
  );

  const fd = openSync(filePath, 'r');
  try {
    for (;;) {
      const buffer = Buffer.allocUnsafe(prefixSize);
      const bytesRead = readSync(fd, buffer, 0, prefixSize, 0);
      const view = new Uint8Array(
        buffer.buffer,
        buffer.byteOffset,
        bytesRead,
      );

      try {
        return parseGguf(view, options);
      } catch (error) {
        const atEndOfFile = prefixSize >= fileSize;
        if (!(error instanceof GgufTruncatedError) || atEndOfFile) {
          throw error;
        }
        if (prefixSize >= MAX_PREFIX_BYTES) {
          throw new Error(
            `GGUF header exceeds ${MAX_PREFIX_BYTES} bytes in ${filePath}; refusing to read further.`,
          );
        }
        prefixSize = Math.min(prefixSize * 2, fileSize, MAX_PREFIX_BYTES);
      }
    }
  } finally {
    closeSync(fd);
  }
}

export function readGgufSummary(
  filePath: string,
  options: ReadGgufOptions = {},
): GgufSummary {
  return summarizeGguf(readGgufMetadata(filePath, options));
}
