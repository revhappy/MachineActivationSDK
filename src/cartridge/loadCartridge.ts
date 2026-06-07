import type { CartridgeFileSystem } from './fileSystem';
import { parseCartridgeManifest } from './manifestSchema';
import type { LoadedCartridge } from './types';

export interface CartridgeLoadOptions {
  /** Filesystem adapter. Use `createNodeCartridgeFileSystem()` in Node. */
  fs: CartridgeFileSystem;
  /** Manifest filename inside the cartridge root. Defaults to "manifest.json". */
  manifestFileName?: string;
}

export class CartridgeLoadError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(message: string, issues: { path: string; message: string }[] = []) {
    super(message);
    this.name = 'CartridgeLoadError';
    this.issues = issues;
  }
}

/**
 * Load a cartridge from an extracted directory. Does not verify sha256
 * (call `validateCartridge` separately for that) — this is the fast, strict
 * path used at app startup.
 */
export async function loadCartridge(
  rootDir: string,
  options: CartridgeLoadOptions,
): Promise<LoadedCartridge> {
  const { fs } = options;
  const manifestFileName = options.manifestFileName ?? 'manifest.json';

  const resolvedRoot = fs.resolvePath(rootDir);
  const manifestPath = fs.joinPath(resolvedRoot, manifestFileName);

  if (!(await fs.fileExists(manifestPath))) {
    throw new CartridgeLoadError(
      `Cartridge manifest not found at ${manifestPath}`,
    );
  }

  let raw: unknown;
  try {
    const text = await fs.readTextFile(manifestPath);
    raw = JSON.parse(text);
  } catch (error) {
    throw new CartridgeLoadError(
      `Failed to parse ${manifestFileName}: ${errorMessage(error)}`,
    );
  }

  const result = parseCartridgeManifest(raw);
  if (!result.valid) {
    throw new CartridgeLoadError(
      `Invalid cartridge manifest at ${manifestPath}`,
      result.issues,
    );
  }

  const manifest = result.manifest;
  const weightsPath = fs.joinPath(resolvedRoot, manifest.weights.path);
  if (!(await fs.fileExists(weightsPath))) {
    throw new CartridgeLoadError(
      `Weights file missing: ${weightsPath} (declared in manifest.weights.path)`,
    );
  }

  let projectorPath: string | undefined;
  if (manifest.weights.projectorPath) {
    const resolvedProjector = fs.joinPath(resolvedRoot, manifest.weights.projectorPath);
    if (!(await fs.fileExists(resolvedProjector))) {
      throw new CartridgeLoadError(
        `Projector file missing: ${resolvedProjector} (declared in manifest.weights.projectorPath)`,
      );
    }
    projectorPath = resolvedProjector;
  }

  return projectorPath
    ? { manifest, rootDir: resolvedRoot, weightsPath, projectorPath }
    : { manifest, rootDir: resolvedRoot, weightsPath };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
