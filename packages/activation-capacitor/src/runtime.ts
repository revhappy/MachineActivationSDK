import {
  detectActivationModelFormat,
  inferKnownModelCapabilities,
  resolveCapabilityContract,
  type ActivationCapabilitySnapshot,
  type ActivationChatMessage,
  type ActivationCompletionOptions,
  type ActivationCompletionResult,
  type ActivationContextState,
  type ActivationDiagnostics,
  type ActivationModelProbeInput,
  type ActivationRuntime,
  type ActivationSession,
  type ActivationSessionCreateInput,
  type AppCapabilityRequirements,
  type BackendCapabilityDeclaration,
  type DeviceCapabilityDeclaration,
  type ModelCapabilityDeclaration,
  type ResolvedCapabilityContract,
} from 'machineai-activation';
import {
  isMachineActivationPluginAvailable,
  MachineActivationNative,
} from './plugin';

const ADAPTER_ID = 'litert.capacitor.android';
const DEFAULT_CONTEXT_TOKENS = 4096;
const ACTIVATION_CONTRACT_SCHEMA_VERSION = '1.0.0-alpha.1';

declare global {
  // eslint-disable-next-line no-var
  var __MACHINE_ACTIVATION_RUNTIME_FACTORY__:
    | (() => Promise<ActivationRuntime> | ActivationRuntime)
    | undefined;
}

function assertPluginAvailable(): void {
  if (!isMachineActivationPluginAvailable()) {
    throw new Error(
      'Machine Activation local mode is only available on Android builds that include the native Capacitor plugin.',
    );
  }
}

async function listBackendCapabilities(): Promise<BackendCapabilityDeclaration> {
  assertPluginAvailable();
  const backend = await MachineActivationNative.getBackendInfo();
  return {
    backendId: backend.backendId,
    backendName: backend.backendName,
    backendVersion: backend.backendVersion,
    sessionCreationAvailable: backend.sessionCreationAvailable,
    supportsStreaming: backend.supportsStreaming,
    supportsVision: backend.supportsVision,
    supportsStructuredJsonOutput: backend.supportsStructuredJsonOutput,
    supportsToolCalling: backend.supportsToolCalling,
    supportsCancellation: backend.supportsCancellation,
    supportedAccelerationModes: sanitizeStringArray(backend.supportedAccelerationModes, [
      'cpu',
    ]) as Array<'cpu' | 'gpu' | 'npu'>,
    detectedDevices: sanitizeStringArray(backend.detectedDevices, ['android-device']),
    notes: sanitizeStringArray(backend.notes, []),
  };
}

async function probeDeviceCapabilities(): Promise<DeviceCapabilityDeclaration> {
  assertPluginAvailable();
  const device = await MachineActivationNative.getDeviceInfo();
  return {
    platform: device.platform ?? 'android',
    deviceManufacturer: device.manufacturer,
    deviceModel: device.model,
    cameraAvailable: true,
    photoLibraryAvailable: true,
    availableAccelerationModes: ['cpu', 'gpu'],
    memoryClassMb: coerceNumber(device.memoryClassMb),
    totalMemoryMb: coerceNumber(device.totalMemoryMb),
    availableMemoryMb: coerceNumber(device.availableMemoryMb),
    lowRamDevice: device.lowRamDevice === true,
    supportedAbis: sanitizeStringArray(device.supportedAbis, []),
    notes: [
      'Device capabilities are reported by the local Capacitor Machine Activation plugin.',
    ],
  };
}

async function probeModelPackage(
  input: ActivationModelProbeInput,
): Promise<ModelCapabilityDeclaration> {
  assertPluginAvailable();
  const probe = await MachineActivationNative.probeModelPackage({
    modelPath: input.filePath,
    projectorPath: input.projectorPath ?? null,
  });

  if (!probe.exists) {
    throw new Error(`Local model file was not found: ${input.filePath}`);
  }

  const inferred = inferKnownModelCapabilities({
    modelId: input.modelId,
    filePath: input.filePath,
    projectorPath: input.projectorPath ?? null,
  });
  const format = detectActivationModelFormat(input.filePath, input.modelFormatHint);
  const inputModalities =
    inferred.inferredFields.inputModalities ??
    (probe.supportsVisionGuess ? ['text', 'image'] : ['text']);

  return {
    modelId: input.modelId,
    modelPath: input.filePath,
    modelFormat: format,
    architecture: probe.supportsVisionGuess ? 'gemma-family-multimodal' : 'unknown',
    fileSizeBytes: coerceNumber(probe.fileSizeBytes),
    inputModalities,
    outputModalities: ['text'],
    contextWindowTokens: probe.supportsVisionGuess ? 32768 : DEFAULT_CONTEXT_TOKENS,
    supportsTextCompletion: true,
    supportsTextChat: true,
    supportsStreaming: false,
    structuredJsonOutput: inferred.inferredFields.structuredJsonOutput === true,
    toolCalling: inferred.inferredFields.toolCalling === true,
    requiresProjector: false,
    projectorAttached: false,
    projectorPath: null,
    notes: [
      ...inferred.notes,
      'Model probing currently uses file metadata plus framework capability inference for this Capacitor adapter.',
    ],
  };
}

async function createSession(
  input: ActivationSessionCreateInput,
): Promise<ActivationSession> {
  assertPluginAvailable();
  const [backend, device, model] = await Promise.all([
    listBackendCapabilities(),
    probeDeviceCapabilities(),
    probeModelPackage(input),
  ]);

  const sessionSupportsVision =
    backend.supportsVision &&
    (input.appRequirements?.visionImageInput === true ||
      model.inputModalities.includes('image'));

  const nativeSession = await MachineActivationNative.createSession({
    modelPath: input.filePath,
    contextWindowTokens:
      input.contextWindowTokens ?? model.contextWindowTokens ?? DEFAULT_CONTEXT_TOKENS,
    contextStrategy: input.contextStrategy ?? 'fresh',
    supportsVision: sessionSupportsVision,
    preferredAcceleration: input.preferredAcceleration,
  });

  const appRequirements: AppCapabilityRequirements = {
    textCompletion: true,
    textChat: true,
    ...input.appRequirements,
  };

  const diagnostics: ActivationDiagnostics = {
    sourceAdapterId: ADAPTER_ID,
    backendId: backend.backendId,
    backendName: nativeSession.backendName,
    backendVersion: nativeSession.backendVersion,
    accelerationMode: 'cpu',
    backendSummary: 'Capacitor Machine Activation plugin over LiteRT-LM.',
    backendDetails:
      'This first adapter is Android-only, .litertlm-first, and currently uses non-streaming request execution.',
    devicesSummary: device.deviceModel ?? device.platform,
    deviceSummary: `${device.platform} (${device.availableAccelerationModes.join(', ')})`,
  };

  const visionAdjustedModel: ModelCapabilityDeclaration =
    sessionSupportsVision && !model.inputModalities.includes('image')
      ? { ...model, inputModalities: ['text', 'image'] }
      : model;

  const resolvedContract = resolveCapabilityContract({
    appRequirements,
    model: visionAdjustedModel,
    backend,
    device,
    preferredAcceleration: input.preferredAcceleration,
  });

  return new CapacitorMachineActivationSession({
    sessionId: nativeSession.sessionId,
    modelId: input.modelId,
    appRequirements,
    backend,
    device,
    model: visionAdjustedModel,
    resolvedContract,
    diagnostics,
  });
}

export function createCapacitorMachineActivationRuntime(): ActivationRuntime {
  return {
    id: ADAPTER_ID,
    name: 'Machine Activation Capacitor LiteRT',
    version: 'litertlm-android',
    supportedModelFormats: ['litert-lm'],
    canHandleModel(input) {
      return input.filePath.toLowerCase().endsWith('.litertlm');
    },
    listBackendCapabilities,
    probeDeviceCapabilities,
    probeModelPackage,
    createSession,
  };
}

class CapacitorMachineActivationSession implements ActivationSession {
  readonly backendId = ADAPTER_ID;

  readonly modelId?: string;

  readonly capabilitySnapshot: ActivationCapabilitySnapshot;

  resolvedContract: ResolvedCapabilityContract;

  private readonly sessionId: string;

  private diagnosticsSnapshot: ActivationDiagnostics;

  constructor(input: {
    sessionId: string;
    modelId?: string;
    appRequirements: AppCapabilityRequirements;
    backend: BackendCapabilityDeclaration;
    device: DeviceCapabilityDeclaration;
    model: ModelCapabilityDeclaration;
    resolvedContract: ResolvedCapabilityContract;
    diagnostics: ActivationDiagnostics;
  }) {
    this.sessionId = input.sessionId;
    this.modelId = input.modelId;
    this.resolvedContract = input.resolvedContract;
    this.diagnosticsSnapshot = input.diagnostics;
    this.capabilitySnapshot = {
      schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
      appRequirements: input.appRequirements,
      backend: input.backend,
      device: input.device,
      model: input.model,
      resolvedContract: input.resolvedContract,
      diagnostics: input.diagnostics,
    };
  }

  async complete(
    prompt: string,
    options: ActivationCompletionOptions = {},
  ): Promise<ActivationCompletionResult> {
    const result = await MachineActivationNative.complete({
      sessionId: this.sessionId,
      prompt,
      options: convertOptions(options),
    });
    this.diagnosticsSnapshot = await this.diagnostics();
    return normalizeCompletionResult(result);
  }

  async completeChat(
    messages: ActivationChatMessage[],
    options: ActivationCompletionOptions = {},
  ): Promise<ActivationCompletionResult> {
    const result = await MachineActivationNative.completeChat({
      sessionId: this.sessionId,
      messages,
      options: convertOptions(options),
    });
    this.diagnosticsSnapshot = await this.diagnostics();
    return normalizeCompletionResult(result);
  }

  async contextState(): Promise<ActivationContextState> {
    const result = await MachineActivationNative.contextState({
      sessionId: this.sessionId,
    });
    return {
      strategy:
        result.strategy === 'reuse' ||
        result.strategy === 'fresh' ||
        result.strategy === 'sliding_window'
          ? result.strategy
          : 'fresh',
      reuseStateAvailable: result.reuseStateAvailable === true,
      maxContextTokens: coerceNumber(result.maxContextTokens),
      cachedTokens: coerceNumber(result.cachedTokens),
      lastPromptTokens: coerceNumber(result.lastPromptTokens),
      contextFull: result.contextFull === true,
      overflowStrategy:
        result.overflowStrategy === 'sliding_window' ? 'sliding_window' : 'reset',
      notes: sanitizeStringArray(result.notes, []),
    };
  }

  async resetContext(options?: { clearData?: boolean }): Promise<void> {
    void options;
    await MachineActivationNative.resetContext({ sessionId: this.sessionId });
  }

  async probeVisionReadiness(): Promise<{ ready: boolean; detail: string }> {
    return MachineActivationNative.probeVisionReadiness({ sessionId: this.sessionId });
  }

  async diagnostics(): Promise<ActivationDiagnostics> {
    const result = await MachineActivationNative.diagnostics({
      sessionId: this.sessionId,
    });
    this.diagnosticsSnapshot = {
      sourceAdapterId: ADAPTER_ID,
      backendId: result.backendId,
      backendName: result.backendName,
      backendVersion: result.backendVersion,
      accelerationMode:
        result.accelerationMode === 'gpu' || result.accelerationMode === 'npu'
          ? result.accelerationMode
          : 'cpu',
      backendSummary: result.backendSummary,
      backendDetails: result.backendDetails,
      devicesSummary: result.devicesSummary,
      deviceSummary: result.deviceSummary,
      recentLogs: sanitizeStringArray(result.recentLogs, []),
    };
    return this.diagnosticsSnapshot;
  }

  async abort(): Promise<void> {
    await MachineActivationNative.abort({ sessionId: this.sessionId });
  }

  async close(): Promise<void> {
    await MachineActivationNative.closeSession({ sessionId: this.sessionId });
  }
}

function convertOptions(options: ActivationCompletionOptions): {
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
} {
  return {
    systemPrompt: options.systemPrompt,
    temperature: options.temperature,
    topP: options.topP,
    topK: options.topK,
    maxTokens: options.maxTokens,
  };
}

function normalizeCompletionResult(result: {
  text: string;
  tokensGenerated: number;
  tokensPerSecond: number;
}): ActivationCompletionResult {
  return {
    text: result.text ?? '',
    reasoningText: '',
    tokensGenerated: coerceNumber(result.tokensGenerated) ?? 0,
    tokensPerSecond: coerceNumber(result.tokensPerSecond) ?? 0,
  };
}

function sanitizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function coerceNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function registerCapacitorMachineActivationRuntime(): void {
  if (typeof globalThis === 'undefined') {
    return;
  }

  globalThis.__MACHINE_ACTIVATION_RUNTIME_FACTORY__ = async () => {
    assertPluginAvailable();
    return createCapacitorMachineActivationRuntime();
  };
}
