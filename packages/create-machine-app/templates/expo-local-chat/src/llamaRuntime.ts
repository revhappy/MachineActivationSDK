import { initLlama, type LlamaContext } from 'llama.rn';
import type {
  ActivationRuntime,
  ActivationSession,
  ActivationSessionCreateInput,
} from '@revhappy/activation-sdk';

const BACKEND_ID = 'llama.rn';
const BACKEND_NAME = 'llama.rn';

async function createLlamaSession(
  input: ActivationSessionCreateInput,
): Promise<ActivationSession> {
  const context: LlamaContext = await initLlama({
    model: input.filePath,
    n_ctx: 4096,
    n_gpu_layers: 0,
  });

  const resolvedCapabilities = {
    textCompletion: true,
    textChat: true,
    streaming: true,
    visionImageInput: false,
    structuredJsonOutput: false,
    toolCalling: false,
    projectorReady: false,
    accelerationMode: 'cpu' as const,
  };

  const capabilitySnapshot = {
    schemaVersion: 1,
    appRequirements: input.appRequirements ?? {},
    model: {
      modelId: input.modelId,
      modelPath: input.filePath,
      inputModalities: ['text' as const],
      outputModalities: ['text' as const],
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
      backendId: BACKEND_ID,
      backendName: BACKEND_NAME,
      sessionCreationAvailable: true,
      supportsStreaming: true,
      supportsVision: false,
      supportsStructuredJsonOutput: false,
      supportsToolCalling: false,
      supportsCancellation: true,
      supportedAccelerationModes: ['cpu' as const],
      detectedDevices: [],
      notes: [],
    },
    device: {
      platform: 'react-native',
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: ['cpu' as const],
      notes: [],
    },
    resolvedContract: {
      schemaVersion: 1,
      compatible: true,
      degraded: false,
      compatibility: 'compatible' as const,
      resolvedCapabilities,
      memoryAssessment: { status: 'unknown' as const, detail: 'on-device' },
      reasons: [],
      warnings: [],
    },
    diagnostics: {
      sourceAdapterId: BACKEND_ID,
      backendId: BACKEND_ID,
      accelerationMode: 'cpu' as const,
    },
  };

  function toMessages(prompt: string, system?: string): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    return messages;
  }

  return {
    modelId: input.modelId,
    backendId: BACKEND_ID,
    resolvedContract: capabilitySnapshot.resolvedContract,
    capabilitySnapshot,

    complete: async ({ prompt, system, maxTokens, stream, signal }) => {
      const messages = toMessages(prompt, system);
      let text = '';
      let tokensGenerated = 0;

      const result = await context.completion(
        {
          messages,
          n_predict: maxTokens ?? 512,
          stop: [],
        },
        (partial) => {
          if (signal?.aborted) return;
          const delta = partial.token ?? '';
          text += delta;
          tokensGenerated += 1;
          stream?.onToken?.({ delta });
        },
      );

      const totalText = result.text ?? text;
      return {
        text: totalText,
        reasoningText: '',
        tokensGenerated,
        tokensPerSecond: result.timings?.predicted_per_second ?? 0,
      };
    },

    completeChat: async ({ messages, maxTokens, stream, signal }) => {
      let text = '';
      let tokensGenerated = 0;

      const result = await context.completion(
        {
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          n_predict: maxTokens ?? 512,
          stop: [],
        },
        (partial) => {
          if (signal?.aborted) return;
          const delta = partial.token ?? '';
          text += delta;
          tokensGenerated += 1;
          stream?.onToken?.({ delta });
        },
      );

      const totalText = result.text ?? text;
      return {
        text: totalText,
        reasoningText: '',
        tokensGenerated,
        tokensPerSecond: result.timings?.predicted_per_second ?? 0,
      };
    },

    contextState: async () => ({
      strategy: 'fresh',
      reuseStateAvailable: false,
      overflowStrategy: 'reset',
      notes: [],
    }),
    resetContext: async () => undefined,
    probeVisionReadiness: async () => ({ ready: false, detail: 'not supported' }),
    diagnostics: async () => ({
      sourceAdapterId: BACKEND_ID,
      backendId: BACKEND_ID,
      accelerationMode: 'cpu',
    }),
    abort: async () => {
      await context.stopCompletion();
    },
    close: async () => {
      await context.release();
    },
  };
}

export const llamaRuntime: ActivationRuntime = {
  id: BACKEND_ID,
  name: BACKEND_NAME,
  createSession: (input) => createLlamaSession(input),
};
