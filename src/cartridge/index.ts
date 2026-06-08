export {
  CARTRIDGE_SCHEMA_VERSION,
  type CartridgeAssets,
  type CartridgeAuthor,
  type CartridgeCapabilities,
  type CartridgeChatTemplate,
  type CartridgeManifest,
  type CartridgePresets,
  type CartridgePresetExample,
  type CartridgePresetSystemPrompt,
  type CartridgeRequirements,
  type CartridgeWeightFormat,
  type CartridgeWeights,
  type LoadedCartridge,
} from './types';

export {
  parseCartridgeManifest,
  type ManifestValidationIssue,
  type ManifestValidationResult,
} from './manifestSchema';

export {
  CartridgeLoadError,
  loadCartridge,
  type CartridgeLoadOptions,
} from './loadCartridge';

export {
  validateCartridge,
  defaultSha256Hasher,
  type CartridgeHasher,
  type CartridgeValidationIssue,
  type CartridgeValidationOptions,
  type CartridgeValidationResult,
} from './validateCartridge';

export {
  cartridgeToActivationInput,
  type CartridgeToActivationInputOptions,
} from './toActivationInput';

export type { CartridgeFileSystem } from './fileSystem';

export type {
  CartridgeZipAdapter,
  CartridgeZipEntry,
} from './zipAdapter';

// Node-only helpers (createNodeCartridgeFileSystem, createNodeCartridgeZipAdapter,
// packCartridge, unpackCartridge) live in `machineai-activation/node` so this
// barrel stays browser-safe — importing it from a Vite/Webpack/Rollup app must
// not pull `node:fs`, `node:path`, `node:crypto`, etc. into the bundle graph.
