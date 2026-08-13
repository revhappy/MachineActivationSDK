import type { ActivationModelProbeInput } from './activationAdapter';

export interface ActivationStoredModelConfig extends ActivationModelProbeInput {
  fileName?: string;
  fileSizeBytes?: number;
}

export interface ActivationPickedModelFile {
  name: string;
  path: string;
  sizeBytes?: number;
  mimeType?: string;
}

export interface ActivationModelFilePicker {
  pickModelFile(options?: {
    acceptedExtensions?: string[];
  }): Promise<ActivationPickedModelFile | null>;
}

export interface ActivationConfigValidationResult {
  valid: boolean;
  reasons: string[];
}

export interface ActivationModelConfigPreset {
  acceptedExtensions: string[];
  defaultRuntimeHint?: string;
  clearProjectorByDefault?: boolean;

  /**
   * Runtime hint per file extension, for presets that accept more than one
   * model format. Falls back to `defaultRuntimeHint` when an extension is
   * not listed.
   */
  runtimeHintByExtension?: Record<string, string>;

  /**
   * Extensions whose projector must survive a pick, overriding
   * `clearProjectorByDefault`.
   *
   * A `.litertlm` package carries vision internally, so clearing the
   * projector is correct there. A vision GGUF is two files — weights plus an
   * mmproj projector — and clearing it silently removes the model's ability
   * to see.
   */
  keepProjectorExtensions?: string[];
}

export interface ActivationModelConfigStorage {
  load(): ActivationStoredModelConfig | null;
  save(config: ActivationStoredModelConfig): void;
  clear(): void;
}

export interface ActivationKeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LITERT_LM_ANDROID_PRESET: ActivationModelConfigPreset = {
  acceptedExtensions: ['.litertlm'],
  defaultRuntimeHint: 'litert.capacitor.android',
  clearProjectorByDefault: true,
};

export const LLAMA_CPP_ANDROID_PRESET: ActivationModelConfigPreset = {
  acceptedExtensions: ['.gguf'],
  defaultRuntimeHint: 'llama.capacitor.android',
  // A vision GGUF needs its mmproj projector; clearing it blinds the model.
  clearProjectorByDefault: false,
};

/**
 * Accepts every model format the Android bridge can run, and derives the
 * runtime from the file itself.
 *
 * Use this rather than a format-specific preset unless an app deliberately
 * supports only one runtime — with a single-format preset the file picker
 * rejects the other format before anything downstream is reachable.
 */
export const UNIVERSAL_ANDROID_PRESET: ActivationModelConfigPreset = {
  acceptedExtensions: ['.litertlm', '.gguf'],
  defaultRuntimeHint: 'litert.capacitor.android',
  clearProjectorByDefault: true,
  runtimeHintByExtension: {
    '.litertlm': 'litert.capacitor.android',
    '.gguf': 'llama.capacitor.android',
  },
  keepProjectorExtensions: ['.gguf'],
};

function getDefaultKeyValueStore(): ActivationKeyValueStore | null {
  const maybeStorage = (globalThis as { localStorage?: ActivationKeyValueStore }).localStorage;
  return maybeStorage ?? null;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inferModelId(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  return withoutExtension
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeExtension(extension: string): string {
  return extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
}

function fileMatchesAcceptedExtensions(
  fileName: string,
  acceptedExtensions: string[],
): boolean {
  return matchedExtension(fileName, acceptedExtensions) != null;
}

/** The accepted extension this file matched, normalized, or null. */
function matchedExtension(
  fileName: string,
  acceptedExtensions: string[],
): string | null {
  const lowerName = fileName.toLowerCase();
  for (const extension of acceptedExtensions) {
    const normalized = normalizeExtension(extension);
    if (lowerName.endsWith(normalized)) {
      return normalized;
    }
  }
  return null;
}

export function normalizeStoredActivationModelConfig(
  raw: Partial<ActivationStoredModelConfig> | null | undefined,
): ActivationStoredModelConfig | null {
  const filePath = normalizeOptionalString(raw?.filePath);
  if (!filePath) {
    return null;
  }

  return {
    modelId: normalizeOptionalString(raw?.modelId),
    filePath,
    fileName: normalizeOptionalString(raw?.fileName),
    fileSizeBytes:
      typeof raw?.fileSizeBytes === 'number' && Number.isFinite(raw.fileSizeBytes)
        ? raw.fileSizeBytes
        : undefined,
    projectorPath: normalizeOptionalString(raw?.projectorPath) ?? null,
    modelFormatHint: normalizeOptionalString(raw?.modelFormatHint),
    runtimeHint: normalizeOptionalString(raw?.runtimeHint),
    observedCapabilities: raw?.observedCapabilities,
  };
}

export function validateStoredActivationModelConfig(
  config: Partial<ActivationStoredModelConfig> | null | undefined,
  preset: ActivationModelConfigPreset = LITERT_LM_ANDROID_PRESET,
): ActivationConfigValidationResult {
  const normalized = normalizeStoredActivationModelConfig(config);
  const reasons: string[] = [];

  if (!normalized) {
    reasons.push('No local model is configured.');
    return { valid: false, reasons };
  }

  const fileName = normalized.fileName ?? normalized.filePath.split('/').pop() ?? normalized.filePath;
  if (
    preset.acceptedExtensions.length > 0 &&
    !fileMatchesAcceptedExtensions(fileName, preset.acceptedExtensions)
  ) {
    reasons.push(
      `Expected one of: ${preset.acceptedExtensions.map(normalizeExtension).join(', ')}`,
    );
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

export function inferActivationModelConfigFromPickedFile(
  file: ActivationPickedModelFile,
  preset: ActivationModelConfigPreset = LITERT_LM_ANDROID_PRESET,
): ActivationStoredModelConfig {
  if (!file.path) {
    throw new Error('The selected model file did not expose a readable local path.');
  }

  if (
    preset.acceptedExtensions.length > 0 &&
    !fileMatchesAcceptedExtensions(file.name, preset.acceptedExtensions)
  ) {
    throw new Error(
      `This activation path expects ${preset.acceptedExtensions
        .map(normalizeExtension)
        .join(', ')} model packages.`,
    );
  }

  const extension = matchedExtension(file.name, preset.acceptedExtensions);
  const keepProjector =
    extension != null &&
    (preset.keepProjectorExtensions ?? []).some(
      (candidate) => normalizeExtension(candidate) === extension,
    );

  return {
    modelId: inferModelId(file.name),
    fileName: file.name,
    filePath: file.path,
    fileSizeBytes: file.sizeBytes,
    projectorPath: preset.clearProjectorByDefault && !keepProjector ? null : undefined,
    runtimeHint:
      (extension != null ? preset.runtimeHintByExtension?.[extension] : undefined) ??
      preset.defaultRuntimeHint,
  };
}

export async function pickActivationModelConfig(
  picker: ActivationModelFilePicker,
  preset: ActivationModelConfigPreset = LITERT_LM_ANDROID_PRESET,
): Promise<ActivationStoredModelConfig> {
  const file = await picker.pickModelFile({
    acceptedExtensions: preset.acceptedExtensions,
  });

  if (!file) {
    throw new Error('No model file was selected.');
  }

  return inferActivationModelConfigFromPickedFile(file, preset);
}

export function createJsonActivationModelConfigStorage(options?: {
  storageKey?: string;
  storage?: ActivationKeyValueStore;
}): ActivationModelConfigStorage {
  const storageKey = options?.storageKey ?? 'machine.activation.modelConfig';
  const storage = options?.storage ?? getDefaultKeyValueStore();

  return {
    load() {
      if (!storage) {
        return null;
      }

      const rawValue = storage.getItem(storageKey);
      if (!rawValue) {
        return null;
      }

      try {
        return normalizeStoredActivationModelConfig(
          JSON.parse(rawValue) as Partial<ActivationStoredModelConfig>,
        );
      } catch {
        return null;
      }
    },
    save(config) {
      if (!storage) {
        return;
      }

      const normalized = normalizeStoredActivationModelConfig(config);
      if (!normalized) {
        storage.removeItem(storageKey);
        return;
      }

      storage.setItem(storageKey, JSON.stringify(normalized));
    },
    clear() {
      storage?.removeItem(storageKey);
    },
  };
}
