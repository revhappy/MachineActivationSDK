import {
  CARTRIDGE_SCHEMA_VERSION,
  type CartridgeManifest,
  type CartridgeWeightFormat,
} from './types';

export interface ManifestValidationIssue {
  path: string;
  message: string;
}

export type ManifestValidationResult =
  | { valid: true; manifest: CartridgeManifest; issues: [] }
  | { valid: false; manifest?: undefined; issues: ManifestValidationIssue[] };

const WEIGHT_FORMATS: readonly CartridgeWeightFormat[] = [
  'gguf',
  'litertlm',
  'task',
  'mlx',
  'safetensors',
];

const INPUT_MODALITIES = new Set(['text', 'image']);
const OUTPUT_MODALITIES = new Set(['text']);
const ACCELERATION_MODES = new Set(['cpu', 'gpu', 'npu']);

export function parseCartridgeManifest(raw: unknown): ManifestValidationResult {
  const issues: ManifestValidationIssue[] = [];

  if (!isObject(raw)) {
    return fail([{ path: '', message: 'manifest must be a JSON object' }]);
  }

  const schemaVersion = requireString(raw, 'schemaVersion', issues);
  const id = requireString(raw, 'id', issues);
  const name = requireString(raw, 'name', issues);
  const version = requireString(raw, 'version', issues);

  const weights = validateWeights(raw.weights, 'weights', issues);
  const capabilities = validateCapabilities(raw.capabilities, 'capabilities', issues);

  const author = optionalAuthor(raw.author, 'author', issues);
  const license = optionalString(raw, 'license', issues);
  const description = optionalString(raw, 'description', issues);
  const homepage = optionalString(raw, 'homepage', issues);

  const requirements = optionalRequirements(raw.requirements, 'requirements', issues);
  const chatTemplate = optionalChatTemplate(raw.chatTemplate, 'chatTemplate', issues);
  const presets = optionalPresets(raw.presets, 'presets', issues);
  const assets = optionalAssets(raw.assets, 'assets', issues);

  if (issues.length > 0 || !weights || !capabilities) {
    return fail(issues);
  }

  const manifest: CartridgeManifest = {
    schemaVersion: schemaVersion ?? CARTRIDGE_SCHEMA_VERSION,
    id: id!,
    name: name!,
    version: version!,
    weights,
    capabilities,
  };

  if (author !== undefined) manifest.author = author;
  if (license !== undefined) manifest.license = license;
  if (description !== undefined) manifest.description = description;
  if (homepage !== undefined) manifest.homepage = homepage;
  if (requirements !== undefined) manifest.requirements = requirements;
  if (chatTemplate !== undefined) manifest.chatTemplate = chatTemplate;
  if (presets !== undefined) manifest.presets = presets;
  if (assets !== undefined) manifest.assets = assets;

  return { valid: true, manifest, issues: [] };
}

function validateWeights(
  raw: unknown,
  path: string,
  issues: ManifestValidationIssue[],
): CartridgeManifest['weights'] | undefined {
  if (!isObject(raw)) {
    issues.push({ path, message: 'weights must be an object' });
    return undefined;
  }

  const format = raw.format;
  if (typeof format !== 'string' || !WEIGHT_FORMATS.includes(format as CartridgeWeightFormat)) {
    issues.push({
      path: `${path}.format`,
      message: `weights.format must be one of: ${WEIGHT_FORMATS.join(', ')}`,
    });
  }

  const filePath = raw.path;
  if (typeof filePath !== 'string' || filePath.length === 0) {
    issues.push({ path: `${path}.path`, message: 'weights.path must be a non-empty string' });
  } else if (isAbsoluteOrEscaping(filePath)) {
    issues.push({
      path: `${path}.path`,
      message: 'weights.path must be relative to the cartridge root and must not escape it',
    });
  }

  const sizeBytes = raw.sizeBytes;
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    issues.push({
      path: `${path}.sizeBytes`,
      message: 'weights.sizeBytes must be a positive number',
    });
  }

  const sha256 = raw.sha256;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) {
    issues.push({
      path: `${path}.sha256`,
      message: 'weights.sha256 must be a 64-char hex string',
    });
  }

  const projectorPath = raw.projectorPath;
  if (projectorPath !== undefined) {
    if (typeof projectorPath !== 'string' || projectorPath.length === 0) {
      issues.push({
        path: `${path}.projectorPath`,
        message: 'weights.projectorPath must be a non-empty string when present',
      });
    } else if (isAbsoluteOrEscaping(projectorPath)) {
      issues.push({
        path: `${path}.projectorPath`,
        message: 'weights.projectorPath must be relative to the cartridge root',
      });
    }
  }

  const quantization = raw.quantization;
  if (quantization !== undefined && typeof quantization !== 'string') {
    issues.push({
      path: `${path}.quantization`,
      message: 'weights.quantization must be a string when present',
    });
  }

  if (issues.some((i) => i.path.startsWith(`${path}.`))) {
    return undefined;
  }

  const result: CartridgeManifest['weights'] = {
    format: format as CartridgeWeightFormat,
    path: filePath as string,
    sizeBytes: sizeBytes as number,
    sha256: (sha256 as string).toLowerCase(),
  };
  if (typeof quantization === 'string') result.quantization = quantization;
  if (typeof projectorPath === 'string') result.projectorPath = projectorPath;
  return result;
}

function validateCapabilities(
  raw: unknown,
  path: string,
  issues: ManifestValidationIssue[],
): CartridgeManifest['capabilities'] | undefined {
  if (!isObject(raw)) {
    issues.push({ path, message: 'capabilities must be an object' });
    return undefined;
  }

  const input = raw.inputModalities;
  if (!Array.isArray(input) || input.length === 0 || !input.every((m) => typeof m === 'string' && INPUT_MODALITIES.has(m))) {
    issues.push({
      path: `${path}.inputModalities`,
      message: `inputModalities must be a non-empty array of: ${[...INPUT_MODALITIES].join(', ')}`,
    });
  }

  const output = raw.outputModalities;
  if (!Array.isArray(output) || output.length === 0 || !output.every((m) => typeof m === 'string' && OUTPUT_MODALITIES.has(m))) {
    issues.push({
      path: `${path}.outputModalities`,
      message: `outputModalities must be a non-empty array of: ${[...OUTPUT_MODALITIES].join(', ')}`,
    });
  }

  const context = raw.contextWindowTokens;
  if (context !== undefined && (typeof context !== 'number' || context <= 0)) {
    issues.push({
      path: `${path}.contextWindowTokens`,
      message: 'contextWindowTokens must be a positive number when present',
    });
  }

  for (const flag of [
    'supportsTextCompletion',
    'supportsTextChat',
    'supportsStreaming',
    'structuredJsonOutput',
    'toolCalling',
  ] as const) {
    const value = (raw as Record<string, unknown>)[flag];
    if (value !== undefined && typeof value !== 'boolean') {
      issues.push({ path: `${path}.${flag}`, message: `${flag} must be a boolean when present` });
    }
  }

  if (issues.some((i) => i.path.startsWith(`${path}.`))) {
    return undefined;
  }

  const result: CartridgeManifest['capabilities'] = {
    inputModalities: input as CartridgeManifest['capabilities']['inputModalities'],
    outputModalities: output as CartridgeManifest['capabilities']['outputModalities'],
  };
  if (typeof context === 'number') result.contextWindowTokens = context;
  for (const flag of [
    'supportsTextCompletion',
    'supportsTextChat',
    'supportsStreaming',
    'structuredJsonOutput',
    'toolCalling',
  ] as const) {
    const value = (raw as Record<string, unknown>)[flag];
    if (typeof value === 'boolean') {
      result[flag] = value;
    }
  }
  return result;
}

function optionalAuthor(
  raw: unknown,
  path: string,
  issues: ManifestValidationIssue[],
): CartridgeManifest['author'] | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    issues.push({ path, message: 'author must be an object when present' });
    return undefined;
  }

  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    issues.push({ path: `${path}.name`, message: 'author.name must be a non-empty string' });
    return undefined;
  }

  const author: NonNullable<CartridgeManifest['author']> = { name: raw.name };
  if (raw.url !== undefined) {
    if (typeof raw.url !== 'string') {
      issues.push({ path: `${path}.url`, message: 'author.url must be a string' });
    } else {
      author.url = raw.url;
    }
  }
  if (raw.email !== undefined) {
    if (typeof raw.email !== 'string') {
      issues.push({ path: `${path}.email`, message: 'author.email must be a string' });
    } else {
      author.email = raw.email;
    }
  }
  return author;
}

function optionalRequirements(
  raw: unknown,
  path: string,
  issues: ManifestValidationIssue[],
): CartridgeManifest['requirements'] | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    issues.push({ path, message: 'requirements must be an object when present' });
    return undefined;
  }

  const req: NonNullable<CartridgeManifest['requirements']> = {};

  for (const key of ['estimatedRuntimeMemoryMb', 'minDeviceMemoryMb'] as const) {
    const value = (raw as Record<string, unknown>)[key];
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        issues.push({ path: `${path}.${key}`, message: `${key} must be a non-negative number` });
      } else {
        req[key] = value;
      }
    }
  }

  const accel = (raw as Record<string, unknown>).preferredAcceleration;
  if (accel !== undefined) {
    if (!Array.isArray(accel) || !accel.every((m) => typeof m === 'string' && ACCELERATION_MODES.has(m))) {
      issues.push({
        path: `${path}.preferredAcceleration`,
        message: `preferredAcceleration must be an array of: ${[...ACCELERATION_MODES].join(', ')}`,
      });
    } else {
      req.preferredAcceleration = accel as CartridgeManifest['requirements'] extends infer R
        ? R extends { preferredAcceleration?: infer A }
          ? A
          : never
        : never;
    }
  }

  const mins = (raw as Record<string, unknown>).minBackendVersions;
  if (mins !== undefined) {
    if (!isObject(mins) || !Object.values(mins).every((v) => typeof v === 'string')) {
      issues.push({
        path: `${path}.minBackendVersions`,
        message: 'minBackendVersions must be a string→string record',
      });
    } else {
      req.minBackendVersions = mins as Record<string, string>;
    }
  }

  return req;
}

function optionalChatTemplate(
  raw: unknown,
  path: string,
  issues: ManifestValidationIssue[],
): CartridgeManifest['chatTemplate'] | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') return raw;
  if (!isObject(raw)) {
    issues.push({ path, message: 'chatTemplate must be a string or { type, template } object' });
    return undefined;
  }
  if (raw.type !== 'custom' || typeof raw.template !== 'string' || raw.template.length === 0) {
    issues.push({
      path,
      message: 'chatTemplate object must be { type: "custom", template: "<non-empty string>" }',
    });
    return undefined;
  }
  return { type: 'custom', template: raw.template };
}

function optionalPresets(
  raw: unknown,
  path: string,
  issues: ManifestValidationIssue[],
): CartridgeManifest['presets'] | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    issues.push({ path, message: 'presets must be an object when present' });
    return undefined;
  }

  const presets: NonNullable<CartridgeManifest['presets']> = {};

  if (raw.systemPrompts !== undefined) {
    if (!Array.isArray(raw.systemPrompts)) {
      issues.push({
        path: `${path}.systemPrompts`,
        message: 'systemPrompts must be an array',
      });
    } else {
      presets.systemPrompts = raw.systemPrompts
        .map((entry, i) => validatePresetPrompt(entry, `${path}.systemPrompts[${i}]`, issues))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    }
  }

  if (raw.examples !== undefined) {
    if (!Array.isArray(raw.examples)) {
      issues.push({ path: `${path}.examples`, message: 'examples must be an array' });
    } else {
      presets.examples = raw.examples
        .map((entry, i) => validatePresetExample(entry, `${path}.examples[${i}]`, issues))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    }
  }

  return presets;
}

function validatePresetPrompt(
  raw: unknown,
  path: string,
  issues: ManifestValidationIssue[],
): { id: string; label: string; content: string } | null {
  if (!isObject(raw)) {
    issues.push({ path, message: 'system prompt must be an object' });
    return null;
  }
  for (const key of ['id', 'label', 'content'] as const) {
    if (typeof raw[key] !== 'string' || (raw[key] as string).length === 0) {
      issues.push({ path: `${path}.${key}`, message: `${key} must be a non-empty string` });
      return null;
    }
  }
  return {
    id: raw.id as string,
    label: raw.label as string,
    content: raw.content as string,
  };
}

function validatePresetExample(
  raw: unknown,
  path: string,
  issues: ManifestValidationIssue[],
): { id: string; label: string; prompt: string; expected?: string } | null {
  if (!isObject(raw)) {
    issues.push({ path, message: 'example must be an object' });
    return null;
  }
  for (const key of ['id', 'label', 'prompt'] as const) {
    if (typeof raw[key] !== 'string' || (raw[key] as string).length === 0) {
      issues.push({ path: `${path}.${key}`, message: `${key} must be a non-empty string` });
      return null;
    }
  }
  const result: { id: string; label: string; prompt: string; expected?: string } = {
    id: raw.id as string,
    label: raw.label as string,
    prompt: raw.prompt as string,
  };
  if (raw.expected !== undefined) {
    if (typeof raw.expected !== 'string') {
      issues.push({ path: `${path}.expected`, message: 'expected must be a string' });
      return null;
    }
    result.expected = raw.expected;
  }
  return result;
}

function optionalAssets(
  raw: unknown,
  path: string,
  issues: ManifestValidationIssue[],
): CartridgeManifest['assets'] | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    issues.push({ path, message: 'assets must be an object when present' });
    return undefined;
  }

  const assets: NonNullable<CartridgeManifest['assets']> = {};

  for (const key of ['icon', 'readme'] as const) {
    const value = raw[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || value.length === 0) {
        issues.push({ path: `${path}.${key}`, message: `${key} must be a non-empty string` });
      } else if (isAbsoluteOrEscaping(value)) {
        issues.push({ path: `${path}.${key}`, message: `${key} must be relative to cartridge root` });
      } else {
        assets[key] = value;
      }
    }
  }

  if (raw.screenshots !== undefined) {
    if (!Array.isArray(raw.screenshots) || !raw.screenshots.every((s) => typeof s === 'string')) {
      issues.push({
        path: `${path}.screenshots`,
        message: 'screenshots must be an array of strings',
      });
    } else if (raw.screenshots.some((s) => isAbsoluteOrEscaping(s as string))) {
      issues.push({
        path: `${path}.screenshots`,
        message: 'screenshots must be relative to cartridge root',
      });
    } else {
      assets.screenshots = raw.screenshots as string[];
    }
  }

  return assets;
}

function requireString(
  raw: Record<string, unknown>,
  key: string,
  issues: ManifestValidationIssue[],
): string | undefined {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({ path: key, message: `${key} must be a non-empty string` });
    return undefined;
  }
  return value;
}

function optionalString(
  raw: Record<string, unknown>,
  key: string,
  issues: ManifestValidationIssue[],
): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    issues.push({ path: key, message: `${key} must be a string when present` });
    return undefined;
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsoluteOrEscaping(p: string): boolean {
  if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) return true;
  const segments = p.split(/[\\/]+/);
  let depth = 0;
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      depth -= 1;
      if (depth < 0) return true;
    } else {
      depth += 1;
    }
  }
  return false;
}

function fail(issues: ManifestValidationIssue[]): ManifestValidationResult {
  return { valid: false, issues };
}
