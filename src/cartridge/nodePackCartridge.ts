import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { join as pathJoin, resolve as pathResolve } from 'node:path';

import { parseCartridgeManifest } from './manifestSchema';
import type { CartridgeManifest } from './types';
import type { CartridgeZipAdapter, CartridgeZipEntry } from './zipAdapter';

const DEFAULT_SKIP = new Set([
  '.DS_Store',
  'Thumbs.db',
  '.git',
  '.gitignore',
  '.gitattributes',
  '.svn',
  '.hg',
  'node_modules',
]);

export interface PackCartridgeOptions {
  /** Zip writer adapter. Use `createNodeCartridgeZipAdapter()` in Node. */
  zip: CartridgeZipAdapter;
  /** Manifest filename inside the cartridge root. Defaults to "manifest.json". */
  manifestFileName?: string;
  /**
   * Recompute and inject `weights.sizeBytes` + `weights.sha256` from the actual
   * weights file before packing. Default: true. Set to false if the manifest's
   * declared values are authoritative (e.g. signed builds).
   */
  rehash?: boolean;
  /** Extra file/directory names to skip in addition to the OS-junk defaults. */
  skipNames?: readonly string[];
}

export interface PackCartridgeResult {
  outputPath: string;
  manifest: CartridgeManifest;
  /** Files that were written into the archive (relative paths, forward slash). */
  entries: string[];
  weightsSha256: string;
  weightsSizeBytes: number;
}

/**
 * Pack a cartridge directory into a `.mcart` zip. Streams weights via
 * `node:crypto.createHash` so multi-GB models don't sit in memory. Rewrites
 * the manifest in-archive to embed the recomputed sha256/size when `rehash`
 * is true (the default).
 */
export async function packCartridge(
  rootDir: string,
  outputPath: string,
  options: PackCartridgeOptions,
): Promise<PackCartridgeResult> {
  const manifestFileName = options.manifestFileName ?? 'manifest.json';
  const rehash = options.rehash ?? true;
  const skip = new Set([...DEFAULT_SKIP, ...(options.skipNames ?? [])]);

  const resolvedRoot = pathResolve(rootDir);
  const manifestPath = pathJoin(resolvedRoot, manifestFileName);

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Failed to read manifest at ${manifestPath}: ${errorMessage(error)}`,
    );
  }

  const parsed = parseCartridgeManifest(rawManifest);
  if (!parsed.valid) {
    const detail = parsed.issues.map((i) => `${i.path || '<root>'}: ${i.message}`).join('; ');
    throw new Error(`Invalid manifest: ${detail}`);
  }
  let manifest = parsed.manifest;

  const weightsAbsPath = pathJoin(resolvedRoot, manifest.weights.path);
  if (!fileExistsSync(weightsAbsPath)) {
    throw new Error(`Weights file missing: ${weightsAbsPath}`);
  }

  const weightsSizeBytes = statSync(weightsAbsPath).size;
  const weightsSha256 = rehash
    ? await streamSha256(weightsAbsPath)
    : manifest.weights.sha256;

  if (rehash) {
    manifest = {
      ...manifest,
      weights: {
        ...manifest.weights,
        sizeBytes: weightsSizeBytes,
        sha256: weightsSha256,
      },
    };
  }

  const filePaths = walkFiles(resolvedRoot, skip);
  const entries: CartridgeZipEntry[] = [];
  const entryNames: string[] = [];

  for (const absPath of filePaths) {
    const rel = toForwardSlashRelative(resolvedRoot, absPath);
    if (rel === manifestFileName) {
      // Replace with rewritten manifest (always serialize, even when rehash=false,
      // so the in-archive copy is canonical).
      const json = JSON.stringify(manifest, null, 2);
      entries.push({ relativePath: rel, bytes: new TextEncoder().encode(json) });
    } else {
      entries.push({ relativePath: rel, sourcePath: absPath });
    }
    entryNames.push(rel);
  }

  const resolvedOutput = pathResolve(outputPath);
  await options.zip.createZip(resolvedOutput, entries);

  return {
    outputPath: resolvedOutput,
    manifest,
    entries: entryNames,
    weightsSha256,
    weightsSizeBytes,
  };
}

function walkFiles(rootDir: string, skipNames: ReadonlySet<string>): string[] {
  const result: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (skipNames.has(entry.name)) continue;
      const abs = pathJoin(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        result.push(abs);
      }
    }
  }
  result.sort();
  return result;
}

function toForwardSlashRelative(root: string, abs: string): string {
  const rel = abs.startsWith(root) ? abs.slice(root.length) : abs;
  return rel.replace(/^[\\/]+/, '').split(/[\\/]+/).join('/');
}

function fileExistsSync(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

async function streamSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
