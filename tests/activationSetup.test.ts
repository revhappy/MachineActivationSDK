import assert from 'node:assert/strict';
import { test } from './_harness';
import {
  createActivationModelSetupController,
  type ActivationModelVerificationResult,
} from '../src/activation/activationSetup';
import type {
  ActivationModelConfigPreset,
  ActivationModelConfigStorage,
  ActivationStoredModelConfig,
} from '../src/activation/activationConfig';

function createMemoryStorage(): ActivationModelConfigStorage {
  let value: ActivationStoredModelConfig | null = null;

  return {
    load: () => value,
    save: (config) => {
      value = config;
    },
    clear: () => {
      value = null;
    },
  };
}

test('activationSetup picks, verifies, normalizes, and saves through the reusable controller', async () => {
  const storage = createMemoryStorage();
  const preset: ActivationModelConfigPreset = {
    acceptedExtensions: ['.litertlm'],
    defaultRuntimeHint: 'litert.capacitor.android',
    clearProjectorByDefault: true,
  };

  const controller = createActivationModelSetupController({
    storage,
    preset,
    picker: {
      async pickModelFile() {
        return {
          name: 'Demo Model.litertlm',
          path: '/models/demo-model.litertlm',
        };
      },
    },
    verifier: {
      async verify(): Promise<ActivationModelVerificationResult> {
        return {
          status: 'verified',
          message: 'verified',
          normalizedConfig: {
            modelId: 'demo-model-verified',
          },
        };
      },
    },
  });

  const picked = await controller.pickModel();

  assert.equal(picked?.config.modelId, 'demo-model-verified');

  const savedState = controller.saveConfig(picked?.config ?? null);
  assert.equal(savedState.hasSavedConfig, true);
  assert.equal(savedState.hasUnsavedChanges, false);
  assert.equal(savedState.savedConfig?.modelId, 'demo-model-verified');

  const clearedState = controller.clearSavedConfig();
  assert.equal(clearedState.hasSavedConfig, false);
  assert.equal(clearedState.savedConfig, null);
});
