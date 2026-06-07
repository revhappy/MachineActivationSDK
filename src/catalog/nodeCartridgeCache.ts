import { access, constants, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join as pathJoin, resolve as pathResolve } from 'node:path';

import { parseCartridgeManifest } from '../cartridge/manifestSchema';
import { readFile } from 'node:fs/promises';

import {
  type CartridgeCache,
  type CartridgeCacheListEntry,
  type CartridgeCachePaths,
  defaultCacheLayout,
} from './cartridgeCache';

export interface NodeCartridgeCacheOptions {
  /**
   * Cache root directory. Defaults to `~/.machine/cartridges`. If
   * `MACHINE_CACHE_DIR` is set in env, it takes precedence over the default.
   */
  rootDir?: string;
}

/**
 * Node host cache adapter. Uses `node:fs/promises` + `node:os` + `node:path`.
 * Do not import this module in a React Native / browser bundle.
 */
export function createNodeCartridgeCache(
  options: NodeCartridgeCacheOptions = {},
): CartridgeCache {
  const explicitRoot = options.rootDir ?? process.env.MACHINE_CACHE_DIR;
  const rootDir = explicitRoot
    ? pathResolve(explicitRoot)
    : pathJoin(homedir(), '.machine', 'cartridges');

  function paths(id: string, version: string): CartridgeCachePaths {
    return defaultCacheLayout(rootDir, id, version, pathJoin);
  }

  async function isPresent(id: string, version: string): Promise<boolean> {
    const { cartridgeDir, manifestPath } = paths(id, version);
    if (!(await fileExists(manifestPath))) return false;
    // Read manifest to find weights path, then confirm weights file exists.
    try {
      const text = await readFile(manifestPath, 'utf8');
      const raw = JSON.parse(text);
      const parsed = parseCartridgeManifest(raw);
      if (!parsed.valid) return false;
      const weightsPath = pathJoin(cartridgeDir, parsed.manifest.weights.path);
      return fileExists(weightsPath);
    } catch {
      return false;
    }
  }

  async function list(): Promise<CartridgeCacheListEntry[]> {
    if (!(await dirExists(rootDir))) return [];
    const entries: CartridgeCacheListEntry[] = [];
    const idDirs = await readdir(rootDir, { withFileTypes: true });
    for (const idDir of idDirs) {
      if (!idDir.isDirectory()) continue;
      const idAbs = pathJoin(rootDir, idDir.name);
      const versionDirs = await readdir(idAbs, { withFileTypes: true });
      for (const versionDir of versionDirs) {
        if (!versionDir.isDirectory()) continue;
        const cartridgeDir = pathJoin(idAbs, versionDir.name);
        const manifestPath = pathJoin(cartridgeDir, 'manifest.json');
        if (!(await fileExists(manifestPath))) continue;
        entries.push({
          id: idDir.name,
          version: versionDir.name,
          cartridgeDir,
          manifestPath,
        });
      }
    }
    entries.sort((a, b) => (a.id === b.id ? a.version.localeCompare(b.version) : a.id.localeCompare(b.id)));
    return entries;
  }

  return { rootDir, paths, isPresent, list };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    const info = await stat(p);
    return info.isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const info = await stat(p);
    return info.isDirectory();
  } catch {
    return false;
  }
}
