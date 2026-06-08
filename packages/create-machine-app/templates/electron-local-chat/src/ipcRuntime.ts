import type {
  ActivationCompletionOptions,
  ActivationCompletionResult,
  ActivationRuntime,
  ActivationSession,
  ActivationSessionCreateInput,
} from '@revhappy/activation-sdk';

const BACKEND_ID = 'electron-ipc';
const BACKEND_NAME = 'Electron IPC bridge';

async function createIpcSession(
  input: ActivationSessionCreateInput,
): Promise<ActivationSession> {
  const resolvedCapabilities = {
    textCompletion: true,
    textChat: true,
    streaming: true,
    visionImageInput: false,
    structuredJsonOutput: true,
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
      structuredJsonOutput: true,
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
      supportsStructuredJsonOutput: true,
      supportsToolCalling: false,
      supportsCancellation: true,
      supportedAccelerationModes: ['cpu' as const],
      detectedDevices: [],
      notes: [],
    },
    device: {
      platform: 'electron-renderer',
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
      memoryAssessment: { status: 'unknown' as const, detail: 'on-device (main process)' },
      reasons: [],
      warnings: [],
    },
    diagnostics: {
      sourceAdapterId: BACKEND_ID,
      backendId: BACKEND_ID,
      accelerationMode: 'cpu' as const,
    },
  };

  let activeRequestId: string | null = null;

  const runComplete = async (
    prompt: string,
    options: ActivationCompletionOptions | undefined,
  ): Promise<ActivationCompletionResult> => {
    const opts = options ?? {};
    const started = Date.now();
    let tokensGenerated = 0;
    let accumulated = '';
    const result = await window.machine.complete(
      {
        prompt,
        maxTokens: opts.maxTokens ?? 512,
        systemPrompt: opts.systemPrompt,
        grammar: opts.grammar,
        temperature: opts.temperature,
        topP: opts.topP,
        topK: opts.topK,
        stopSequences: opts.stopSequences,
        responseFormat:
          opts.responseFormat === 'json' || opts.responseFormat === 'text'
            ? opts.responseFormat
            : undefined,
      },
      (delta: string) => {
        tokensGenerated += 1;
        accumulated += delta;
        const seconds = (Date.now() - started) / 1000;
        const tokensPerSecond = seconds > 0 ? tokensGenerated / seconds : 0;
        opts.onToken?.(delta);
        opts.onChunk?.({
          rawToken: delta,
          text: accumulated,
          textDelta: delta,
          reasoningText: '',
          reasoningDelta: '',
          tokensGenerated,
          tokensPerSecond,
        });
      },
    );
    activeRequestId = result.requestId;
    const seconds = (Date.now() - started) / 1000;
    return {
      text: result.text,
      reasoningText: '',
      tokensGenerated,
      tokensPerSecond:
        result.tokensPerSecond ?? (seconds > 0 ? tokensGenerated / seconds : 0),
    };
  };

  return {
    modelId: input.modelId,
    backendId: BACKEND_ID,
    resolvedContract: capabilitySnapshot.resolvedContract,
    capabilitySnapshot,

    complete: (prompt, options) => runComplete(prompt, options),

    completeChat: async (messages, options) => {
      const last = messages[messages.length - 1];
      const lastContent =
        typeof last?.content === 'string'
          ? last.content
          : (last?.content ?? [])
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('\n');
      return runComplete(lastContent ?? '', options);
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
      if (activeRequestId) {
        await window.machine.abort(activeRequestId);
        activeRequestId = null;
      }
    },
    close: async () => undefined,
  };
}

export const ipcRuntime: ActivationRuntime = {
  id: BACKEND_ID,
  name: BACKEND_NAME,
  createSession: (input) => createIpcSession(input),
};
