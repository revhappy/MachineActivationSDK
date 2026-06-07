import assert from 'node:assert/strict';
import { test } from './_harness';
import {
  createInMemoryObservedCapabilityStore,
  createMachineActivationSdk,
  createActivationCapabilityRegistry,
  type ActivationCapabilitySnapshot,
  type ActivationCompletionOptions,
  type ActivationRuntime,
  type ActivationSession,
  type ActivationSessionCreateInput,
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
} from '../src/index';

function createProbeFriendlySession(
  input: ActivationSessionCreateInput,
): ActivationSession {
  const capabilitySnapshot = {
    schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
    appRequirements: input.appRequirements ?? {},
    model: {
      modelId: input.modelId,
      modelPath: input.filePath,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTextCompletion: true,
      supportsTextChat: true,
      supportsStreaming: true,
      structuredJsonOutput: false,
      toolCalling: false,
      requiresProjector: false,
      projectorAttached: false,
      notes: [],
    },
    backend: {
      backendId: 'probe-runtime',
      backendName: 'Probe Runtime',
      sessionCreationAvailable: true,
      supportsStreaming: true,
      supportsVision: false,
      supportsStructuredJsonOutput: true,
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
        streaming: true,
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
      sourceAdapterId: 'probe-runtime',
      backendId: 'probe-runtime',
      accelerationMode: 'cpu' as const,
    },
  } satisfies ActivationCapabilitySnapshot;

  return {
    modelId: input.modelId,
    backendId: 'probe-runtime',
    resolvedContract: capabilitySnapshot.resolvedContract,
    capabilitySnapshot,
    complete: async (prompt: string, options?: ActivationCompletionOptions) => {
      if (options?.onToken) {
        options.onToken('token');
      }

      if (/exactly ok/i.test(prompt)) {
        return {
          text: 'OK',
          reasoningText: '',
          tokensGenerated: 1,
          tokensPerSecond: 1,
        };
      }

      if (options?.responseFormat === 'json') {
        return {
          text: '{"ok":true}',
          reasoningText: '',
          tokensGenerated: 4,
          tokensPerSecond: 1,
        };
      }

      return {
        text: 'STREAM',
        reasoningText: '',
        tokensGenerated: 1,
        tokensPerSecond: 1,
      };
    },
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
      sourceAdapterId: 'probe-runtime',
      backendId: 'probe-runtime',
      accelerationMode: 'cpu',
    }),
    abort: async () => undefined,
    close: async () => undefined,
  };
}

test('custom capability registry can teach the SDK about a new model family without editing core source rules', async () => {
  const runtime: ActivationRuntime = {
    id: 'minimal-runtime',
    name: 'Minimal Runtime',
    createSession: async (input) => createProbeFriendlySession(input),
  };

  const registry = createActivationCapabilityRegistry([
    {
      id: 'acme-vision',
      match: /acme-special/i,
      infer: () => ({
        inferredFields: {
          inputModalities: ['text', 'image'],
          structuredJsonOutput: true,
          toolCalling: true,
          requiresProjector: false,
        },
        notes: ['Custom registry matched the Acme Special model family.'],
      }),
    },
  ]);

  const client = createMachineActivationSdk(runtime, {
    capabilityRegistry: registry,
  }).createActivationClient();

  const probed = await client.probeModel({
    filePath: '/models/acme-special.gguf',
  });

  assert.deepEqual(probed.inputModalities, ['text', 'image']);
  assert.equal(probed.structuredJsonOutput, true);
  assert.equal(probed.toolCalling, true);
  assert.match(probed.notes.join(' '), /Acme Special/i);
});

test('observed capability probes run through the SDK, persist locally, and influence later diagnostics', async () => {
  const runtime: ActivationRuntime = {
    id: 'probe-runtime',
    name: 'Probe Runtime',
    listBackendCapabilities: async () => ({
      backendId: 'probe-runtime',
      backendName: 'Probe Runtime',
      sessionCreationAvailable: true,
      supportsStreaming: true,
      supportsVision: false,
      supportsStructuredJsonOutput: true,
      supportsToolCalling: false,
      supportsCancellation: true,
      supportedAccelerationModes: ['cpu'],
      detectedDevices: [],
      notes: [],
    }),
    probeDeviceCapabilities: async () => ({
      platform: 'test',
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: ['cpu'],
      notes: [],
    }),
    createSession: async (input) => createProbeFriendlySession(input),
  };

  const store = createInMemoryObservedCapabilityStore();
  const client = createMachineActivationSdk(runtime, {
    observedCapabilityStore: store,
  }).createActivationClient();

  const before = await client.diagnoseModel({
    model: {
      filePath: '/models/demo.gguf',
    },
    appRequirements: {
      structuredJsonOutput: true,
      streaming: true,
    },
  });

  assert.equal(
    before.resolvedContract.resolvedCapabilities.structuredJsonOutput,
    false,
  );

  const observed = await client.runObservedCapabilityProbes({
    filePath: '/models/demo.gguf',
  });
  const persisted = client.getObservedCapabilities({
    filePath: '/models/demo.gguf',
  });
  const after = await client.diagnoseModel({
    model: {
      filePath: '/models/demo.gguf',
    },
    appRequirements: {
      structuredJsonOutput: true,
      streaming: true,
    },
  });

  assert.equal(observed.structuredJsonOutput, true);
  assert.equal(observed.streaming, true);
  assert.ok(persisted);
  assert.equal(persisted?.structuredJsonOutput, true);
  assert.equal(
    after.resolvedContract.resolvedCapabilities.structuredJsonOutput,
    true,
  );
  assert.equal(after.resolvedContract.resolvedCapabilities.streaming, true);
});
