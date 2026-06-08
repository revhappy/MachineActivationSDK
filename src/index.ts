export * from './activation/activationAdapter';
export * from './activation/activationConfig';
export * from './activation/activationContract';
export * from './activation/activationManager';
export * from './activation/capabilityRegistry';
export * from './activation/capabilityInference';
export * from './activation/customAppSdk';
export * from './activation/observedCapabilities';
export * from './activation/activationPlanning';
export * from './activation/runtimeSelection';
export * from './activation/activationStructuredOutput';
export * from './activation/activationSetup';
export * from './framework/createMachineFramework';
export * from './framework/index';

// Drop-in cartridge-ready API (M1 + M7). See CARTRIDGE_SDK_ROADMAP.md.
export {
  createMachine,
  generateText,
  streamText,
  generateObject,
  tool,
  jsonSchemaToGbnf,
  zodToJsonSchema,
  zodSchema,
} from './sdk';
export type {
  CommonGenerationOptions,
  CreateMachineOptions,
  FinishReason,
  GenerateObjectOptions,
  GenerateObjectResult,
  GenerateTextOptions,
  GenerateTextResult,
  JsonSchema,
  JsonSchemaPrimitiveType,
  Machine,
  MachineModel,
  ModelSpec,
  SchemaLike,
  StepResult,
  StreamTextOptions,
  StreamTextResult,
  ToolDefinition,
  UsageInfo,
  ZodLikeSchema,
} from './sdk';

// Cartridge format (M2 + M3). See CARTRIDGE_SDK_ROADMAP.md.
// Node-only helpers (createNode*, packCartridge, unpackCartridge) live in
// `@revhappy/activation-sdk/node` so this barrel is safe to import from
// Vite/Webpack/RN/Capacitor without pulling node:fs into the bundle.
export {
  CARTRIDGE_SCHEMA_VERSION,
  CartridgeLoadError,
  cartridgeToActivationInput,
  defaultSha256Hasher,
  loadCartridge,
  parseCartridgeManifest,
  validateCartridge,
} from './cartridge';
export type {
  CartridgeAssets,
  CartridgeAuthor,
  CartridgeCapabilities,
  CartridgeChatTemplate,
  CartridgeFileSystem,
  CartridgeHasher,
  CartridgeLoadOptions,
  CartridgeManifest,
  CartridgePresetExample,
  CartridgePresetSystemPrompt,
  CartridgePresets,
  CartridgeRequirements,
  CartridgeToActivationInputOptions,
  CartridgeValidationIssue,
  CartridgeValidationOptions,
  CartridgeValidationResult,
  CartridgeWeightFormat,
  CartridgeWeights,
  CartridgeZipAdapter,
  CartridgeZipEntry,
  LoadedCartridge,
  ManifestValidationIssue,
  ManifestValidationResult,
} from './cartridge';

// Catalog (M4). See CARTRIDGE_SDK_ROADMAP.md.
// Node-only helpers (createNodeCartridgeCache, createNodeCartridgeResolver,
// downloadAndUnpackCartridge) live in `@revhappy/activation-sdk/node`.
export {
  CATALOG_SCHEMA_VERSION,
  CartridgeDownloadError,
  CartridgeResolveError,
  CatalogFetchError,
  defaultCacheLayout,
  downloadCartridgeToStream,
  fetchCatalog,
  parseCatalog,
  resolveCartridgeEntry,
} from './catalog';
export type {
  Catalog,
  CatalogAuthor,
  CatalogEntry,
  CatalogFetcher,
  CatalogFetchResponse,
  CatalogValidationIssue,
  CatalogValidationResult,
  CartridgeCache,
  CartridgeCacheListEntry,
  CartridgeCachePaths,
  CartridgeResolver,
  CartridgeSpec,
  DownloadCartridgeOptions,
  DownloadCartridgeResult,
  DownloadFetcher,
  DownloadProgress,
  DownloadResponse,
  FetchCatalogOptions,
  ResolvedCatalogEntry,
  StreamingHasher,
} from './catalog';
