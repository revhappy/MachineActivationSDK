import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join as pathJoin, resolve as pathResolve } from 'node:path';

import type { CartridgeFileSystem } from './fileSystem';

/**
 * Node host filesystem adapter. Uses `node:fs/promises` + `node:path`.
 *
 * Do not import this module in a React Native / browser bundle — it pulls in
 * Node built-ins. Consumers in non-Node environments should implement
 * `CartridgeFileSystem` against their host's FS API.
 */
export function createNodeCartridgeFileSystem(): CartridgeFileSystem {
  return {
    async readTextFile(path) {
      return readFile(path, 'utf8');
    },
    async readFileBytes(path) {
      const buffer = await readFile(path);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    },
    async fileExists(path) {
      try {
        await access(path, constants.F_OK);
        const info = await stat(path);
        return info.isFile();
      } catch {
        return false;
      }
    },
    async fileSize(path) {
      const info = await stat(path);
      return info.size;
    },
    joinPath(...segments) {
      return pathJoin(...segments);
    },
    resolvePath(path) {
      return pathResolve(path);
    },
  };
}
