import type {
  ActivationModelProbeInput,
  ActivationSession,
  ActivationSessionCreateInput,
} from './activationAdapter';
import type {
  ActivationCapabilitySnapshot,
  AppCapabilityRequirements,
  BackendCapabilityDeclaration,
  DeviceCapabilityDeclaration,
  ModelCapabilityDeclaration,
} from './activationContract';
import type {
  ActivationOnboardingPlan,
  ActivationRecommendedModel,
} from './activationPlanning';
import type { ActivationObservedCapabilities } from './observedCapabilities';
import type { ActivationManager } from './activationManager';
import { buildActivationOnboardingPlan } from './activationPlanning';

export interface CustomAppActivationClient {
  getBackendCapabilities(forceRefresh?: boolean): Promise<BackendCapabilityDeclaration>;
  getDeviceCapabilities(forceRefresh?: boolean): Promise<DeviceCapabilityDeclaration>;
  probeModel(
    input: ActivationModelProbeInput,
    options?: { forceRefresh?: boolean },
  ): Promise<ModelCapabilityDeclaration>;
  getObservedCapabilities(input: ActivationModelProbeInput): ActivationObservedCapabilities | null;
  runObservedCapabilityProbes(
    input: ActivationModelProbeInput,
    options?: { forceRefresh?: boolean; saveResults?: boolean },
  ): Promise<ActivationObservedCapabilities>;
  diagnoseModel(input: {
    model: ActivationModelProbeInput;
    appRequirements?: AppCapabilityRequirements;
    preferredAcceleration?: Array<'cpu' | 'gpu' | 'npu'>;
  }): Promise<ActivationCapabilitySnapshot>;
  resolveAppRequirements(input: {
    model: ActivationModelProbeInput;
    appRequirements?: AppCapabilityRequirements;
    preferredAcceleration?: Array<'cpu' | 'gpu' | 'npu'>;
  }): Promise<ActivationCapabilitySnapshot>;
  buildOnboardingPlan(input: {
    appName?: string;
    model: ActivationModelProbeInput;
    appRequirements?: AppCapabilityRequirements;
    preferredAcceleration?: Array<'cpu' | 'gpu' | 'npu'>;
    recommendedModels?: ActivationRecommendedModel[];
  }): Promise<ActivationOnboardingPlan>;
  activateModel(
    input: ActivationSessionCreateInput,
    options?: {
      compatibilityPolicy?: 'permissive' | 'strict';
    },
  ): Promise<ActivationSession>;
}

export function createCustomAppActivationClient(
  manager: ActivationManager,
): CustomAppActivationClient {
  return {
    getBackendCapabilities: (forceRefresh) => manager.listBackendCapabilities(forceRefresh),
    getDeviceCapabilities: (forceRefresh) => manager.probeDeviceCapabilities(forceRefresh),
    probeModel: (input, options) => manager.probeModel(input, options),
    getObservedCapabilities: (input) => manager.getObservedCapabilities(input),
    runObservedCapabilityProbes: (input, options) =>
      manager.runObservedCapabilityProbes(input, options),
    diagnoseModel: (input) => manager.resolveCompatibility(input),
    resolveAppRequirements: (input) => manager.resolveCompatibility(input),
    buildOnboardingPlan: async (input) => {
      const snapshot = await manager.resolveCompatibility({
        model: input.model,
        appRequirements: input.appRequirements,
        preferredAcceleration: input.preferredAcceleration,
      });
      return buildActivationOnboardingPlan({
        appName: input.appName,
        appRequirements: input.appRequirements,
        snapshot,
        recommendedModels: input.recommendedModels,
      });
    },
    activateModel: async (input, options) => {
      if (options?.compatibilityPolicy === 'strict') {
        const snapshot = await manager.resolveCompatibility({
          model: {
            modelId: input.modelId,
            filePath: input.filePath,
            projectorPath: input.projectorPath,
            runtimeHint: input.runtimeHint,
            modelFormatHint: input.modelFormatHint,
            observedCapabilities: input.observedCapabilities,
          },
          appRequirements: input.appRequirements,
          preferredAcceleration: input.preferredAcceleration,
        });

        if (!snapshot.resolvedContract.compatible) {
          throw new Error(
            snapshot.resolvedContract.reasons[0]
              ?? 'Local model activation failed compatibility checks.',
          );
        }
      }

      return manager.createSession(input);
    },
  };
}
