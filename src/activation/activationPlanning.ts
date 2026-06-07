import type {
  ActivationCapabilitySnapshot,
  ActivationMemoryAssessment,
  AppCapabilityRequirements,
  DeviceCapabilityDeclaration,
  ModelCapabilityDeclaration,
} from './activationContract';

const MB = 1024 * 1024;

export interface ActivationRecommendedModel {
  id: string;
  label: string;
  description?: string;
  minimumMemoryMb?: number;
  preferred?: boolean;
}

export interface ActivationOnboardingPlan {
  readiness: 'ready' | 'degraded' | 'not_recommended';
  summary: string;
  requiredTraits: string[];
  developerChecklist: string[];
  userInstallSteps: string[];
  recommendedModels: ActivationRecommendedModel[];
  warnings: string[];
}

export interface BuildActivationOnboardingPlanInput {
  appName?: string;
  appRequirements?: AppCapabilityRequirements;
  snapshot: ActivationCapabilitySnapshot;
  recommendedModels?: ActivationRecommendedModel[];
}

export function assessActivationMemoryFit(
  model: ModelCapabilityDeclaration,
  device: DeviceCapabilityDeclaration,
): ActivationMemoryAssessment {
  const estimatedModelFootprintMb =
    typeof model.estimatedRuntimeMemoryMb === 'number'
      ? Math.max(1, Math.round(model.estimatedRuntimeMemoryMb))
      : estimateModelRuntimeMemoryMb(model);
  const recommendedMinimumMemoryMb =
    typeof estimatedModelFootprintMb === 'number'
      ? Math.ceil(estimatedModelFootprintMb * 1.2)
      : undefined;
  const deviceMemoryMb =
    device.availableMemoryMb ?? device.memoryClassMb ?? device.totalMemoryMb;

  if (
    typeof estimatedModelFootprintMb !== 'number' ||
    typeof recommendedMinimumMemoryMb !== 'number'
  ) {
    return {
      status: 'unknown',
      estimatedModelFootprintMb,
      recommendedMinimumMemoryMb,
      deviceMemoryMb,
      detail:
        "The SDK could not confidently estimate this model's runtime memory footprint yet.",
    };
  }

  if (typeof deviceMemoryMb !== 'number') {
    return {
      status: 'unknown',
      estimatedModelFootprintMb,
      recommendedMinimumMemoryMb,
      deviceMemoryMb,
      detail:
        'The device did not report enough memory information to judge whether this model is a safe fit.',
    };
  }

  if (deviceMemoryMb < estimatedModelFootprintMb) {
    return {
      status: 'insufficient',
      estimatedModelFootprintMb,
      recommendedMinimumMemoryMb,
      deviceMemoryMb,
      detail: `Estimated runtime memory is about ${estimatedModelFootprintMb} MB, but the device only advertises about ${Math.round(deviceMemoryMb)} MB available for this process class.`,
    };
  }

  if (deviceMemoryMb < recommendedMinimumMemoryMb || device.lowRamDevice) {
    return {
      status: 'tight',
      estimatedModelFootprintMb,
      recommendedMinimumMemoryMb,
      deviceMemoryMb,
      detail: `The model may run, but memory headroom is tight at about ${Math.round(deviceMemoryMb)} MB available versus a recommended ${recommendedMinimumMemoryMb} MB.`,
    };
  }

  return {
    status: 'supported',
    estimatedModelFootprintMb,
    recommendedMinimumMemoryMb,
    deviceMemoryMb,
    detail: `Estimated runtime memory is about ${estimatedModelFootprintMb} MB with enough device headroom for normal use.`,
  };
}

export function estimateModelRuntimeMemoryMb(
  model: Pick<
    ModelCapabilityDeclaration,
    | 'fileSizeBytes'
    | 'inputModalities'
    | 'contextWindowTokens'
    | 'modelFormat'
    | 'requiresProjector'
  >,
): number | undefined {
  if (typeof model.fileSizeBytes !== 'number' || model.fileSizeBytes <= 0) {
    return undefined;
  }

  const baseFootprintMb = model.fileSizeBytes / MB;
  const formatMultiplier =
    model.modelFormat === 'litert-lm'
      ? 1.15
      : model.modelFormat === 'gguf'
        ? 1.35
        : 1.25;
  let estimated = Math.ceil(baseFootprintMb * formatMultiplier);

  if (model.inputModalities.includes('image')) {
    estimated += model.modelFormat === 'litert-lm' ? 320 : 384;
  }

  if (model.requiresProjector) {
    estimated += 192;
  }

  if (
    typeof model.contextWindowTokens === 'number' &&
    model.contextWindowTokens > 4096
  ) {
    estimated += Math.min(
      768,
      Math.ceil(((model.contextWindowTokens - 4096) / 4096) * 128),
    );
  }

  return Math.max(estimated, Math.ceil(baseFootprintMb));
}

export function buildActivationOnboardingPlan(
  input: BuildActivationOnboardingPlanInput,
): ActivationOnboardingPlan {
  const appName = input.appName?.trim() || 'This app';
  const requirements = input.appRequirements ?? input.snapshot.appRequirements;
  const memoryAssessment = input.snapshot.resolvedContract.memoryAssessment;
  const warnings = [
    ...input.snapshot.resolvedContract.warnings,
    ...(memoryAssessment.status === 'tight' ? [memoryAssessment.detail] : []),
  ];

  const readiness =
    !input.snapshot.resolvedContract.compatible ||
    memoryAssessment.status === 'insufficient'
      ? 'not_recommended'
      : input.snapshot.resolvedContract.degraded ||
          memoryAssessment.status === 'tight'
        ? 'degraded'
        : 'ready';

  const summary =
    readiness === 'ready'
      ? `${appName} can activate this local model on the current device.`
      : readiness === 'degraded'
        ? `${appName} can activate this model, but the SDK expects some limitations or low-memory pressure.`
        : `${appName} should steer the user toward a different local model or a stronger device before activation.`;

  const requiredTraits = buildRequiredTraits(requirements);
  const recommendedModels = rankRecommendedModels(
    input.recommendedModels ?? [],
    memoryAssessment,
  );

  return {
    readiness,
    summary,
    requiredTraits,
    developerChecklist: [
      'Call `resolveAppRequirements()` before activation so the app can explain compatibility honestly.',
      'Show the user why a model is compatible, degraded, or blocked instead of failing at inference time.',
      "Offer 2-3 recommended local models that match the app's modalities and context needs.",
      'Persist observed probe results after import so future checks rely less on guesswork and more on real behavior.',
      'Keep a clean fallback path for CPU-only or low-memory devices.',
    ],
    userInstallSteps: [
      `Choose a local model that matches ${appName}'s required traits: ${requiredTraits.join(', ')}.`,
      'Import or download the model package inside the app.',
      'Let the SDK probe the model and device before activation.',
      'If the SDK reports degraded or incompatible status, switch to a smaller or better-matched model.',
      'Activate the model only after the compatibility summary looks healthy.',
    ],
    recommendedModels,
    warnings,
  };
}

function buildRequiredTraits(requirements: AppCapabilityRequirements): string[] {
  const traits = ['text generation'];
  if (requirements.textChat) {
    traits.push('chat/instruction following');
  }
  if (requirements.streaming) {
    traits.push('streaming responses');
  }
  if (requirements.visionImageInput) {
    traits.push('vision/image input');
  }
  if (requirements.structuredJsonOutput) {
    traits.push('reliable structured JSON');
  }
  if (typeof requirements.minContextTokens === 'number') {
    traits.push(`at least ${requirements.minContextTokens} context tokens`);
  }
  return traits;
}

function rankRecommendedModels(
  models: ActivationRecommendedModel[],
  memoryAssessment: ActivationMemoryAssessment,
): ActivationRecommendedModel[] {
  if (models.length === 0) {
    return [];
  }

  const deviceMemoryMb = memoryAssessment.deviceMemoryMb;
  return [...models]
    .sort((left, right) => {
      const leftFits =
        typeof left.minimumMemoryMb !== 'number' ||
        typeof deviceMemoryMb !== 'number' ||
        left.minimumMemoryMb <= deviceMemoryMb;
      const rightFits =
        typeof right.minimumMemoryMb !== 'number' ||
        typeof deviceMemoryMb !== 'number' ||
        right.minimumMemoryMb <= deviceMemoryMb;

      if (leftFits !== rightFits) {
        return leftFits ? -1 : 1;
      }

      if (left.preferred !== right.preferred) {
        return left.preferred ? -1 : 1;
      }

      return (left.minimumMemoryMb ?? 0) - (right.minimumMemoryMb ?? 0);
    })
    .slice(0, 3);
}
