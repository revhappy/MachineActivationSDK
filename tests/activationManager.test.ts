import assert from 'node:assert/strict';
import { test } from './_harness';
import {
  createMachineActivationSdk,
  type ActivationRuntime,
  type ActivationSession,
  type ActivationSessionCreateInput,
} from '../src/index';
import {
  type ActivationAccelerationMode,
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  type ActivationInputModality,
  type ActivationOutputModality,
} from '../src/activation/activationContract';

function createMinimalSession(input: ActivationSessionCreateInput): ActivationSession {
  const capabilitySnapshot = {
    schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
    appRequirements: input.appRequirements ?? {},
    model: {
      modelId: input.modelId,
      modelPath: input.filePath,
      inputModalities: ['text'] as ActivationInputModality[],
      outputModalities: ['text'] as ActivationOutputModality[],
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
      backendId: 'minimal-runtime',
      backendName: 'Minimal Runtime',
      sessionCreationAvailable: true,
      supportsStreaming: false,
      supportsVision: false,
      supportsStructuredJsonOutput: false,
      supportsToolCalling: false,
      supportsCancellation: true,
      supportedAccelerationModes: ['cpu'] as ActivationAccelerationMode[],
      detectedDevices: [],
      notes: [],
    },
    device: {
      platform: 'unknown',
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: ['cpu'] as ActivationAccelerationMode[],
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
        detail: 'No memory estimate available.',
      },
      reasons: [],
      warnings: [],
    },
    diagnostics: {
      sourceAdapterId: 'minimal-runtime',
      backendId: 'minimal-runtime',
      accelerationMode: 'cpu' as const,
    },
  };

  return {
    modelId: input.modelId,
    backendId: 'minimal-runtime',
    resolvedContract: capabilitySnapshot.resolvedContract,
    capabilitySnapshot,
    complete: async () => ({
      text: 'ok',
      reasoningText: '',
      tokensGenerated: 1,
      tokensPerSecond: 1,
    }),
    completeChat: async () => ({
      text: 'ok',
      reasoningText: '',
      tokensGenerated: 1,
      tokensPerSecond: 1,
    }),
    contextState: async () => ({
      strategy: 'fresh',
      reuseStateAvailable: false,
      overflowStrategy: 'reset',
      notes: [],
    }),
    resetContext: async () => undefined,
    probeVisionReadiness: async () => ({ ready: false, detail: 'not supported' }),
    diagnostics: async () => ({
      sourceAdapterId: 'minimal-runtime',
      backendId: 'minimal-runtime',
      accelerationMode: 'cpu',
    }),
    abort: async () => undefined,
    close: async () => undefined,
  };
}

test('minimal runtime surface allows an external consumer to implement only the session runtime core', async () => {
  const runtime: ActivationRuntime = {
    id: 'minimal-runtime',
    name: 'Minimal Runtime',
    createSession: async (input) => createMinimalSession(input),
  };

  const sdk = createMachineActivationSdk(runtime);
  const client = sdk.createActivationClient();

  const advice = await client.diagnoseModel({
    model: {
      filePath: '/models/demo.gguf',
    },
    appRequirements: {
      textChat: true,
    },
  });

  const session = await client.activateModel({
    filePath: '/models/demo.gguf',
    appRequirements: {
      textChat: true,
    },
  });

  assert.equal(advice.schemaVersion, ACTIVATION_CONTRACT_SCHEMA_VERSION);
  assert.equal(advice.backend.backendId, 'minimal-runtime');
  assert.equal(
    session.capabilitySnapshot.schemaVersion,
    ACTIVATION_CONTRACT_SCHEMA_VERSION,
  );
  assert.equal(session.capabilitySnapshot.backend.backendName, 'Minimal Runtime');
});
