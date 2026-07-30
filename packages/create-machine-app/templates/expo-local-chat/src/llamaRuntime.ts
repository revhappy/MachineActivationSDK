// llamaRuntime — an ActivationRuntime backed by llama.rn (llama.cpp via JSI).
// Covers both iOS (Metal) and Android from one implementation.
//
// Three things here are easy to get wrong and matter a lot on-device:
//
//   1. GPU offload. Requesting zero GPU layers silently pins inference to the
//      CPU, which on a phone is the difference between usable and unusable. We
//      request a full offload; llama.cpp clamps it to the model's real layer
//      count and llama.rn reports back whether it actually happened
//      (`context.gpu`), so the activation contract states observed truth
//      instead of a guess.
//
//   2. Grammar pass-through. Grammar-constrained decoding is what makes
//      `generateObject` and the `generateText` tool loop reliable on 2-4B
//      models. Dropping `options.grammar` degrades both to prompt-and-hope.
//
//   3. `onChunk`. `streamText` consumes `onChunk` exclusively — an adapter that
//      only emits `onToken` appears to work but delivers all text at once.

import { initLlama, type LlamaContext } from 'llama.rn';
import {
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  resolveStructuredOutputGrammar,
  type ActivationAccelerationMode,
  type ActivationChatMessage,
  type ActivationCompletionOptions,
  type ActivationCompletionResult,
  type ActivationRuntime,
  type ActivationSession,
  type ActivationSessionCreateInput,
} from 'machineai-activation';

const BACKEND_ID = 'llama.rn';
const BACKEND_NAME = 'llama.rn (llama.cpp)';

// Request a full offload; llama.cpp clamps to the model's actual layer count.
const REQUESTED_GPU_LAYERS = 99;
const DEFAULT_CONTEXT_TOKENS = 4096;
const DEFAULT_MAX_TOKENS = 512;

interface LlamaMessage {
  role: string;
  content: string;
}

// Flatten SDK message parts to text and fold the `tool` role into a user turn.
// Most local chat templates (Gemma, Llama 3, ChatML) have no `tool` role, so
// passing one through makes the template mis-render the turn and quietly breaks
// the tool loop.
function toLlamaMessage(message: ActivationChatMessage): LlamaMessage {
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .map((part) => (part.type === 'text' ? part.text : ''))
          .filter(Boolean)
          .join('\n');

  if (message.role === 'tool') {
    return { role: 'user', content: `Tool result: ${text}` };
  }
  return { role: message.role, content: text };
}

async function createLlamaSession(
  input: ActivationSessionCreateInput,
): Promise<ActivationSession> {
  const context: LlamaContext = await initLlama({
    model: input.filePath,
    n_ctx: input.contextWindowTokens ?? DEFAULT_CONTEXT_TOKENS,
    n_gpu_layers: REQUESTED_GPU_LAYERS,
  });

  // Observed, not assumed: llama.rn tells us whether the offload landed.
  const gpuActive = context.gpu === true;
  const acceleration: ActivationAccelerationMode = gpuActive ? 'gpu' : 'cpu';
  const accelerationNotes = gpuActive
    ? [`GPU offload active${context.devices?.length ? ` (${context.devices.join(', ')})` : ''}`]
    : [`GPU offload unavailable: ${context.reasonNoGPU || 'unknown reason'}`];

  const resolvedCapabilities = {
    textCompletion: true,
    textChat: true,
    streaming: true,
    visionImageInput: false,
    // llama.cpp supports GBNF grammar sampling, and this adapter forwards it —
    // so structured output and the tool loop are genuinely available.
    structuredJsonOutput: true,
    toolCalling: true,
    projectorReady: false,
    accelerationMode: acceleration,
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
      structuredJsonOutput: true,
      toolCalling: true,
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
      supportsStructuredJsonOutput: true,
      supportsToolCalling: true,
      supportsCancellation: true,
      supportedAccelerationModes: gpuActive
        ? (['gpu', 'cpu'] as ActivationAccelerationMode[])
        : (['cpu'] as ActivationAccelerationMode[]),
      detectedDevices: context.devices ?? [],
      notes: accelerationNotes,
    },
    device: {
      platform: 'react-native',
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: gpuActive
        ? (['gpu', 'cpu'] as ActivationAccelerationMode[])
        : (['cpu'] as ActivationAccelerationMode[]),
      notes: accelerationNotes,
    },
    resolvedContract: {
      schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
      compatible: true,
      degraded: false,
      compatibility: 'compatible' as const,
      resolvedCapabilities,
      memoryAssessment: { status: 'unknown' as const, detail: 'on-device' },
      reasons: [],
      warnings: gpuActive ? [] : accelerationNotes,
    },
    diagnostics: {
      sourceAdapterId: BACKEND_ID,
      backendId: BACKEND_ID,
      accelerationMode: acceleration,
    },
  };

  const runCompletion = async (
    messages: LlamaMessage[],
    options: ActivationCompletionOptions | undefined,
  ): Promise<ActivationCompletionResult> => {
    const opts = options ?? {};

    // Only prepend systemPrompt when the caller didn't already supply a system
    // turn — generateText's tool loop bakes its system prompt into messages[0]
    // and ALSO passes `system` through, which would otherwise send it twice.
    const finalMessages: LlamaMessage[] =
      opts.systemPrompt && !messages.some((m) => m.role === 'system')
        ? [{ role: 'system', content: opts.systemPrompt }, ...messages]
        : messages;

    // Honors an explicit grammar, and turns responseFormat:'json' into the
    // SDK's standard JSON grammar for llama-family backends.
    const grammar = resolveStructuredOutputGrammar(BACKEND_ID, {
      grammar: opts.grammar,
      responseFormat: opts.responseFormat,
    });

    const started = Date.now();
    let accumulated = '';
    let reasoning = '';
    let tokensGenerated = 0;

    const result = await context.completion(
      {
        messages: finalMessages,
        n_predict: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: opts.temperature,
        top_p: opts.topP,
        top_k: opts.topK,
        stop: opts.stopSequences ?? [],
        ...(grammar ? { grammar } : {}),
      },
      (partial) => {
        const delta = partial.token ?? '';
        const reasoningDelta = partial.reasoning_content ?? '';
        if (!delta && !reasoningDelta) return;

        accumulated += delta;
        reasoning += reasoningDelta;
        tokensGenerated += 1;

        const seconds = (Date.now() - started) / 1000;
        opts.onToken?.(delta);
        opts.onChunk?.({
          rawToken: delta,
          text: accumulated,
          textDelta: delta,
          reasoningText: reasoning,
          reasoningDelta,
          tokensGenerated,
          tokensPerSecond: seconds > 0 ? tokensGenerated / seconds : 0,
        });
      },
    );

    const seconds = (Date.now() - started) / 1000;
    return {
      text: result.text ?? accumulated,
      reasoningText: result.reasoning_content ?? reasoning,
      tokensGenerated: result.tokens_predicted ?? tokensGenerated,
      tokensPerSecond:
        result.timings?.predicted_per_second ??
        (seconds > 0 ? tokensGenerated / seconds : 0),
    };
  };

  return {
    modelId: input.modelId,
    backendId: BACKEND_ID,
    resolvedContract: capabilitySnapshot.resolvedContract,
    capabilitySnapshot,

    complete: (prompt, options) =>
      runCompletion([{ role: 'user', content: prompt }], options),

    completeChat: (messages, options) =>
      runCompletion(messages.map(toLlamaMessage), options),

    contextState: async () => ({
      strategy: 'fresh',
      reuseStateAvailable: false,
      maxContextTokens: input.contextWindowTokens ?? DEFAULT_CONTEXT_TOKENS,
      overflowStrategy: 'reset',
      notes: [],
    }),
    resetContext: async () => undefined,
    probeVisionReadiness: async () => ({
      ready: false,
      detail: 'multimodal projector not wired in this template',
    }),
    diagnostics: async () => ({
      sourceAdapterId: BACKEND_ID,
      backendId: BACKEND_ID,
      accelerationMode: acceleration,
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
  supportedModelFormats: ['gguf'],
  createSession: (input) => createLlamaSession(input),
};
