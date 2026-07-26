import type {
  ActivationChatMessage,
  ActivationCompletionOptions,
  ActivationCompletionResult,
  ActivationRuntime,
  ActivationSession,
  ActivationSessionCreateInput,
} from '../activation/activationAdapter';
import {
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  type ActivationCapabilitySnapshot,
  type ActivationDiagnostics,
  type AppCapabilityRequirements,
  resolveCapabilityContract,
} from '../activation/activationContract';

export interface StubRuntimeOptions {
  /**
   * Produce the reply. Return schema-valid JSON here when the test exercises
   * `generateObject` — the stub does not interpret the GBNF grammar it is
   * handed, it only reports that one arrived.
   */
  respond?: (
    messages: ActivationChatMessage[],
    options: ActivationCompletionOptions | undefined,
  ) => string | Promise<string>;
  /** Adapter id, in case a test asserts on routing. Default `stub`. */
  id?: string;
  /** Emit the reply as N whitespace-delimited chunks rather than one. Default true. */
  chunked?: boolean;
}

const DEFAULT_REPLY =
  'Stub runtime reply. Pass `respond` to stubRuntime() to control this text.';

/**
 * A deterministic `ActivationRuntime` that needs no model, no binary and no
 * network.
 *
 * This exists because proving an app's *pipeline* — capture, queue, parse,
 * persist, render — should not require a multi-gigabyte download in CI. It
 * streams through `onToken`/`onChunk` exactly like a real adapter, so streaming
 * consumers are exercised rather than bypassed, and it reports a `compatible`
 * contract so activation does not have to be special-cased in tests.
 *
 * It is intentionally not a mock of llama.cpp: it will happily return text that
 * violates the grammar it was given. Assert on your app's handling, not on the
 * model's behavior.
 */
export function stubRuntime(options: StubRuntimeOptions = {}): ActivationRuntime {
  const backendId = options.id ?? 'stub';
  const respond = options.respond ?? (() => DEFAULT_REPLY);
  const chunked = options.chunked !== false;

  return {
    id: backendId,
    name: 'Deterministic stub runtime (no model)',
    supportedModelFormats: ['gguf', 'task', 'litertlm'],

    createSession: async (input: ActivationSessionCreateInput): Promise<ActivationSession> => {
      const appRequirements: AppCapabilityRequirements = {
        textCompletion: true,
        textChat: true,
        ...input.appRequirements,
      };

      const model = {
        modelId: input.modelId,
        modelPath: input.filePath || 'stub',
        inputModalities: ['text' as const],
        outputModalities: ['text' as const],
        contextWindowTokens: input.contextWindowTokens ?? 4096,
        supportsTextCompletion: true,
        supportsTextChat: true,
        supportsStreaming: true,
        structuredJsonOutput: true,
        toolCalling: true,
        requiresProjector: false,
        projectorAttached: false,
        notes: ['Stub runtime: replies are canned, not generated.'],
      };

      const backend = {
        backendId,
        backendName: 'stub',
        sessionCreationAvailable: true,
        supportsStreaming: true,
        supportsVision: false,
        supportsStructuredJsonOutput: true,
        supportsToolCalling: true,
        supportsCancellation: true,
        supportedAccelerationModes: ['cpu' as const],
        detectedDevices: [],
        notes: [],
      };

      const device = {
        platform: 'stub',
        cameraAvailable: false,
        photoLibraryAvailable: false,
        availableAccelerationModes: ['cpu' as const],
        notes: [],
      };

      const resolvedContract = resolveCapabilityContract({
        appRequirements,
        model,
        backend,
        device,
      });

      const diagnostics: ActivationDiagnostics = {
        sourceAdapterId: backendId,
        backendId,
        backendName: 'stub',
        accelerationMode: 'cpu',
        backendSummary: 'Deterministic stub — no model is loaded.',
      };

      const capabilitySnapshot: ActivationCapabilitySnapshot = {
        schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
        appRequirements,
        model,
        backend,
        device,
        resolvedContract,
        diagnostics,
      };

      let aborted = false;

      const run = async (
        messages: ActivationChatMessage[],
        completion: ActivationCompletionOptions | undefined,
      ): Promise<ActivationCompletionResult> => {
        aborted = false;
        const text = await respond(messages, completion);
        // Deliberately not a lookbehind split: Hermes (React Native) has
        // historically shipped without lookbehind support, and this package is
        // meant to run there too.
        const pieces = text.length === 0 ? [] : chunked ? text.match(/\S+\s*/g) ?? [text] : [text];

        let accumulated = '';
        let tokensGenerated = 0;
        for (const piece of pieces) {
          if (aborted || completion?.abortSignal?.aborted) {
            const error = new Error('Stub runtime completion aborted.');
            error.name = 'AbortError';
            throw error;
          }
          accumulated += piece;
          tokensGenerated += 1;
          completion?.onToken?.(piece);
          completion?.onChunk?.({
            rawToken: piece,
            text: accumulated,
            textDelta: piece,
            reasoningText: '',
            reasoningDelta: '',
            tokensGenerated,
            tokensPerSecond: 0,
          });
        }

        return { text: accumulated, reasoningText: '', tokensGenerated, tokensPerSecond: 0 };
      };

      return {
        modelId: input.modelId,
        backendId,
        resolvedContract,
        capabilitySnapshot,
        complete: (prompt, completion) =>
          run([{ role: 'user', content: prompt }], completion),
        completeChat: (messages, completion) => run(messages, completion),
        contextState: async () => ({
          strategy: 'fresh',
          reuseStateAvailable: false,
          maxContextTokens: model.contextWindowTokens,
          overflowStrategy: 'reset',
          notes: [],
        }),
        resetContext: async () => undefined,
        probeVisionReadiness: async () => ({
          ready: false,
          detail: 'The stub runtime has no vision path.',
        }),
        diagnostics: async () => diagnostics,
        abort: async () => {
          aborted = true;
        },
        close: async () => undefined,
      };
    },
  };
}
