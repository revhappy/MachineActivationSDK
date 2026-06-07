/**
 * Minimal filesystem surface the cartridge loader depends on.
 * Consumers inject an implementation — Node, RN, browser-with-OPFS, etc.
 *
 * Node host: use `createNodeCartridgeFileSystem()` from './nodeFs'.
 * Other environments: implement this interface against your host's FS API.
 */
export interface CartridgeFileSystem {
  /** Read a text file as UTF-8. Throws if the file does not exist. */
  readTextFile(path: string): Promise<string>;
  /** Read the whole file as bytes. Throws if the file does not exist. */
  readFileBytes(path: string): Promise<Uint8Array>;
  /** Returns true if a regular file exists at `path`. */
  fileExists(path: string): Promise<boolean>;
  /** Returns the byte size of the file at `path`. */
  fileSize(path: string): Promise<number>;
  /** Join path segments with the host's separator. */
  joinPath(...segments: string[]): string;
  /** Return an absolute version of `path` (resolves "./" and "..") relative to cwd. */
  resolvePath(path: string): string;
}
