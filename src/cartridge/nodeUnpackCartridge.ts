import { resolve as pathResolve } from 'node:path';

import { loadCartridge } from './loadCartridge';
import { createNodeCartridgeFileSystem } from './nodeFs';
import type { LoadedCartridge } from './types';
import type { CartridgeZipAdapter } from './zipAdapter';

export interface UnpackCartridgeOptions {
  /** Zip reader adapter. Use `createNodeCartridgeZipAdapter()` in Node. */
  zip: CartridgeZipAdapter;
  /**
   * After extracting, run `loadCartridge` to fail-fast on a corrupt or
   * incomplete archive. Default: true.
   */
  verify?: boolean;
}

export interface UnpackCartridgeResult {
  outputDir: string;
  cartridge?: LoadedCartridge;
}

/**
 * Extract a `.mcart` zip into `outputDir`. When `verify` is true (the default)
 * the extracted tree is run through `loadCartridge` so a corrupt archive
 * surfaces immediately.
 *
 * Node-only — imports `node:path`. Do not call from React Native.
 */
export async function unpackCartridge(
  zipPath: string,
  outputDir: string,
  options: UnpackCartridgeOptions,
): Promise<UnpackCartridgeResult> {
  const verify = options.verify ?? true;
  const resolvedOut = pathResolve(outputDir);

  await options.zip.extractZip(zipPath, resolvedOut);

  if (!verify) {
    return { outputDir: resolvedOut };
  }

  const cartridge = await loadCartridge(resolvedOut, {
    fs: createNodeCartridgeFileSystem(),
  });
  return { outputDir: resolvedOut, cartridge };
}
