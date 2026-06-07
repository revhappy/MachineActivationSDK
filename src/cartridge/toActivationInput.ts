import type { ActivationSessionCreateInput } from '../activation/activationAdapter';
import type {
  ActivationAccelerationMode,
  AppCapabilityRequirements,
} from '../activation/activationContract';
import type { ActivationObservedCapabilities } from '../activation/observedCapabilities';
import type { CartridgeWeightFormat, LoadedCartridge } from './types';

export interface CartridgeToActivationInputOptions {
  /** Override the session's modelId. Defaults to `manifest.id`. */
  modelId?: string;
  /** App requirements to pass through activation. */
  appRequirements?: AppCapabilityRequirements;
  /** Preferred acceleration. Defaults to manifest.requirements.preferredAcceleration. */
  preferredAcceleration?: ActivationAccelerationMode[];
  /**
   * Seed declared capabilities as "observed" so the activation layer skips
   * redundant probing. Defaults to true — cartridges are authoritative by design.
   */
  trustDeclaredCapabilities?: boolean;
}

export function cartridgeToActivationInput(
  cartridge: LoadedCartridge,
  options: CartridgeToActivationInputOptions = {},
): ActivationSessionCreateInput {
  const { manifest } = cartridge;
  const trust = options.trustDeclaredCapabilities ?? true;

  const input: ActivationSessionCreateInput = {
    modelId: options.modelId ?? manifest.id,
    filePath: cartridge.weightsPath,
    runtimeHint: runtimeHintFor(manifest.weights.format),
    modelFormatHint: manifest.weights.format,
  };

  if (cartridge.projectorPath !== undefined) {
    input.projectorPath = cartridge.projectorPath;
  }
  if (manifest.capabilities.contextWindowTokens !== undefined) {
    input.contextWindowTokens = manifest.capabilities.contextWindowTokens;
  }
  if (options.appRequirements !== undefined) {
    input.appRequirements = options.appRequirements;
  }

  const preferred =
    options.preferredAcceleration ?? manifest.requirements?.preferredAcceleration;
  if (preferred !== undefined) {
    input.preferredAcceleration = preferred;
  }

  if (trust) {
    input.observedCapabilities = buildObservedCapabilities(cartridge);
  }

  return input;
}

function runtimeHintFor(format: CartridgeWeightFormat): string | undefined {
  switch (format) {
    case 'gguf':
      return 'llama';
    case 'litertlm':
    case 'task':
      return 'litert';
    case 'mlx':
      return 'mlx';
    case 'safetensors':
      return 'safetensors';
    default:
      return undefined;
  }
}

function buildObservedCapabilities(
  cartridge: LoadedCartridge,
): ActivationObservedCapabilities {
  const now = new Date().toISOString();
  const caps = cartridge.manifest.capabilities;

  const observed: ActivationObservedCapabilities = {
    source: 'probe-suite',
    observedAt: now,
    notes: [`seeded from cartridge ${cartridge.manifest.id}@${cartridge.manifest.version}`],
    checks: {},
  };

  if (caps.supportsTextCompletion !== undefined) {
    observed.textCompletion = caps.supportsTextCompletion;
  }
  if (caps.supportsStreaming !== undefined) {
    observed.streaming = caps.supportsStreaming;
  }
  if (caps.structuredJsonOutput !== undefined) {
    observed.structuredJsonOutput = caps.structuredJsonOutput;
  }
  if (caps.inputModalities.includes('image')) {
    observed.visionImageInput = true;
    observed.projectorReady = cartridge.projectorPath !== undefined;
  }

  return observed;
}
