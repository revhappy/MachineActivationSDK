import { CreateMLCEngine, type MLCEngine, type ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import type {
  ActivationRuntime,
  ActivationSession,
  ActivationSessionCreateInput,
} from '@revhappy/activation-sdk';

const BACKEND_ID = 'web-llm';
const BACKEND_NAME = '@mlc-ai/web-llm';

const DEFAULT_WEB_LLM_MODEL = 'Llama-3.2-1B-Instruct-q4f32_1-MLC';

async function createWebLlmSession(
  input: ActivationSessionCreateInput,
): Promise<ActivationSession> {
  const webLlmModelId = input.filePath || DEFAULT_WEB_LLM_MODEL;
  const engine: MLCEngine = await CreateMLCEngine(webLlmModelId);

  const resolvedCapabilities = {
    textCompletion: true,
    textChat: true,
    streaming: true,
    visionImageInput: false,
    structuredJsonOutput: false,
    toolCalling: false,
    projectorReady: false,
    accelerationMode: 'gpu' as const,
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
      notes: [`WebLLM model id: ${webLlmModelId}`],
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
      supportedAccelerationModes: ['gpu' as const],
      detectedDevices: [],
      notes: ['Runs in-browser via WebGPU'],
    },
    device: {
      platform: 'web',
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: ['gpu' as const],
      notes: ['Browser with WebGPU support required'],
    },
    resolvedContract: {
      schemaVersion: 1,
      compatible: true,
      degraded: false,
      compatibility: 'compatible' as const,
      resolvedCapabilities,
      memoryAssessment: { status: 'unknown' as const, detail: 'on-device (browser)' },
      reasons: [],
      warnings: [],
    },
    diagnostics: {
      sourceAdapterId: BACKEND_ID,
      backendId: BACKEND_ID,
      accelerationMode: 'gpu' as const,
    },
  };

  const runChat = async (
    messages: ChatCompletionMessageParam[],
    maxTokens: number | undefined,
    stream: { onToken?: (e: { delta: string }) => void } | undefined,
    signal: AbortSignal | undefined,
  ) => {
    let text = '';
    let tokensGenerated = 0;
    const started = Date.now();

    const chunks = await engine.chat.completions.create({
      messages,
      max_tokens: maxTokens ?? 512,
      stream: true,
    });

    for await (const chunk of chunks) {
      if (signal?.aborted) break;
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        text += delta;
        tokensGenerated += 1;
        stream?.onToken?.({ delta });
      }
    }

    const seconds = (Date.now() - started) / 1000;
    return {
      text,
      reasoningText: '',
      tokensGenerated,
      tokensPerSecond: seconds > 0 ? tokensGenerated / seconds : 0,
    };
  };

  return {
    modelId: input.modelId,
    backendId: BACKEND_ID,
    resolvedContract: capabilitySnapshot.resolvedContract,
    capabilitySnapshot,

    complete: async ({ prompt, system, maxTokens, stream, signal }) => {
      const messages: ChatCompletionMessageParam[] = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });
      return runChat(messages, maxTokens, stream, signal);
    },

    completeChat: async ({ messages, maxTokens, stream, signal }) => {
      const mapped = messages.map((m) => ({
        role: m.role as ChatCompletionMessageParam['role'],
        content: m.content,
      })) as ChatCompletionMessageParam[];
      return runChat(mapped, maxTokens, stream, signal);
    },

    contextState: async () => ({
      strategy: 'fresh',
      reuseStateAvailable: false,
      overflowStrategy: 'reset',
      notes: [],
    }),
    resetContext: async () => {
      await engine.resetChat();
    },
    probeVisionReadiness: async () => ({ ready: false, detail: 'not supported' }),
    diagnostics: async () => ({
      sourceAdapterId: BACKEND_ID,
      backendId: BACKEND_ID,
      accelerationMode: 'gpu',
    }),
    abort: async () => {
      await engine.interruptGenerate();
    },
    close: async () => {
      await engine.unload();
    },
  };
}

export const webLlmRuntime: ActivationRuntime = {
  id: BACKEND_ID,
  name: BACKEND_NAME,
  createSession: (input) => createWebLlmSession(input),
};
