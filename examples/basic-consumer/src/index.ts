import {
  createActivationModelSetupController,
  createJsonActivationModelConfigStorage,
  createMachine,
  createMachineActivationSdk,
  generateObject,
  generateText,
  streamText,
  tool,
  type ActivationRuntime,
  type ActivationSession,
  type ActivationSessionCreateInput,
  type ActivationStoredModelConfig,
  type SchemaLike,
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  type ActivationAccelerationMode,
  type ActivationInputModality,
  type ActivationOutputModality,
} from '@revhappy/activation-sdk';

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
      backendId: 'consumer.runtime',
      backendName: 'Consumer Runtime',
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
      platform: 'consumer',
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
        detail: 'No device memory data available.',
      },
      reasons: [],
      warnings: [],
    },
    diagnostics: {
      sourceAdapterId: 'consumer.runtime',
      backendId: 'consumer.runtime',
      accelerationMode: 'cpu' as const,
    },
  };

  return {
    modelId: input.modelId,
    backendId: 'consumer.runtime',
    resolvedContract: capabilitySnapshot.resolvedContract,
    capabilitySnapshot,
    complete: async () => ({
      text: 'hello from local runtime',
      reasoningText: '',
      tokensGenerated: 4,
      tokensPerSecond: 4,
    }),
    completeChat: async () => ({
      text: 'hello from local runtime',
      reasoningText: '',
      tokensGenerated: 4,
      tokensPerSecond: 4,
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
      sourceAdapterId: 'consumer.runtime',
      backendId: 'consumer.runtime',
      accelerationMode: 'cpu',
    }),
    abort: async () => undefined,
    close: async () => undefined,
  };
}

const runtime: ActivationRuntime = {
  id: 'consumer.runtime',
  name: 'Consumer Runtime',
  createSession: async (input) => createMinimalSession(input),
};

const storage = createJsonActivationModelConfigStorage({
  storageKey: 'consumer.machineActivation.model',
  storage: createMemoryStore(),
});

const setup = createActivationModelSetupController({
  storage,
  preset: {
    acceptedExtensions: ['.gguf'],
  },
  picker: {
    async pickModelFile() {
      return {
        name: 'demo.gguf',
        path: '/models/demo.gguf',
      };
    },
  },
});

async function demo(): Promise<ActivationStoredModelConfig | null> {
  const picked = await setup.pickModel();
  const state = setup.saveConfig(picked?.config ?? null);
  const client = createMachineActivationSdk(runtime).createActivationClient();

  await client.activateModel({
    modelId: state.savedConfig?.modelId,
    filePath: state.savedConfig?.filePath ?? '/models/demo.gguf',
    appRequirements: {
      textChat: true,
    },
  });

  return state.savedConfig;
}

void demo();
void cartridgeReadyDemo();

/**
 * Drop-in API demo — matches the shape of Vercel AI SDK / OpenAI SDK.
 * A dev with an existing AI-native app can swap one import and start running locally.
 */
async function cartridgeReadyDemo(): Promise<void> {
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/demo.gguf' });

  // generateText — one-shot completion.
  const { text } = await generateText({
    model,
    prompt: 'What is 2+2?',
    system: 'Answer briefly.',
    maxTokens: 64,
  });
  console.log('[generateText]', text);

  // streamText — async iterable of text deltas.
  const stream = streamText({ model, prompt: 'Stream hello.' });
  for await (const delta of stream.textStream) {
    process.stdout.write(delta);
  }
  console.log();

  // generateObject — typed structured output via any Zod-shaped schema.
  const schema: SchemaLike<{ ok: boolean }> = {
    parse(value: unknown) {
      if (value && typeof value === 'object' && 'ok' in (value as object)) {
        return value as { ok: boolean };
      }
      throw new Error('invalid shape');
    },
  };
  const { object } = await generateObject({
    model,
    schema,
    prompt: 'Respond with {"ok":true}.',
  });
  console.log('[generateObject]', object);

  // tool — ReAct-style tool loop when you pass tools to generateText.
  const clockTool = tool({
    description: 'Return the current UTC time',
    parameters: {
      parse: (v: unknown) => v as Record<string, never>,
    },
    execute: async () => ({ now: new Date().toISOString() }),
  });
  const agentResult = await generateText({
    model,
    prompt: 'What time is it?',
    tools: { clock: clockTool },
    maxSteps: 3,
  });
  console.log('[agent]', agentResult.text);

  await machine.close();
}

function createMemoryStore() {
  const data = new Map<string, string>();
  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}
