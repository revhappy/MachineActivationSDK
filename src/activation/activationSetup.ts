import {
  normalizeStoredActivationModelConfig,
  pickActivationModelConfig,
  type ActivationConfigValidationResult,
  type ActivationModelConfigPreset,
  type ActivationModelConfigStorage,
  type ActivationModelFilePicker,
  type ActivationStoredModelConfig,
  validateStoredActivationModelConfig,
} from './activationConfig';

export interface ActivationModelVerificationResult {
  status: 'verified' | 'advisory' | 'failed';
  message: string;
  detail?: string;
  normalizedConfig?: Partial<ActivationStoredModelConfig>;
  metadata?: Record<string, unknown>;
}

export interface ActivationModelVerifier {
  verify(input: {
    config: ActivationStoredModelConfig;
    preset: ActivationModelConfigPreset;
  }): Promise<ActivationModelVerificationResult>;
}

export interface ActivationModelSetupState {
  savedConfig: ActivationStoredModelConfig | null;
  draftConfig: ActivationStoredModelConfig | null;
  validation: ActivationConfigValidationResult;
  hasSavedConfig: boolean;
  hasUnsavedChanges: boolean;
}

export interface ActivationModelPickResult {
  config: ActivationStoredModelConfig;
  verification: ActivationModelVerificationResult | null;
}

export interface ActivationModelSetupController {
  loadState(draftConfig?: ActivationStoredModelConfig | null): ActivationModelSetupState;
  getSavedConfig(): ActivationStoredModelConfig | null;
  pickModel(): Promise<ActivationModelPickResult | null>;
  verifyConfig(
    config: ActivationStoredModelConfig,
  ): Promise<ActivationModelVerificationResult | null>;
  saveConfig(config: ActivationStoredModelConfig | null): ActivationModelSetupState;
  clearSavedConfig(): ActivationModelSetupState;
}

export function createActivationModelSetupController(options: {
  storage: ActivationModelConfigStorage;
  picker: ActivationModelFilePicker;
  preset: ActivationModelConfigPreset;
  verifier?: ActivationModelVerifier;
}): ActivationModelSetupController {
  const controller: ActivationModelSetupController = {
    loadState(draftConfig) {
      const savedConfig = options.storage.load();
      const normalizedDraft = normalizeStoredActivationModelConfig(draftConfig ?? savedConfig);

      return {
        savedConfig,
        draftConfig: normalizedDraft,
        validation: validateCurrentConfig(normalizedDraft, options.preset),
        hasSavedConfig: Boolean(savedConfig?.filePath),
        hasUnsavedChanges: !areConfigsEquivalent(normalizedDraft, savedConfig),
      };
    },
    getSavedConfig() {
      return options.storage.load();
    },
    async pickModel() {
      const config = await pickActivationModelConfig(options.picker, options.preset);
      const verification = await verifyAndNormalizeConfig(config, options.verifier, options.preset);

      return {
        config: applyVerificationNormalization(config, verification),
        verification,
      };
    },
    async verifyConfig(config) {
      return verifyAndNormalizeConfig(config, options.verifier, options.preset);
    },
    saveConfig(config) {
      const normalized = normalizeStoredActivationModelConfig(config);
      if (!normalized) {
        options.storage.clear();
        return controller.loadState(null);
      }

      options.storage.save(normalized);
      return controller.loadState(normalized);
    },
    clearSavedConfig() {
      options.storage.clear();
      return controller.loadState(null);
    },
  };

  return controller;
}

function validateCurrentConfig(
  config: ActivationStoredModelConfig | null,
  preset: ActivationModelConfigPreset,
): ActivationConfigValidationResult {
  return validateStoredActivationModelConfig(config, preset);
}

async function verifyAndNormalizeConfig(
  config: ActivationStoredModelConfig,
  verifier: ActivationModelVerifier | undefined,
  preset: ActivationModelConfigPreset,
): Promise<ActivationModelVerificationResult | null> {
  if (!verifier) {
    return null;
  }

  const result = await verifier.verify({
    config,
    preset,
  });

  return {
    ...result,
    normalizedConfig: normalizeStoredActivationModelConfig({
      ...config,
      ...(result.normalizedConfig ?? {}),
    }) ?? undefined,
  };
}

function applyVerificationNormalization(
  config: ActivationStoredModelConfig,
  verification: ActivationModelVerificationResult | null,
): ActivationStoredModelConfig {
  return (
    normalizeStoredActivationModelConfig({
      ...config,
      ...(verification?.normalizedConfig ?? {}),
    }) ?? config
  );
}

function areConfigsEquivalent(
  left: ActivationStoredModelConfig | null,
  right: ActivationStoredModelConfig | null,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
