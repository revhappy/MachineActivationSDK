import { CreateMLCEngine, type MLCEngine, type ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import {
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  type ActivationChatMessage,
  type ActivationCompletionOptions,
  type ActivationCompletionResult,
  type ActivationRuntime,
  type ActivationSession,
  type ActivationSessionCreateInput,
} from 'machineai-activation';

const BACKEND_ID = 'web-llm';
const BACKEND_NAME = '@mlc-ai/web-llm';

const DEFAULT_WEB_LLM_MODEL = 'Llama-3.2-1B-Instruct-q4f32_1-MLC';

// Flatten SDK message parts to text and fold the `tool` role into a user turn —
// WebLLM's OpenAI-shaped API accepts a `tool` role only alongside tool_call ids,
// which this adapter does not produce.
function toWebLlmMessage(message: ActivationChatMessage): ChatCompletionMessageParam {
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .map((part) => (part.type === 'text' ? part.text : ''))
          .filter(Boolean)
          .join('\n');

  if (message.role === 'tool') {
    return { role: 'user', content: `Tool result: ${text}` } as ChatCompletionMessageParam;
  }
  return { role: message.role, content: text } as ChatCompletionMessageParam;
}

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
    schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
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
      schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
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
    history: ChatCompletionMessageParam[],
    options: ActivationCompletionOptions | undefined,
  ): Promise<ActivationCompletionResult> => {
    const opts = options ?? {};

    // Only prepend systemPrompt when the caller didn't already supply a system
    // turn — generateText's tool loop bakes its system prompt into messages[0]
    // and ALSO passes `system` through, which would otherwise send it twice.
    const messages: ChatCompletionMessageParam[] =
      opts.systemPrompt && !history.some((m) => m.role === 'system')
        ? [
            { role: 'system', content: opts.systemPrompt } as ChatCompletionMessageParam,
            ...history,
          ]
        : history;

    let text = '';
    let tokensGenerated = 0;
    const started = Date.now();

    const chunks = await engine.chat.completions.create({
      messages,
      max_tokens: opts.maxTokens ?? 512,
      temperature: opts.temperature,
      top_p: opts.topP,
      stop: opts.stopSequences,
      stream: true,
    });

    for await (const chunk of chunks) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (!delta) continue;
      text += delta;
      tokensGenerated += 1;
      const seconds = (Date.now() - started) / 1000;
      const tokensPerSecond = seconds > 0 ? tokensGenerated / seconds : 0;
      opts.onToken?.(delta);
      // streamText consumes onChunk exclusively — emitting only onToken makes
      // streaming silently collapse into a single end-of-generation delivery.
      opts.onChunk?.({
        rawToken: delta,
        text,
        textDelta: delta,
        reasoningText: '',
        reasoningDelta: '',
        tokensGenerated,
        tokensPerSecond,
      });
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

    complete: (prompt, options) =>
      runChat([{ role: 'user', content: prompt }], options),

    completeChat: (messages, options) =>
      runChat(messages.map(toWebLlmMessage), options),

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
