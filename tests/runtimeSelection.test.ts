import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { test } from './_harness';
import {
  detectActivationModelFormat,
  selectActivationRuntime,
} from '../src/activation/runtimeSelection';
import type {
  ActivationRuntime,
  ActivationSession,
  ActivationSessionCreateInput,
} from '../src/activation/activationAdapter';
import {
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  type ActivationCapabilitySnapshot,
} from '../src/activation/activationContract';

function createStubSession(): ActivationSession {
  const capabilitySnapshot = {
    schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
    appRequirements: {},
    model: {
      modelPath: '/models/test.gguf',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTextCompletion: true,
      supportsTextChat: true,
      supportsStreaming: false,
      structuredJsonOutput: false,
      toolCalling: false,
      requiresProjector: false,
      projectorAttached: false,
      notes: [],
    },
    backend: {
      backendId: 'stub',
      backendName: 'stub',
      sessionCreationAvailable: true,
      supportsStreaming: false,
      supportsVision: false,
      supportsStructuredJsonOutput: false,
      supportsToolCalling: false,
      supportsCancellation: true,
      supportedAccelerationModes: ['cpu'],
      detectedDevices: [],
      notes: [],
    },
    device: {
      platform: 'test',
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: ['cpu'],
      notes: [],
    },
    resolvedContract: {
      schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
      compatible: true,
      degraded: false,
      compatibility: 'compatible' as const,
      resolvedCapabilities: {
        textCompletion: true,
        textChat: true,
        streaming: false,
        visionImageInput: false,
        structuredJsonOutput: false,
        toolCalling: false,
        projectorReady: false,
        accelerationMode: 'cpu' as const,
      },
      memoryAssessment: {
        status: 'unknown' as const,
        detail: 'test',
      },
      reasons: [],
      warnings: [],
    },
    diagnostics: {
      sourceAdapterId: 'stub',
      backendId: 'stub',
      accelerationMode: 'cpu' as const,
    },
  } satisfies ActivationCapabilitySnapshot;

  return {
    backendId: 'stub',
    resolvedContract: capabilitySnapshot.resolvedContract,
    capabilitySnapshot,
    complete: mock.fn(),
    completeChat: mock.fn(),
    contextState: mock.fn(),
    resetContext: mock.fn(),
    probeVisionReadiness: mock.fn(),
    diagnostics: mock.fn(),
    abort: mock.fn(),
    close: mock.fn(),
  };
}

function createRuntime(id: string, name: string): ActivationRuntime {
  return {
    id,
    name,
    createSession: async (_input: ActivationSessionCreateInput) => createStubSession(),
  };
}

test('runtimeSelection detects common model formats from file names', () => {
  assert.equal(detectActivationModelFormat('/models/model.gguf'), 'gguf');
  assert.equal(detectActivationModelFormat('/models/model.litertlm'), 'litert-lm');
  assert.equal(detectActivationModelFormat('/models/model.task'), 'litert-lm');
});

test('runtimeSelection respects runtime hints first', () => {
  const llama = createRuntime('llama.runtime', 'llama runtime');
  const litert = createRuntime('litert.runtime', 'LiteRT runtime');

  const selected = selectActivationRuntime([llama, litert], {
    filePath: '/models/test.gguf',
    runtimeHint: 'litert.runtime',
  });

  assert.equal(selected.id, 'litert.runtime');
});

test('runtimeSelection prefers llama-family runtimes for gguf cartridges', () => {
  const runtimes = [
    createRuntime('generic.runtime', 'Generic runtime'),
    createRuntime('llama.runtime', 'llama.cpp runtime'),
  ];

  const selected = selectActivationRuntime(runtimes, {
    filePath: '/models/test.gguf',
  });

  assert.equal(selected.id, 'llama.runtime');
});

test('runtimeSelection prefers litert-family runtimes for litert cartridges', () => {
  const runtimes = [
    createRuntime('llama.runtime', 'llama.cpp runtime'),
    createRuntime('litert.runtime', 'LiteRT runtime'),
  ];

  const selected = selectActivationRuntime(runtimes, {
    filePath: '/models/test.litertlm',
  });

  assert.equal(selected.id, 'litert.runtime');
});
