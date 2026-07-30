// Node-only entry point for machineai-activation.
//
// These helpers depend on `node:fs`, `node:path`, `node:crypto`, etc., and
// must NOT be re-exported from the browser-safe main barrel (src/index.ts).
// Apps running on Capacitor / browsers / RN never need these — they consume
// pre-resolved cartridges via runtime adapters. Tooling that does (CLI,
// scripts, packagers) imports from `machineai-activation/node`.

export { createNodeCartridgeFileSystem } from './cartridge/nodeFs';
export { createNodeCartridgeZipAdapter } from './cartridge/nodeZip';
export {
  packCartridge,
  type PackCartridgeOptions,
  type PackCartridgeResult,
} from './cartridge/nodePackCartridge';
export {
  unpackCartridge,
  type UnpackCartridgeOptions,
  type UnpackCartridgeResult,
} from './cartridge/nodeUnpackCartridge';

export {
  createNodeCartridgeCache,
  type NodeCartridgeCacheOptions,
} from './catalog/nodeCartridgeCache';
export {
  downloadAndUnpackCartridge,
  type DownloadAndUnpackOptions,
  type DownloadAndUnpackResult,
} from './catalog/nodeDownloadCartridge';
export {
  createNodeCartridgeResolver,
  type NodeCartridgeResolverOptions,
} from './catalog/nodeCartridgeResolver';

// llama-server process management. Spawns the binary, waits for the model to
// load, and hands back an ActivationRuntime pointed at it. The portable adapter
// itself (`llamaServerRuntime`) is exported from the main barrel.
export {
  closePooledLlamaServer,
  discoverLlamaServer,
  ensureLlamaServer,
  readVendoredAcceleration,
  startLlamaServer,
  type LlamaServerHandle,
  type StartLlamaServerOptions,
} from './runtime/nodeLlamaServer';

// Obtaining that binary in the first place, for hosts that would rather do it in
// code than tell a user to run `machine fetch-runtime`.
export {
  fetchLlamaServer,
  resolveLlamaTarget,
  supportedLlamaHosts,
  type FetchLlamaServerOptions,
  type FetchLlamaServerResult,
  type LlamaServerTarget,
} from './runtime/fetchLlamaServer';
