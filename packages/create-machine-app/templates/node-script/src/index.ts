import {
  createMachine,
  generateText,
  type ActivationRuntime,
  type ActivationSession,
  type ActivationSessionCreateInput,
} from '@revhappy/activation-sdk';
import { createNodeCartridgeResolver } from '@revhappy/activation-sdk/node';

const CATALOG_URL = 'https://catalog.machine.ai/catalog.json';
const CARTRIDGE_ID = 'dev.machine.gemma-3n-e4b-it';

function createEchoSession(input: ActivationSessionCreateInput): ActivationSession {
  const resolvedCapabilities = {
    textCompletion: true,
    textChat: true,
    streaming: false,
    visionImageInput: false,
    structuredJsonOutput: false,
    toolCalling: false,
    projectorReady: false,
    accelerationMode: 'cpu' as const,
  };

  return {
    modelId: input.modelId,
    backendId: 'placeholder.runtime',
    resolvedContract: {
      schemaVersion: 1,
      compatible: true,
      degraded: false,
      compatibility: 'compatible',
      resolvedCapabilities,
      memoryAssessment: { status: 'unknown', detail: 'placeholder runtime' },
      reasons: [],
      warnings: [],
    },
    capabilitySnapshot: {
      schemaVersion: 1,
      appRequirements: input.appRequirements ?? {},
      model: {
        modelId: input.modelId,
        modelPath: input.filePath,
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
        backendId: 'placeholder.runtime',
        backendName: 'Placeholder Runtime',
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
        platform: 'node',
        cameraAvailable: false,
        photoLibraryAvailable: false,
        availableAccelerationModes: ['cpu'],
        notes: [],
      },
      resolvedContract: {
        schemaVersion: 1,
        compatible: true,
        degraded: false,
        compatibility: 'compatible',
        resolvedCapabilities,
        memoryAssessment: { status: 'unknown', detail: 'placeholder runtime' },
        reasons: [],
        warnings: [],
      },
      diagnostics: {
        sourceAdapterId: 'placeholder.runtime',
        backendId: 'placeholder.runtime',
        accelerationMode: 'cpu',
      },
    },
    complete: async () => ({
      text: '[placeholder runtime] swap me for a real ActivationRuntime.',
      reasoningText: '',
      tokensGenerated: 10,
      tokensPerSecond: 10,
    }),
    completeChat: async () => ({
      text: '[placeholder runtime] swap me for a real ActivationRuntime.',
      reasoningText: '',
      tokensGenerated: 10,
      tokensPerSecond: 10,
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
      sourceAdapterId: 'placeholder.runtime',
      backendId: 'placeholder.runtime',
      accelerationMode: 'cpu',
    }),
    abort: async () => undefined,
    close: async () => undefined,
  };
}

const runtime: ActivationRuntime = {
  id: 'placeholder.runtime',
  name: 'Placeholder Runtime',
  createSession: async (input) => createEchoSession(input),
};

async function main(): Promise<void> {
  const machine = createMachine({
    runtimes: runtime,
    cartridgeResolver: createNodeCartridgeResolver({
      catalogUrl: CATALOG_URL,
      autoPull: true,
      onProgress: (p) => {
        if (p.phase === 'download') {
          const pct = p.totalBytes ? Math.round((p.bytesDownloaded / p.totalBytes) * 100) : 0;
          process.stdout.write(`  downloading ${CARTRIDGE_ID}: ${pct}%\r`);
        }
      },
    }),
  });

  const model = machine.model({ cartridge: CARTRIDGE_ID });

  const { text } = await generateText({
    model,
    prompt: 'Say hi in one short sentence.',
    maxTokens: 64,
  });

  console.log('\n' + text);

  await machine.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
