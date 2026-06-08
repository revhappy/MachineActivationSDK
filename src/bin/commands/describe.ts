import { readFileSync } from 'node:fs';
import { dirname, join as pathJoin } from 'node:path';

import { ACTIVATION_CONTRACT_SCHEMA_VERSION } from '../../activation/activationContract';
import { CARTRIDGE_SCHEMA_VERSION } from '../../cartridge/types';
import { CATALOG_SCHEMA_VERSION } from '../../catalog/types';
import { errorln, printJson, println, red } from '../output';

const HELP = `\
machine describe [section] [--pretty]

Emit a single JSON payload describing the full SDK surface — CLI commands,
manifest schema, catalog schema, SDK API, schema versions, and file pointers.
Designed for LLM agents so one read gives everything needed to ship.

Sections (omit for full payload):
  cli           CLI commands with usage + description.
  sdk           Drop-in SDK API (createMachine, generateText, ...).
  manifest      Cartridge manifest fields.
  catalog       Catalog entry + catalog document fields.
  ui            machineai-activation-ui headless React / React Native UI kit.
  scaffolder    create-machineai-app CLI + available templates.
  pointers      File paths an agent should open for more detail.

Flags:
  --pretty      Pretty-print (default); use --compact for single-line JSON.
  --compact     Emit as compact single-line JSON.
  --help        Show this message.
`;

export async function runDescribe(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const compact = argv.includes('--compact');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const section = positional[0];

  const payload = buildPayload();

  let output: unknown = payload;
  if (section) {
    if (!(section in payload)) {
      errorln(red(`describe: unknown section "${section}"`));
      errorln('');
      errorln(HELP);
      return 2;
    }
    output = (payload as unknown as Record<string, unknown>)[section];
  }

  if (compact) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else {
    printJson(output);
  }
  return 0;
}

function readSdkVersion(): string {
  try {
    // dist/bin/commands/describe.js → ../../../package.json
    const pkgPath = pathJoin(dirname(__filename), '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

interface CliDescription {
  name: string;
  usage: string;
  description: string;
}

interface SdkSymbolDescription {
  name: string;
  kind: 'function' | 'type' | 'class' | 'constant';
  signature: string;
  summary: string;
}

interface ManifestFieldDescription {
  path: string;
  type: string;
  required: boolean;
  description: string;
}

interface UiHookDescription {
  name: string;
  signature: string;
  summary: string;
}

interface UiComponentDescription {
  name: string;
  target: 'web' | 'native';
  summary: string;
}

interface UiPackageDescription {
  name: string;
  version: string;
  exports: string[];
  hooks: UiHookDescription[];
  components: UiComponentDescription[];
}

interface ScaffolderTemplateDescription {
  id: string;
  displayName: string;
  description: string;
  target: 'node' | 'expo' | 'react-native' | 'next' | 'electron';
}

interface ScaffolderPackageDescription {
  name: string;
  version: string;
  bin: string;
  usage: string;
  templates: ScaffolderTemplateDescription[];
}

export interface DescribePayload {
  sdkVersion: string;
  schemaVersions: {
    cartridge: string;
    catalog: string;
    activationContract: string;
  };
  shippedMilestones: string[];
  inProgressMilestones: string[];
  weightFormats: string[];
  cli: CliDescription[];
  sdk: SdkSymbolDescription[];
  manifest: { schemaVersion: string; fields: ManifestFieldDescription[] };
  catalog: { schemaVersion: string; fields: ManifestFieldDescription[] };
  ui: UiPackageDescription;
  scaffolder: ScaffolderPackageDescription;
  pointers: Record<string, string>;
}

function buildPayload(): DescribePayload {
  return {
    sdkVersion: readSdkVersion(),
    schemaVersions: {
      cartridge: CARTRIDGE_SCHEMA_VERSION,
      catalog: CATALOG_SCHEMA_VERSION,
      activationContract: ACTIVATION_CONTRACT_SCHEMA_VERSION,
    },
    shippedMilestones: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'],
    inProgressMilestones: [],
    weightFormats: ['gguf', 'litertlm', 'task', 'mlx', 'safetensors'],
    cli: CLI_COMMANDS,
    sdk: SDK_API,
    manifest: { schemaVersion: CARTRIDGE_SCHEMA_VERSION, fields: MANIFEST_FIELDS },
    catalog: { schemaVersion: CATALOG_SCHEMA_VERSION, fields: CATALOG_FIELDS },
    ui: UI_PACKAGE,
    scaffolder: SCAFFOLDER_PACKAGE,
    pointers: POINTERS,
  };
}

const CLI_COMMANDS: CliDescription[] = [
  {
    name: 'init',
    usage: 'machine init <dir> [--force]',
    description: 'Scaffold a new cartridge directory with a placeholder manifest + weights stub.',
  },
  {
    name: 'pack',
    usage: 'machine pack <dir> [--out <file>]',
    description: 'Build a .mcart zip from an extracted cartridge directory. Rehashes weights sha256 + size.',
  },
  {
    name: 'unpack',
    usage: 'machine unpack <file> [--out <dir>]',
    description: 'Extract a .mcart zip into a directory, restoring weights byte-for-byte.',
  },
  {
    name: 'validate',
    usage: 'machine validate <file|dir> [--json]',
    description: 'Validate manifest schema + weights sha256 + size. Exits non-zero on failure.',
  },
  {
    name: 'info',
    usage: 'machine info <file|dir> [--json]',
    description: 'Print a short human-readable summary (id, name, version, weights format, size).',
  },
  {
    name: 'inspect',
    usage: 'machine inspect <file|dir> [--json]',
    description: 'Dump full manifest + file listing + sha256 hashes. Non-zero exit on tampering.',
  },
  {
    name: 'pull',
    usage: 'machine pull <id>[@<version>] [--catalog <url>] [--cache <dir>] [--force]',
    description: 'Download and cache a cartridge from a catalog. Sha256-verified. Atomic: partial pulls never corrupt the cache.',
  },
  {
    name: 'search',
    usage: 'machine search <query> [--catalog <url>] [--json]',
    description: 'Search a catalog by substring match across id, name, description, tags, and categories.',
  },
  {
    name: 'list',
    usage: 'machine list [--cache <dir>] [--json]',
    description: 'List cartridges cached locally under the cache root (default ~/.machine/cartridges).',
  },
  {
    name: 'describe',
    usage: 'machine describe [section] [--compact]',
    description: 'Emit a JSON snapshot of the SDK surface (CLI, manifest schema, catalog schema, SDK API). Agent-readable.',
  },
];

const SDK_API: SdkSymbolDescription[] = [
  {
    name: 'createMachine',
    kind: 'function',
    signature: 'createMachine(options: CreateMachineOptions): Machine',
    summary: 'Construct a Machine bound to a runtime + (optionally) a cartridge resolver. Lazy — no I/O until model() is awaited.',
  },
  {
    name: 'machine.model',
    kind: 'function',
    signature: 'machine.model(spec: ModelSpec): MachineModel',
    summary: 'Resolve a model by filePath or cartridge id. Returns a handle usable by generateText/streamText/generateObject.',
  },
  {
    name: 'generateText',
    kind: 'function',
    signature: 'generateText(options: GenerateTextOptions): Promise<GenerateTextResult>',
    summary: 'Single-shot text generation. Supports tools (ReAct loop), maxSteps, onStepFinish, and grammar-constrained tool routing.',
  },
  {
    name: 'streamText',
    kind: 'function',
    signature: 'streamText(options: StreamTextOptions): StreamTextResult',
    summary: 'Token-streaming text generation. Async iterator over deltas + a final-text promise.',
  },
  {
    name: 'generateObject',
    kind: 'function',
    signature: 'generateObject<T>(options: GenerateObjectOptions<T>): Promise<GenerateObjectResult<T>>',
    summary: 'Typed structured output. When the schema exposes toJsonSchema(), constrains generation via GBNF; otherwise retries on parse failure.',
  },
  {
    name: 'tool',
    kind: 'function',
    signature: 'tool<TArgs, TResult>(def: ToolDefinition<TArgs, TResult>): ToolDefinition<TArgs, TResult>',
    summary: 'Identity helper for TS inference. Returns its argument unchanged.',
  },
  {
    name: 'zodSchema',
    kind: 'function',
    signature: 'zodSchema<T>(zod: ZodLikeSchema<T>): SchemaLike<T>',
    summary: 'Wrap a zod schema into a SchemaLike with toJsonSchema() pre-attached. Zod stays an optional peer dep.',
  },
  {
    name: 'jsonSchemaToGbnf',
    kind: 'function',
    signature: 'jsonSchemaToGbnf(schema: JsonSchema): string',
    summary: 'Convert a portable JSON Schema subset into a llama.cpp GBNF grammar string.',
  },
  {
    name: 'zodToJsonSchema',
    kind: 'function',
    signature: 'zodToJsonSchema(zod: unknown): JsonSchema | null',
    summary: 'Duck-typed Zod → JSON Schema walker. Returns null for unsupported nodes so callers fall back gracefully.',
  },
  {
    name: 'loadCartridge',
    kind: 'function',
    signature: 'loadCartridge(rootDir: string, options?: CartridgeLoadOptions): Promise<LoadedCartridge>',
    summary: 'Read a cartridge directory: parse manifest, resolve weights path. Pluggable CartridgeFileSystem for RN/browser.',
  },
  {
    name: 'packCartridge',
    kind: 'function',
    signature: 'packCartridge(options: PackCartridgeOptions): Promise<PackCartridgeResult>',
    summary: 'Stream a cartridge directory into a .mcart zip. Node-only (imports node:fs). Re-hashes weights.',
  },
  {
    name: 'unpackCartridge',
    kind: 'function',
    signature: 'unpackCartridge(options: UnpackCartridgeOptions): Promise<UnpackCartridgeResult>',
    summary: 'Extract a .mcart zip into a target directory. Node-only.',
  },
  {
    name: 'fetchCatalog',
    kind: 'function',
    signature: 'fetchCatalog(url: string, options?: FetchCatalogOptions): Promise<Catalog>',
    summary: 'Fetch + validate a catalog.json over HTTP. Uses global fetch by default; injectable for tests and RN.',
  },
  {
    name: 'resolveCartridgeEntry',
    kind: 'function',
    signature: 'resolveCartridgeEntry(catalog: Catalog, spec: CartridgeSpec): ResolvedCatalogEntry',
    summary: 'Pick an entry by { id, version? } from a catalog. Without version, returns the highest stable release.',
  },
  {
    name: 'downloadAndUnpackCartridge',
    kind: 'function',
    signature: 'downloadAndUnpackCartridge(options: DownloadAndUnpackOptions): Promise<DownloadAndUnpackResult>',
    summary: 'Stream a cartridge into a write-stream, verify sha256, atomically install into a cache directory.',
  },
  {
    name: 'createNodeCartridgeResolver',
    kind: 'function',
    signature: 'createNodeCartridgeResolver(options?: NodeCartridgeResolverOptions): CartridgeResolver',
    summary: 'Node factory for a CartridgeResolver that serves cache hits and (optionally) auto-pulls on misses.',
  },
];

const MANIFEST_FIELDS: ManifestFieldDescription[] = [
  { path: 'schemaVersion', type: 'string', required: true, description: 'Must match CARTRIDGE_SCHEMA_VERSION (currently "1.0.0").' },
  { path: 'id', type: 'string', required: true, description: 'Globally unique reverse-dns id (e.g. "dev.machine.gemma-3n-e4b-it").' },
  { path: 'name', type: 'string', required: true, description: 'Human-readable display name.' },
  { path: 'version', type: 'string', required: true, description: 'Cartridge version (semver recommended).' },
  { path: 'description', type: 'string', required: false, description: 'Short one-paragraph description.' },
  { path: 'author', type: 'CartridgeAuthor { name, url?, email? }', required: false, description: 'Cartridge author. `name` is required if author is present.' },
  { path: 'license', type: 'string', required: false, description: 'SPDX license identifier for the weights + assets.' },
  { path: 'homepage', type: 'string', required: false, description: 'Project / documentation URL.' },
  { path: 'weights.format', type: '"gguf" | "litertlm" | "task" | "mlx" | "safetensors"', required: true, description: 'Weights file format. Determines which runtime backend loads this cartridge.' },
  { path: 'weights.path', type: 'string', required: true, description: 'Weights path relative to the cartridge root. Must stay inside the root (no parent-dir escapes, no absolute paths).' },
  { path: 'weights.sizeBytes', type: 'number', required: true, description: 'Byte size of the weights file. Verified on `validate`.' },
  { path: 'weights.sha256', type: 'string', required: true, description: 'Lowercase hex sha256 digest of the weights file.' },
  { path: 'weights.quantization', type: 'string', required: false, description: 'Quantization scheme (e.g. "Q4_K_M"). Free-form, backend-specific.' },
  { path: 'weights.projectorPath', type: 'string', required: false, description: 'Projector / multimodal adapter path, relative to root.' },
  { path: 'capabilities.inputModalities', type: 'ActivationInputModality[]', required: true, description: 'Declared input modalities (e.g. ["text", "image"]).' },
  { path: 'capabilities.outputModalities', type: 'ActivationOutputModality[]', required: true, description: 'Declared output modalities (usually ["text"]).' },
  { path: 'capabilities.contextWindowTokens', type: 'number', required: false, description: 'Context window the weights support.' },
  { path: 'capabilities.supportsTextCompletion', type: 'boolean', required: false, description: 'Whether completeText (raw prompt completion) is viable.' },
  { path: 'capabilities.supportsTextChat', type: 'boolean', required: false, description: 'Whether completeChat (role-tagged messages) is viable.' },
  { path: 'capabilities.supportsStreaming', type: 'boolean', required: false, description: 'Whether token streaming is supported by the backend.' },
  { path: 'capabilities.structuredJsonOutput', type: 'boolean', required: false, description: 'Whether JSON-shape constrained output is supported (usually via GBNF).' },
  { path: 'capabilities.toolCalling', type: 'boolean', required: false, description: 'Whether the cartridge advertises tool-use compatibility (follows ReAct or similar).' },
  { path: 'requirements.estimatedRuntimeMemoryMb', type: 'number', required: false, description: 'Expected RAM footprint once loaded. Advisory.' },
  { path: 'requirements.minDeviceMemoryMb', type: 'number', required: false, description: 'Minimum device memory to run at all.' },
  { path: 'requirements.preferredAcceleration', type: 'ActivationAccelerationMode[]', required: false, description: 'Preferred acceleration targets (e.g. ["gpu", "cpu"]).' },
  { path: 'requirements.minBackendVersions', type: 'Record<string, string>', required: false, description: 'Minimum backend versions per backend id, e.g. { "llama-rn": ">=0.4.0" }.' },
  { path: 'chatTemplate', type: 'string | { type: "custom"; template: string }', required: false, description: 'Chat-template hint. Either a named preset ("gemma", "llama-3") or a custom template.' },
  { path: 'presets.systemPrompts', type: 'Array<{ id, label, content }>', required: false, description: 'Curated system prompts shown by the UI.' },
  { path: 'presets.examples', type: 'Array<{ id, label, prompt, expected? }>', required: false, description: 'Curated examples shown by the UI.' },
  { path: 'assets.icon', type: 'string', required: false, description: 'Icon path relative to cartridge root.' },
  { path: 'assets.screenshots', type: 'string[]', required: false, description: 'Screenshot paths relative to cartridge root.' },
  { path: 'assets.readme', type: 'string', required: false, description: 'README path relative to cartridge root.' },
];

const CATALOG_FIELDS: ManifestFieldDescription[] = [
  { path: 'schemaVersion', type: 'string', required: true, description: 'Must match CATALOG_SCHEMA_VERSION (currently "1.0.0").' },
  { path: 'updatedAt', type: 'string (ISO-8601)', required: false, description: 'When the catalog was last published.' },
  { path: 'entries', type: 'CatalogEntry[]', required: true, description: 'Array of catalog entries. Each entry corresponds to one published cartridge version.' },
  { path: 'entries[].id', type: 'string', required: true, description: 'Must match the embedded manifest.id.' },
  { path: 'entries[].version', type: 'string', required: true, description: 'Cartridge version.' },
  { path: 'entries[].name', type: 'string', required: true, description: 'Display name.' },
  { path: 'entries[].description', type: 'string', required: false, description: 'Short description for the UI.' },
  { path: 'entries[].author', type: 'CatalogAuthor', required: false, description: 'Cartridge author. `name` is required if author is present.' },
  { path: 'entries[].homepage', type: 'string', required: false, description: 'Project URL.' },
  { path: 'entries[].license', type: 'string', required: false, description: 'SPDX license.' },
  { path: 'entries[].tags', type: 'string[]', required: false, description: 'Free-form tags used by `machine search`.' },
  { path: 'entries[].categories', type: 'string[]', required: false, description: 'Category labels used by catalog UIs.' },
  { path: 'entries[].downloadUrl', type: 'string', required: true, description: 'Absolute URL of the .mcart archive.' },
  { path: 'entries[].downloadSizeBytes', type: 'number', required: true, description: 'Byte size of the .mcart archive at downloadUrl.' },
  { path: 'entries[].sha256', type: 'string', required: true, description: 'Lowercase hex sha256 of the .mcart archive bytes.' },
  { path: 'entries[].manifest', type: 'CartridgeManifest', required: true, description: 'Embedded cartridge manifest so browsers can inspect without downloading.' },
  { path: 'entries[].publishedAt', type: 'string (ISO-8601)', required: false, description: 'When this entry was published.' },
  { path: 'entries[].featured', type: 'boolean', required: false, description: 'Feature flag for discovery UIs.' },
  { path: 'entries[].signature', type: 'string', required: false, description: 'Reserved: ed25519 signature over the entry. Not verified in v1.' },
  { path: 'signingKey', type: 'string', required: false, description: 'Reserved: ed25519 signing key for the catalog. Not verified in v1.' },
];

const UI_PACKAGE: UiPackageDescription = {
  name: 'machineai-activation-ui',
  version: '0.1.0-alpha.1',
  exports: ['machineai-activation-ui', 'machineai-activation-ui/web', 'machineai-activation-ui/native'],
  hooks: [
    {
      name: 'MachineProvider',
      signature: '<MachineProvider machine={Machine}>{children}</MachineProvider>',
      summary: 'React context provider that supplies a Machine instance to descendants. Consumers construct the Machine and pass it in.',
    },
    {
      name: 'useMachineContext',
      signature: 'useMachineContext(): Machine',
      summary: 'Read the Machine out of context. Throws if called outside <MachineProvider>.',
    },
    {
      name: 'useMachineModel',
      signature: 'useMachineModel(spec: ModelSpec | null): MachineModel | null',
      summary: 'Memoize machine.model(spec) across renders keyed by a stable JSON form of the spec. Returns null when spec is null.',
    },
    {
      name: 'useActivationSnapshot',
      signature: 'useActivationSnapshot(model: MachineModel | null): { status, snapshot, error, reload }',
      summary: 'Async-load ActivationCapabilitySnapshot on mount and when modelId changes. Mount-guarded, exposes a reload() trigger.',
    },
    {
      name: 'useInference',
      signature: 'useInference(model: MachineModel | null): UseInferenceReturn',
      summary: 'Wraps streamText. Drains textStream into component state; exposes status, text, tokensPerSecond, usage, start/abort/reset.',
    },
    {
      name: 'useCartridgeFilter',
      signature: 'useCartridgeFilter(entries: CatalogEntry[], options?): { filtered, query, category, tags, setQuery, setCategory, toggleTag }',
      summary: 'Pure hook for ModelPicker UX: search + category + tag filter + featured-first sort over CatalogEntry[].',
    },
    {
      name: 'formatBytes',
      signature: 'formatBytes(bytes: number): string',
      summary: 'B/KB/MB/GB/TB human-readable formatter.',
    },
    {
      name: 'formatTokensPerSecond',
      signature: 'formatTokensPerSecond(tokensPerSecond: number): string',
      summary: 'Tokens-per-second formatter (2 decimals for small values, rounded for larger).',
    },
  ],
  components: [
    { name: 'ModelPicker', target: 'web', summary: 'Search input + category chips + list of <CartridgeCard>s. Consumes useCartridgeFilter.' },
    { name: 'CartridgeCard', target: 'web', summary: '<article> rendering a CartridgeManifest + optional CatalogEntry (size, author, install/open actions).' },
    { name: 'ActivationStatus', target: 'web', summary: '<section> rendering ActivationCapabilitySnapshot: compatibility badge, backend, memory assessment, reasons, warnings.' },
    { name: 'InferenceIndicator', target: 'web', summary: 'Streaming indicator: status dot, tokens/sec, completion-token count, abort button.' },
    { name: 'ModelImportButton', target: 'web', summary: 'Hidden <input type="file"> wrapped in a styled <button>. Emits onImport({ name, size, file }).' },
    { name: 'ModelPicker', target: 'native', summary: '<View> + <TextInput> + <FlatList>. Same filter behavior as web variant.' },
    { name: 'CartridgeCard', target: 'native', summary: '<View>/<Text> variant of the card.' },
    { name: 'ActivationStatus', target: 'native', summary: '<View>/<Text> variant of the status panel.' },
    { name: 'InferenceIndicator', target: 'native', summary: '<View> with <ActivityIndicator> when streaming, tokens/sec, abort <TouchableOpacity>.' },
    { name: 'ModelImportButton', target: 'native', summary: '<TouchableOpacity> wrapper. Consumer supplies pickModel() (e.g. via react-native-document-picker).' },
  ],
};

const SCAFFOLDER_PACKAGE: ScaffolderPackageDescription = {
  name: 'create-machineai-app',
  version: '0.1.0-alpha.1',
  bin: 'create-machine-app',
  usage: 'create-machine-app [app-name] [--template <id>] [--pm <npm|pnpm|yarn>] [--yes] [--force]',
  templates: [
    {
      id: 'node-script',
      displayName: 'Node script',
      description: 'Minimal Node CLI that runs one-shot inference against a local cartridge via createMachine + generateText.',
      target: 'node',
    },
    {
      id: 'expo-local-chat',
      displayName: 'Expo local chat',
      description: 'Expo RN app with streaming on-device chat via llama.rn + machineai-activation-ui/native.',
      target: 'expo',
    },
    {
      id: 'rn-cli-local-chat',
      displayName: 'RN CLI local chat',
      description: 'Bare React Native (no Expo) with streaming on-device chat via llama.rn + machineai-activation-ui/native.',
      target: 'react-native',
    },
    {
      id: 'next-local-chat',
      displayName: 'Next.js local chat',
      description: 'Next.js 14 (app router) web app with streaming in-browser chat via @mlc-ai/web-llm + machineai-activation-ui/web.',
      target: 'next',
    },
    {
      id: 'electron-local-chat',
      displayName: 'Electron local chat',
      description: 'Electron desktop app with streaming on-device chat via node-llama-cpp (main) + machineai-activation-ui/web (renderer).',
      target: 'electron',
    },
  ],
};

const POINTERS: Record<string, string> = {
  roadmap: 'CARTRIDGE_SDK_ROADMAP.md',
  agentsGuide: 'AGENTS.md',
  sdkEntry: 'src/index.ts',
  sdkApi: 'src/sdk/index.ts',
  cartridgeApi: 'src/cartridge/index.ts',
  catalogApi: 'src/catalog/index.ts',
  cliEntry: 'src/bin/machine.ts',
  manifestTypes: 'src/cartridge/types.ts',
  catalogTypes: 'src/catalog/types.ts',
  activationContract: 'src/activation/activationContract.ts',
  tests: 'tests/',
  testRunner: 'tests/run.ts',
  exampleConsumer: 'examples/basic-consumer/',
  uiPackage: 'packages/ui/',
  uiCore: 'packages/ui/src/core/',
  uiWeb: 'packages/ui/src/web/',
  uiNative: 'packages/ui/src/native/',
  scaffolder: 'packages/create-machine-app/',
  scaffolderTemplates: 'packages/create-machine-app/templates/',
};
