import type {
  ActivationAccelerationMode,
  ActivationInputModality,
  ActivationOutputModality,
} from '../activation/activationContract';

export const CARTRIDGE_SCHEMA_VERSION = '1.0.0';

export type CartridgeWeightFormat =
  | 'gguf'
  | 'litertlm'
  | 'task'
  | 'mlx'
  | 'safetensors';

export interface CartridgeWeights {
  format: CartridgeWeightFormat;
  /** Path relative to the cartridge root, e.g. "weights/model.gguf". */
  path: string;
  sizeBytes: number;
  /** Lowercase hex sha256 of the weights file. */
  sha256: string;
  quantization?: string;
  /** Optional projector/multimodal adapter path, relative to cartridge root. */
  projectorPath?: string;
}

export interface CartridgeCapabilities {
  inputModalities: ActivationInputModality[];
  outputModalities: ActivationOutputModality[];
  contextWindowTokens?: number;
  supportsTextCompletion?: boolean;
  supportsTextChat?: boolean;
  supportsStreaming?: boolean;
  structuredJsonOutput?: boolean;
  toolCalling?: boolean;
}

export interface CartridgeRequirements {
  estimatedRuntimeMemoryMb?: number;
  minDeviceMemoryMb?: number;
  preferredAcceleration?: ActivationAccelerationMode[];
  /** Minimum semver-like string per backend id, e.g. { "llama-rn": ">=0.4.0" }. */
  minBackendVersions?: Record<string, string>;
}

export type CartridgeChatTemplate =
  | string
  | { type: 'custom'; template: string };

export interface CartridgePresetSystemPrompt {
  id: string;
  label: string;
  content: string;
}

export interface CartridgePresetExample {
  id: string;
  label: string;
  prompt: string;
  expected?: string;
}

export interface CartridgePresets {
  systemPrompts?: CartridgePresetSystemPrompt[];
  examples?: CartridgePresetExample[];
}

export interface CartridgeAssets {
  /** Path relative to cartridge root, e.g. "assets/icon.png". */
  icon?: string;
  screenshots?: string[];
  readme?: string;
}

export interface CartridgeAuthor {
  name: string;
  url?: string;
  email?: string;
}

export interface CartridgeManifest {
  schemaVersion: string;
  /** Globally unique id, reverse-dns encouraged (e.g. "dev.machine.gemma-3n-e4b-it"). */
  id: string;
  name: string;
  version: string;
  author?: CartridgeAuthor;
  license?: string;
  description?: string;
  homepage?: string;
  weights: CartridgeWeights;
  capabilities: CartridgeCapabilities;
  requirements?: CartridgeRequirements;
  chatTemplate?: CartridgeChatTemplate;
  presets?: CartridgePresets;
  assets?: CartridgeAssets;
}

export interface LoadedCartridge {
  manifest: CartridgeManifest;
  /** Absolute path to the cartridge root directory. */
  rootDir: string;
  /** Resolved absolute path to the weights file. */
  weightsPath: string;
  /** Resolved absolute path to the projector file, if the manifest declared one. */
  projectorPath?: string;
}
