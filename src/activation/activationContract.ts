import { assessActivationMemoryFit } from './activationPlanning';

export const ACTIVATION_CONTRACT_SCHEMA_VERSION = '1.0.0-alpha.1';

export type ActivationAccelerationMode = 'cpu' | 'gpu' | 'npu';

export type ActivationInputModality = 'text' | 'image';
export type ActivationOutputModality = 'text';

export interface AppCapabilityRequirements {
  textCompletion?: boolean;
  textChat?: boolean;
  streaming?: boolean;
  visionImageInput?: boolean;
  structuredJsonOutput?: boolean;
  toolCalling?: boolean;
  minContextTokens?: number;
  requiresProjector?: boolean;
  preferredAcceleration?: ActivationAccelerationMode[];
}

export interface ModelCapabilityDeclaration {
  modelId?: string;
  modelPath: string;
  modelFormat?: string;
  architecture?: string;
  fileSizeBytes?: number;
  estimatedRuntimeMemoryMb?: number;
  inputModalities: ActivationInputModality[];
  outputModalities: ActivationOutputModality[];
  contextWindowTokens?: number;
  supportsTextCompletion: boolean;
  supportsTextChat: boolean;
  supportsStreaming: boolean;
  structuredJsonOutput: boolean;
  toolCalling: boolean;
  requiresProjector: boolean;
  projectorAttached: boolean;
  projectorPath?: string | null;
  notes: string[];
}

export interface BackendCapabilityDeclaration {
  backendId: string;
  backendName: string;
  backendVersion?: string;
  sessionCreationAvailable: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsStructuredJsonOutput: boolean;
  supportsToolCalling: boolean;
  supportsCancellation: boolean;
  supportedAccelerationModes: ActivationAccelerationMode[];
  detectedDevices: string[];
  notes: string[];
}

export interface DeviceCapabilityDeclaration {
  platform: string;
  deviceManufacturer?: string;
  deviceModel?: string;
  cameraAvailable: boolean;
  photoLibraryAvailable: boolean;
  availableAccelerationModes: ActivationAccelerationMode[];
  memoryClassMb?: number;
  totalMemoryMb?: number;
  availableMemoryMb?: number;
  lowRamDevice?: boolean;
  supportedAbis?: string[];
  notes: string[];
}

export interface ActivationMemoryAssessment {
  status: 'supported' | 'tight' | 'insufficient' | 'unknown';
  estimatedModelFootprintMb?: number;
  recommendedMinimumMemoryMb?: number;
  deviceMemoryMb?: number;
  detail: string;
}

export interface ResolvedActivationCapabilities {
  textCompletion: boolean;
  textChat: boolean;
  streaming: boolean;
  visionImageInput: boolean;
  structuredJsonOutput: boolean;
  toolCalling: boolean;
  projectorReady: boolean;
  contextWindowTokens?: number;
  accelerationMode: ActivationAccelerationMode;
}

export interface ResolvedCapabilityContract {
  schemaVersion: string;
  compatible: boolean;
  degraded: boolean;
  compatibility: 'compatible' | 'degraded' | 'incompatible';
  resolvedCapabilities: ResolvedActivationCapabilities;
  memoryAssessment: ActivationMemoryAssessment;
  reasons: string[];
  warnings: string[];
}

export interface ActivationDiagnostics {
  sourceAdapterId: string;
  backendId: string;
  backendName?: string;
  backendVersion?: string;
  accelerationMode: ActivationAccelerationMode;
  backendSummary?: string;
  backendDetails?: string;
  devicesSummary?: string;
  deviceSummary?: string;
  usedDevices?: string[];
  recentLogs?: string[];
}

export interface ActivationCapabilitySnapshot {
  schemaVersion: string;
  appRequirements: AppCapabilityRequirements;
  model: ModelCapabilityDeclaration;
  backend: BackendCapabilityDeclaration;
  device: DeviceCapabilityDeclaration;
  resolvedContract: ResolvedCapabilityContract;
  diagnostics: ActivationDiagnostics;
}

interface ResolveCapabilityContractInput {
  appRequirements?: AppCapabilityRequirements;
  model: ModelCapabilityDeclaration;
  backend: BackendCapabilityDeclaration;
  device: DeviceCapabilityDeclaration;
  preferredAcceleration?: ActivationAccelerationMode[];
}

export function resolveCapabilityContract({
  appRequirements,
  model,
  backend,
  device,
  preferredAcceleration,
}: ResolveCapabilityContractInput): ResolvedCapabilityContract {
  const requirements = appRequirements ?? {};
  const reasons: string[] = [];
  const warnings: string[] = [];

  const accelerationMode = resolveAccelerationMode(
    backend.supportedAccelerationModes,
    device.availableAccelerationModes,
    preferredAcceleration ?? requirements.preferredAcceleration,
  );

  const visionSupported =
    model.inputModalities.includes('image') &&
    backend.supportsVision &&
    (device.cameraAvailable || device.photoLibraryAvailable);
  const projectorReady = !model.requiresProjector || model.projectorAttached;

  const resolvedCapabilities: ResolvedActivationCapabilities = {
    textCompletion: model.supportsTextCompletion,
    textChat: model.supportsTextChat,
    streaming: model.supportsStreaming && backend.supportsStreaming,
    visionImageInput: visionSupported && projectorReady,
    structuredJsonOutput: model.structuredJsonOutput && backend.supportsStructuredJsonOutput,
    toolCalling: model.toolCalling && backend.supportsToolCalling,
    projectorReady,
    contextWindowTokens: model.contextWindowTokens,
    accelerationMode,
  };
  const memoryAssessment = assessActivationMemoryFit(model, device);

  if (requirements.textCompletion && !resolvedCapabilities.textCompletion) {
    reasons.push('The active model/backend combination does not support text completion.');
  }

  if (!backend.sessionCreationAvailable) {
    reasons.push('This runtime adapter recognizes the model format but cannot activate live inference sessions yet.');
  }

  if (requirements.textChat && !resolvedCapabilities.textChat) {
    reasons.push('The active model/backend combination does not support chat-style prompting.');
  }

  if (requirements.streaming && !resolvedCapabilities.streaming) {
    reasons.push('Streaming is required, but the active backend cannot stream responses.');
  }

  if (
    requirements.visionImageInput &&
    (!backend.supportsVision || (!device.cameraAvailable && !device.photoLibraryAvailable))
  ) {
    reasons.push('Image input is required, but the backend or current device does not support vision input.');
  }

  if (requirements.visionImageInput && !projectorReady) {
    reasons.push('Image input is required, but the model still needs a matching projector file.');
  }

  if (
    requirements.visionImageInput &&
    projectorReady &&
    !model.inputModalities.includes('image')
  ) {
    warnings.push(
      'Vision support is not explicitly verified for this model, but the framework will attempt multimodal activation because a projector is attached.',
    );
  }

  if (requirements.structuredJsonOutput && !backend.supportsStructuredJsonOutput) {
    warnings.push(
      'Structured JSON output is preferred, but the active backend does not support structured output guidance.',
    );
  }

  if (
    requirements.structuredJsonOutput &&
    backend.supportsStructuredJsonOutput &&
    !model.structuredJsonOutput
  ) {
    warnings.push(
      'Structured JSON output is not explicitly verified for this model, so the framework will treat it as best-effort instead of guaranteed.',
    );
  }

  if (requirements.toolCalling && !backend.supportsToolCalling) {
    reasons.push('Tool calling is required, but the active backend does not support it.');
  }

  if (requirements.toolCalling && backend.supportsToolCalling && !model.toolCalling) {
    warnings.push(
      'Tool calling is not explicitly verified for this model, so the framework will treat it as best-effort instead of guaranteed.',
    );
  }

  if (requirements.requiresProjector && !projectorReady) {
    reasons.push('This app requires a projector-ready multimodal model, but no projector is attached.');
  }

  if (
    typeof requirements.minContextTokens === 'number' &&
    typeof model.contextWindowTokens === 'number' &&
    model.contextWindowTokens < requirements.minContextTokens
  ) {
    warnings.push(
      `This app prefers at least ${requirements.minContextTokens} context tokens, but the model advertises ${model.contextWindowTokens}.`,
    );
  }

  if (accelerationMode === 'cpu') {
    const deviceHasBetterAcceleration = device.availableAccelerationModes.some((mode) => mode !== 'cpu');
    if (deviceHasBetterAcceleration) {
      warnings.push('The current session is running on CPU fallback instead of GPU or NPU acceleration.');
    }
  }

  if (model.requiresProjector && !projectorReady && !requirements.visionImageInput) {
    warnings.push('This model appears to support multimodal input, but no projector is attached yet.');
  }

  if (resolvedCapabilities.visionImageInput && !device.cameraAvailable && !device.photoLibraryAvailable) {
    warnings.push('Vision is technically supported, but this device currently exposes no image input source.');
  }

  if (typeof model.contextWindowTokens !== 'number') {
    warnings.push('The model did not advertise a context window, so long-context suitability is not verified.');
  }

  if (memoryAssessment.status === 'insufficient') {
    warnings.push(memoryAssessment.detail);
  } else if (memoryAssessment.status === 'tight') {
    warnings.push(memoryAssessment.detail);
  } else if (memoryAssessment.status === 'unknown') {
    warnings.push(memoryAssessment.detail);
  }

  if (requirements.structuredJsonOutput && !resolvedCapabilities.structuredJsonOutput) {
    warnings.push(
      'This app prefers structured JSON output, but the current stack may only offer best-effort JSON generation.',
    );
  }

  const compatible = reasons.length === 0;
  const degraded = compatible && warnings.length > 0;

  return {
    schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
    compatible,
    degraded,
    compatibility: compatible ? (degraded ? 'degraded' : 'compatible') : 'incompatible',
    resolvedCapabilities,
    memoryAssessment,
    reasons,
    warnings,
  };
}

function resolveAccelerationMode(
  backendModes: ActivationAccelerationMode[],
  deviceModes: ActivationAccelerationMode[],
  preferredModes?: ActivationAccelerationMode[],
): ActivationAccelerationMode {
  const supportedModes = intersectAccelerationModes(backendModes, deviceModes);
  const preferred = preferredModes && preferredModes.length > 0
    ? preferredModes
    : (['npu', 'gpu', 'cpu'] as ActivationAccelerationMode[]);

  for (const mode of preferred) {
    if (supportedModes.includes(mode)) {
      return mode;
    }
  }

  return 'cpu';
}

function intersectAccelerationModes(
  left: ActivationAccelerationMode[],
  right: ActivationAccelerationMode[],
): ActivationAccelerationMode[] {
  const rightSet = new Set(right);
  return left.filter((mode) => rightSet.has(mode));
}
