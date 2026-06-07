import {
  FilesetResolver,
  LlmInference,
  type WasmFileset,
} from '@mediapipe/tasks-genai';
import {
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  type ActivationCompletionOptions,
  type ActivationCompletionResult,
  type ActivationRuntime,
  type ActivationSession,
  type ActivationSessionCreateInput,
} from '@machine/activation-sdk';

const BACKEND_ID = 'mediapipe-tasks-genai';
const BACKEND_NAME = 'MediaPipe LLM Inference (WASM)';

let wasmFilesetPromise: Promise<WasmFileset> | null = null;
function getWasmFileset(): Promise<WasmFileset> {
  if (!wasmFilesetPromise) {
    // Path is relative to the renderer's index.html; vite copies the wasm
    // files to dist/renderer/mediapipe-wasm/ at build time, and serves the
    // same path during dev via a custom middleware.
    wasmFilesetPromise = FilesetResolver.forGenAiTasks('./mediapipe-wasm');
  }
  return wasmFilesetPromise;
}

function toAppModelUrl(filePath: string): string {
  // app-model:///<encoded-absolute-path>
  // On Windows the input is "C:\Users\...\model.task" — encodeURIComponent
  // handles the backslashes; the main-process protocol handler decodes them.
  return `app-model:///${encodeURIComponent(filePath)}`;
}

async function createMediaPipeSession(
  input: ActivationSessionCreateInput,
): Promise<ActivationSession> {
  const lower = input.filePath.toLowerCase();
  if (lower.endsWith('.litertlm')) {
    throw new Error(
      'Raw .litertlm files are not yet supported in JavaScript runtimes. ' +
        'Convert to a MediaPipe .task bundle (Google AI Edge LLM Inference docs) ' +
        'or pick a .gguf file. .litertlm support waits on a Node.js LiteRT-LM binding.',
    );
  }

  const fileset = await getWasmFileset();
  const llm = await LlmInference.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: toAppModelUrl(input.filePath) },
    maxTokens: 1024,
    topK: 40,
    temperature: 0.8,
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
      notes: ['MediaPipe LLM Inference does not expose grammar-constrained sampling.'],
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
      platform: 'electron-renderer-wasm',
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: ['cpu' as const],
      notes: [],
    },
    resolvedContract: {
      schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
      compatible: true,
      degraded: false,
      compatibility: 'compatible' as const,
      resolvedCapabilities,
      memoryAssessment: { status: 'unknown' as const, detail: 'on-device (renderer WASM)' },
      reasons: [],
      warnings: [],
    },
    diagnostics: {
      sourceAdapterId: BACKEND_ID,
      backendId: BACKEND_ID,
      accelerationMode: 'cpu' as const,
    },
  };

  const runComplete = async (
    prompt: string,
    options: ActivationCompletionOptions | undefined,
  ): Promise<ActivationCompletionResult> => {
    const opts = options ?? {};
    const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${prompt}` : prompt;
    const started = Date.now();
    let tokensGenerated = 0;
    let lastEmitted = '';
    const text = await llm.generateResponse(fullPrompt, (partial: string, _done: boolean) => {
      const delta = partial.slice(lastEmitted.length);
      lastEmitted = partial;
      if (!delta) return;
      tokensGenerated += 1;
      const seconds = (Date.now() - started) / 1000;
      const tokensPerSecond = seconds > 0 ? tokensGenerated / seconds : 0;
      opts.onToken?.(delta);
      opts.onChunk?.({
        rawToken: delta,
        text: partial,
        textDelta: delta,
        reasoningText: '',
        reasoningDelta: '',
        tokensGenerated,
        tokensPerSecond,
      });
    });
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
      try {
        llm.cancelProcessing();
      } catch {
        /* no-op if not running */
      }
    },
    close: async () => {
      try {
        llm.close();
      } catch {
        /* no-op */
      }
    },
  };
}

export const mediaPipeRuntime: ActivationRuntime = {
  id: BACKEND_ID,
  name: BACKEND_NAME,
  createSession: (input) => createMediaPipeSession(input),
};
