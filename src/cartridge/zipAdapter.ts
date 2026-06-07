/**
 * A single entry to write into a zip archive.
 *
 * `relativePath` is the path inside the archive (always forward-slash separated).
 * Exactly one of `sourcePath` / `bytes` must be set:
 *   - `sourcePath` streams from disk (preferred for large weights).
 *   - `bytes` writes from memory (use for small synthesized files like a rewritten manifest).
 */
export interface CartridgeZipEntry {
  relativePath: string;
  sourcePath?: string;
  bytes?: Uint8Array;
}

/**
 * Pluggable zip reader/writer. The Node adapter (`createNodeCartridgeZipAdapter`)
 * uses yazl/yauzl with streaming I/O; alternative environments can supply their
 * own. Pack/unpack themselves stay free of Node built-ins so they remain
 * portable.
 */
export interface CartridgeZipAdapter {
  /** Stream `entries` into a zip at `outPath`. Overwrites any existing file. */
  createZip(outPath: string, entries: readonly CartridgeZipEntry[]): Promise<void>;
  /** Extract every file in `zipPath` into `outDir` (created if missing). */
  extractZip(zipPath: string, outDir: string): Promise<void>;
}
