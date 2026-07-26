import type {
  ActivationModelProbeInput,
} from '../activation/activationAdapter';
import type {
  ActivationAccelerationMode,
  BackendCapabilityDeclaration,
  DeviceCapabilityDeclaration,
  ModelCapabilityDeclaration,
} from '../activation/activationContract';
import {
  inferKnownModelCapabilities,
} from '../activation/capabilityInference';
import {
  detectActivationModelFormat,
} from '../activation/runtimeSelection';

import type { FetchLike } from './types';

export const BACKEND_ID = 'llama-server';
export const BACKEND_NAME = 'llama.cpp llama-server (OpenAI-compatible HTTP)';
export const DEFAULT_CONTEXT_TOKENS = 4096;

/** The slice of llama-server's `/props` response this adapter reads. */
export interface LlamaServerProps {
  contextTokens?: number;
  modelPath?: string;
  buildInfo?: string;
  chatTemplatePresent?: boolean;
}

/**
 * Ask a running llama-server what it actually loaded.
 *
 * This is the difference between the contract reporting a real context window
 * and reporting a hardcoded 4096. It is best-effort on purpose: `/props` has
 * moved across llama.cpp builds and a proxy in front of the server may not
 * expose it at all, so a miss degrades to defaults rather than failing
 * activation.
 */
export async function fetchServerProps(
  baseUrl: string,
  fetchImpl: FetchLike,
  headers: Record<string, string>,
  onLog?: (line: string) => void,
): Promise<LlamaServerProps> {
  try {
    const res = await fetchImpl(`${baseUrl}/props`, { method: 'GET', headers });
    if (!res.ok) {
      onLog?.(`llama-server /props returned ${res.status}; using defaults.`);
      return {};
    }
    const body = (await res.json()) as {
      default_generation_settings?: { n_ctx?: number };
      n_ctx?: number;
      model_path?: string;
      build_info?: string;
      chat_template?: string;
    };
    const contextTokens = body.default_generation_settings?.n_ctx ?? body.n_ctx;
    return {
      contextTokens: typeof contextTokens === 'number' && contextTokens > 0 ? contextTokens : undefined,
      modelPath: typeof body.model_path === 'string' ? body.model_path : undefined,
      buildInfo: typeof body.build_info === 'string' ? body.build_info : undefined,
      chatTemplatePresent:
        typeof body.chat_template === 'string' ? body.chat_template.length > 0 : undefined,
    };
  } catch (error) {
    onLog?.(
      `llama-server /props unreachable (${
        error instanceof Error ? error.message : String(error)
      }); using defaults.`,
    );
    return {};
  }
}

export function buildBackendDeclaration(input: {
  acceleration: ActivationAccelerationMode;
  supportsVision: boolean;
  streaming: boolean;
  backendVersion?: string;
}): BackendCapabilityDeclaration {
  return {
    backendId: BACKEND_ID,
    backendName: BACKEND_NAME,
    backendVersion: input.backendVersion,
    sessionCreationAvailable: true,
    supportsStreaming: input.streaming,
    supportsVision: input.supportsVision,
    // llama.cpp takes a GBNF grammar directly on the request, so structured
    // output is native rather than prompt-coaxed.
    supportsStructuredJsonOutput: true,
    supportsToolCalling: true,
    supportsCancellation: true,
    supportedAccelerationModes:
      input.acceleration === 'cpu' ? ['cpu'] : ['cpu', input.acceleration],
    detectedDevices: [],
    notes: [],
  };
}

export function buildDeviceDeclaration(input: {
  platform: string;
  acceleration: ActivationAccelerationMode;
  supportsVision: boolean;
}): DeviceCapabilityDeclaration {
  return {
    platform: input.platform,
    // Over HTTP the adapter has no view of the host's camera or library. Vision
    // gating therefore follows the projector, and the contract needs at least
    // one image source to be true or it will resolve vision off even with an
    // mmproj loaded.
    cameraAvailable: false,
    photoLibraryAvailable: input.supportsVision,
    availableAccelerationModes:
      input.acceleration === 'cpu' ? ['cpu'] : ['cpu', input.acceleration],
    notes: [],
  };
}

export function buildModelDeclaration(input: {
  probe: ActivationModelProbeInput;
  props: LlamaServerProps;
  contextTokens?: number;
  supportsVision: boolean;
  streaming: boolean;
}): ModelCapabilityDeclaration {
  const filePath = input.probe.filePath || input.props.modelPath || 'local';
  const inferred = inferKnownModelCapabilities({
    modelId: input.probe.modelId,
    filePath,
    projectorPath: input.probe.projectorPath ?? null,
  });
  const format = detectActivationModelFormat(filePath, input.probe.modelFormatHint);

  const notes = [...inferred.notes];
  if (input.props.contextTokens) {
    notes.push(`Context window reported by llama-server: ${input.props.contextTokens} tokens.`);
  }
  if (input.props.chatTemplatePresent === false) {
    notes.push(
      'llama-server reports no chat template; multi-turn formatting falls back to the server default.',
    );
  }

  return {
    modelId: input.probe.modelId,
    modelPath: filePath,
    modelFormat: format,
    inputModalities: input.supportsVision ? ['text', 'image'] : ['text'],
    outputModalities: ['text'],
    contextWindowTokens:
      input.contextTokens ?? input.props.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
    supportsTextCompletion: true,
    supportsTextChat: true,
    supportsStreaming: input.streaming,
    // Both are backend features here, not model features: the grammar is
    // enforced by llama.cpp's sampler and the tool loop is driven by the SDK,
    // so every GGUF the server can load supports them.
    structuredJsonOutput: true,
    toolCalling: true,
    requiresProjector: input.supportsVision,
    projectorAttached: input.supportsVision,
    projectorPath: input.probe.projectorPath ?? null,
    notes,
  };
}
