import type {
  ActivationChatMessage,
  ActivationCompletionChunk,
  ActivationCompletionOptions,
  ActivationCompletionResult,
  ActivationRuntime,
  ActivationSession,
  ActivationSessionCreateInput,
} from '../../src/activation/activationAdapter';
import {
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  type ActivationAccelerationMode,
  type ActivationInputModality,
  type ActivationOutputModality,
} from '../../src/activation/activationContract';

export type CompleteHandler = (
  prompt: string,
  options: ActivationCompletionOptions,
) => Promise<string> | string;

export type CompleteChatHandler = (
  messages: ActivationChatMessage[],
  options: ActivationCompletionOptions,
) => Promise<string> | string;

export interface MockRuntimeOptions {
  completeText?: CompleteHandler;
  completeChatText?: CompleteChatHandler;
  streamChunks?: string[];
  id?: string;
  backendName?: string;
  /**
   * Optional observer invoked with the `ActivationCompletionOptions` each
   * time the mock session runs a completion. Tests use this to assert on
   * e.g. the `grammar` field.
   */
  onCompletionOptions?: (options: ActivationCompletionOptions) => void;
}

/**
 * Minimal in-process runtime used by sdk/* tests. Does not spin up any real
 * inference backend — the handlers decide what the "model" says.
 */
export function createMockRuntime(options: MockRuntimeOptions = {}): ActivationRuntime {
  const id = options.id ?? 'mock-runtime';
  const backendName = options.backendName ?? 'Mock Runtime';

  return {
    id,
    name: backendName,
    async createSession(input: ActivationSessionCreateInput): Promise<ActivationSession> {
      const snapshot = buildSnapshot(input, id, backendName);
      return {
        modelId: input.modelId,
        backendId: id,
        resolvedContract: snapshot.resolvedContract,
        capabilitySnapshot: snapshot,
        async complete(
          prompt: string,
          completion: ActivationCompletionOptions = {},
        ): Promise<ActivationCompletionResult> {
          options.onCompletionOptions?.(completion);
          const text = options.completeText
            ? await options.completeText(prompt, completion)
            : 'mock response';
          emitStream(completion, text, options.streamChunks);
          return buildResult(text);
        },
        async completeChat(
          messages: ActivationChatMessage[],
          completion: ActivationCompletionOptions = {},
        ): Promise<ActivationCompletionResult> {
          options.onCompletionOptions?.(completion);
          const text = options.completeChatText
            ? await options.completeChatText(messages, completion)
            : options.completeText
              ? await options.completeText(
                  messages[messages.length - 1]?.content as string,
                  completion,
                )
              : 'mock chat response';
          emitStream(completion, text, options.streamChunks);
          return buildResult(text);
        },
        async contextState() {
          return {
            strategy: 'fresh' as const,
            reuseStateAvailable: false,
            overflowStrategy: 'reset' as const,
            notes: [],
          };
        },
        async resetContext() {
          /* no-op */
        },
        async probeVisionReadiness() {
          return { ready: false, detail: 'not supported by mock runtime' };
        },
        async diagnostics() {
          return {
            sourceAdapterId: id,
            backendId: id,
            accelerationMode: 'cpu' as const,
          };
        },
        async abort() {
          /* no-op */
        },
        async close() {
          /* no-op */
        },
      };
    },
  };
}

function emitStream(
  completion: ActivationCompletionOptions,
  fullText: string,
  overrideChunks?: string[],
): void {
  if (!completion.onChunk && !completion.onToken) return;

  const chunks = overrideChunks ?? splitForStreaming(fullText);
  let emitted = '';
  chunks.forEach((delta, index) => {
    emitted += delta;
    const chunk: ActivationCompletionChunk = {
      rawToken: delta,
      text: emitted,
      textDelta: delta,
      reasoningText: '',
      reasoningDelta: '',
      tokensGenerated: index + 1,
      tokensPerSecond: 42,
    };
    completion.onChunk?.(chunk);
    completion.onToken?.(delta);
  });
}

function splitForStreaming(text: string): string[] {
  if (!text) return [];
  return text.match(/.{1,4}/g) ?? [text];
}

function buildResult(text: string): ActivationCompletionResult {
  return {
    text,
    reasoningText: '',
    tokensGenerated: Math.max(1, Math.ceil(text.length / 4)),
    tokensPerSecond: 42,
  };
}

function buildSnapshot(
  input: ActivationSessionCreateInput,
  backendId: string,
  backendName: string,
) {
  return {
    schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
    appRequirements: input.appRequirements ?? {},
    model: {
      modelId: input.modelId,
      modelPath: input.filePath,
      inputModalities: ['text'] as ActivationInputModality[],
      outputModalities: ['text'] as ActivationOutputModality[],
      supportsTextCompletion: true,
      supportsTextChat: true,
      supportsStreaming: true,
      structuredJsonOutput: true,
      toolCalling: false,
      requiresProjector: false,
      projectorAttached: false,
      notes: [],
    },
    backend: {
      backendId,
      backendName,
      sessionCreationAvailable: true,
      supportsStreaming: true,
      supportsVision: false,
      supportsStructuredJsonOutput: true,
      supportsToolCalling: false,
      supportsCancellation: true,
      supportedAccelerationModes: ['cpu'] as ActivationAccelerationMode[],
      detectedDevices: [],
      notes: [],
    },
    device: {
      platform: 'mock',
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
        streaming: true,
        visionImageInput: false,
        structuredJsonOutput: true,
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
      sourceAdapterId: backendId,
      backendId,
      accelerationMode: 'cpu' as const,
    },
  };
}
