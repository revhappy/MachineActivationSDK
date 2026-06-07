import assert from 'node:assert/strict';
import { test } from './_harness';
import {
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  resolveCapabilityContract,
  type AppCapabilityRequirements,
  type BackendCapabilityDeclaration,
  type DeviceCapabilityDeclaration,
  type ModelCapabilityDeclaration,
} from '../src/activation/activationContract';

function createModel(
  overrides: Partial<ModelCapabilityDeclaration> = {},
): ModelCapabilityDeclaration {
  return {
    modelId: 'test-model',
    modelPath: '/models/test.gguf',
    modelFormat: 'gguf',
    fileSizeBytes: 1024 * 1024 * 1024,
    estimatedRuntimeMemoryMb: 1536,
    inputModalities: ['text'],
    outputModalities: ['text'],
    contextWindowTokens: 8192,
    supportsTextCompletion: true,
    supportsTextChat: true,
    supportsStreaming: true,
    structuredJsonOutput: true,
    toolCalling: false,
    requiresProjector: false,
    projectorAttached: false,
    notes: [],
    ...overrides,
  };
}

function createBackend(
  overrides: Partial<BackendCapabilityDeclaration> = {},
): BackendCapabilityDeclaration {
  return {
    backendId: 'llama',
    backendName: 'llama',
    sessionCreationAvailable: true,
    supportsStreaming: true,
    supportsVision: true,
    supportsStructuredJsonOutput: true,
    supportsToolCalling: false,
    supportsCancellation: true,
    supportedAccelerationModes: ['cpu', 'gpu'],
    detectedDevices: ['gpu0'],
    notes: [],
    ...overrides,
  };
}

function createDevice(
  overrides: Partial<DeviceCapabilityDeclaration> = {},
): DeviceCapabilityDeclaration {
  return {
    platform: 'android',
    cameraAvailable: true,
    photoLibraryAvailable: true,
    availableAccelerationModes: ['cpu', 'gpu'],
    availableMemoryMb: 8192,
    notes: [],
    ...overrides,
  };
}

test('resolveCapabilityContract returns a schema-versioned compatible contract for a healthy stack', () => {
    const result = resolveCapabilityContract({
      appRequirements: {
        textCompletion: true,
        textChat: true,
        streaming: true,
      },
      model: createModel(),
      backend: createBackend(),
      device: createDevice(),
    });

    assert.equal(result.schemaVersion, ACTIVATION_CONTRACT_SCHEMA_VERSION);
    assert.equal(result.compatible, true);
    assert.equal(result.degraded, false);
    assert.equal(result.compatibility, 'compatible');
    assert.equal(result.resolvedCapabilities.accelerationMode, 'gpu');
});

test('resolveCapabilityContract treats structured output as advisory instead of incompatible by default', () => {
    const requirements: AppCapabilityRequirements = {
      textChat: true,
      structuredJsonOutput: true,
    };

    const result = resolveCapabilityContract({
      appRequirements: requirements,
      model: createModel({ structuredJsonOutput: false }),
      backend: createBackend({ supportsStructuredJsonOutput: false }),
      device: createDevice(),
    });

    assert.equal(result.compatible, true);
    assert.equal(result.degraded, true);
    assert.match(result.warnings.join(' '), /Structured JSON output/i);
});

test('resolveCapabilityContract fails when vision is explicitly required but the stack cannot support it', () => {
    const result = resolveCapabilityContract({
      appRequirements: {
        visionImageInput: true,
      },
      model: createModel({ inputModalities: ['text'] }),
      backend: createBackend({ supportsVision: false }),
      device: createDevice({
        cameraAvailable: false,
        photoLibraryAvailable: false,
      }),
    });

    assert.equal(result.compatible, false);
    assert.match(result.reasons.join(' '), /Image input is required/i);
});

test('resolveCapabilityContract keeps memory pressure advisory when the stack is otherwise usable', () => {
    const result = resolveCapabilityContract({
      appRequirements: {
        textChat: true,
      },
      model: createModel({
        fileSizeBytes: 5 * 1024 * 1024 * 1024,
        estimatedRuntimeMemoryMb: 7000,
      }),
      backend: createBackend(),
      device: createDevice({
        availableMemoryMb: 4096,
      }),
    });

    assert.equal(result.compatible, true);
    assert.equal(result.degraded, true);
    assert.equal(result.memoryAssessment.status, 'insufficient');
});
