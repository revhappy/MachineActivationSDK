import type {
  ActivationChatMessage,
  ActivationCompletionOptions,
  ActivationCompletionResult,
  ActivationContextState,
  ActivationModelProbeInput,
  ActivationRuntime,
  ActivationSession,
  ActivationSessionCreateInput,
} from '../activation/activationAdapter';
import {
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  type ActivationAccelerationMode,
  type ActivationCapabilitySnapshot,
  type ActivationDiagnostics,
  type AppCapabilityRequirements,
  resolveCapabilityContract,
} from '../activation/activationContract';

import {
  BACKEND_ID,
  BACKEND_NAME,
  DEFAULT_CONTEXT_TOKENS,
  buildBackendDeclaration,
  buildDeviceDeclaration,
  buildModelDeclaration,
  fetchServerProps,
  type LlamaServerProps,
} from './capabilities';
import type { FetchLike, LlamaServerRuntimeOptions } from './types';
import { decodeRate, iterateSse, toWireMessage, type WireMessage } from './wire';

const SUPPORTED_FORMATS = ['gguf'];

/**
 * Fields `extraBody` may never set. Overriding these would let a config knob
 * break correctness — dropping the grammar silently degrades structured output,
 * and flipping `stream` desynchronizes the response parser from the response.
 */
const RESERVED_BODY_KEYS = new Set(['messages', 'stream', 'grammar', 'model']);

function detectPlatform(): string {
  const g = globalThis as {
    process?: { platform?: string; arch?: string };
    navigator?: { product?: string; userAgent?: string };
  };
  if (g.navigator?.product === 'ReactNative') return 'react-native';
  if (g.process?.platform) return `${g.process.platform}/${g.process.arch ?? 'unknown'}`;
  if (g.navigator?.userAgent) return 'browser';
  return 'unknown';
}

function resolveFetch(injected?: FetchLike): FetchLike {
  if (injected) return injected;
  const g = globalThis as { fetch?: FetchLike };
  if (!g.fetch) {
    throw new Error(
      'No global fetch is available. Pass `fetchImpl` to llamaServerRuntime() ' +
        '(Node 18+, modern browsers and React Native 0.72+ all provide one).',
    );
  }
  return g.fetch;
}

/**
 * An `ActivationRuntime` over any OpenAI-compatible llama.cpp `llama-server`
 * endpoint.
 *
 * This file is deliberately free of `node:*` imports: the same adapter runs in a
 * Next.js server action, an Electron main process, a browser tab, and a React
 * Native app. Only the transport differs, and that is injected.
 *
 * To spawn and manage the server process too, use
 * `machineai-activation-llama/node`.
 */
export function llamaServerRuntime(options: LlamaServerRuntimeOptions): ActivationRuntime {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = resolveFetch(options.fetchImpl);
  const streaming = options.stream !== false;
  const supportsVision = options.supportsVision === true;
  const acceleration: ActivationAccelerationMode = options.acceleration ?? 'cpu';
  const platform = options.platform ?? detectPlatform();
  const modelName = options.modelName ?? 'local';
  const defaultMaxTokens = options.defaultMaxTokens ?? 512;
  const extraBody = options.extraBody;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

  let cachedProps: LlamaServerProps | undefined;
  const props = async (): Promise<LlamaServerProps> => {
    if (!cachedProps) {
      cachedProps = await fetchServerProps(baseUrl, fetchImpl, headers, options.onLog);
    }
    return cachedProps;
  };

  const backendDeclaration = async () =>
    buildBackendDeclaration({
      acceleration,
      supportsVision,
      streaming,
      backendVersion: options.backendVersion ?? (await props()).buildInfo,
    });

  const deviceDeclaration = () =>
    buildDeviceDeclaration({ platform, acceleration, supportsVision });

  const modelDeclaration = async (probe: ActivationModelProbeInput) =>
    buildModelDeclaration({
      probe,
      props: await props(),
      contextTokens: options.contextTokens,
      supportsVision,
      streaming,
    });

  return {
    id: BACKEND_ID,
    name: BACKEND_NAME,
    version: options.backendVersion,
    supportedModelFormats: SUPPORTED_FORMATS,

    listBackendCapabilities: backendDeclaration,
    probeDeviceCapabilities: async () => deviceDeclaration(),
    probeModelPackage: modelDeclaration,

    createSession: async (input: ActivationSessionCreateInput): Promise<ActivationSession> => {
      const [backend, model] = await Promise.all([
        backendDeclaration(),
        modelDeclaration(input),
      ]);
      const device = deviceDeclaration();

      const appRequirements: AppCapabilityRequirements = {
        textCompletion: true,
        textChat: true,
        ...input.appRequirements,
      };

      const resolvedContract = resolveCapabilityContract({
        appRequirements,
        model,
        backend,
        device,
        preferredAcceleration: input.preferredAcceleration,
      });

      const contextTokens =
        input.contextWindowTokens ?? model.contextWindowTokens ?? DEFAULT_CONTEXT_TOKENS;

      const diagnostics: ActivationDiagnostics = {
        sourceAdapterId: BACKEND_ID,
        backendId: backend.backendId,
        backendName: backend.backendName,
        backendVersion: backend.backendVersion,
        accelerationMode: resolvedContract.resolvedCapabilities.accelerationMode,
        backendSummary: `llama-server at ${baseUrl}`,
        backendDetails: streaming
          ? 'Streaming over /v1/chat/completions SSE with native GBNF grammar pass-through.'
          : 'Single-shot /v1/chat/completions with native GBNF grammar pass-through.',
        deviceSummary: `${platform} (${device.availableAccelerationModes.join(', ')})`,
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

      let activeAbort: AbortController | null = null;

      const runChat = async (
        history: WireMessage[],
        completion: ActivationCompletionOptions | undefined,
      ): Promise<ActivationCompletionResult> => {
        const opts = completion ?? {};
        const messages: WireMessage[] = [];
        // Only prepend the system prompt when the caller has not already put one
        // in the history. The SDK's tool loop carries its preamble as
        // `messages[0]`, and sending both produced duplicated system turns.
        if (opts.systemPrompt && !history.some((m) => m.role === 'system')) {
          messages.push({ role: 'system', content: opts.systemPrompt });
        }
        messages.push(...history);

        const controller = new AbortController();
        activeAbort = controller;
        const callerSignal = opts.abortSignal;
        const onCallerAbort = (): void => controller.abort();
        if (callerSignal) {
          if (callerSignal.aborted) controller.abort();
          else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
        }

        const payload: Record<string, unknown> = {
          model: modelName,
          messages,
          stream: streaming,
          max_tokens: opts.maxTokens ?? defaultMaxTokens,
          temperature: opts.temperature,
          top_p: opts.topP,
          top_k: opts.topK,
          stop: opts.stopSequences,
          // Native GBNF. This is the whole reason generateObject() is reliable
          // on small local models — the sampler cannot emit invalid JSON.
          grammar: opts.grammar,
          // Only when no grammar was supplied: a grammar is strictly stronger
          // than json_object mode, and sending both lets the server pick.
          response_format:
            !opts.grammar && opts.responseFormat === 'json'
              ? { type: 'json_object' }
              : undefined,
        };

        // `extraBody` fills gaps rather than overwriting: assigning only where
        // the call left a field undefined. Spreading it would be wrong in both
        // directions — spread first and an unset `temperature: undefined` from
        // the call would delete the default (JSON.stringify drops undefined),
        // spread last and a caller's explicit value would be silently ignored.
        if (extraBody) {
          for (const [key, value] of Object.entries(extraBody)) {
            if (payload[key] === undefined && !RESERVED_BODY_KEYS.has(key)) {
              payload[key] = value;
            }
          }
        }

        const body = JSON.stringify(payload);

        let firstTokenAt = 0;
        let tokensGenerated = 0;
        let accumulated = '';
        let reasoning = '';

        try {
          const res = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers,
            body,
            signal: controller.signal,
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => '<no body>');
            throw new Error(`llama-server returned ${res.status}: ${errText}`);
          }

          if (!streaming) {
            const parsed = (await res.json()) as {
              choices?: Array<{
                message?: { content?: string; reasoning_content?: string };
              }>;
              usage?: { completion_tokens?: number };
            };
            accumulated = parsed.choices?.[0]?.message?.content ?? '';
            reasoning = parsed.choices?.[0]?.message?.reasoning_content ?? '';
            tokensGenerated = parsed.usage?.completion_tokens ?? 0;
            if (accumulated) {
              opts.onToken?.(accumulated);
              opts.onChunk?.({
                rawToken: accumulated,
                text: accumulated,
                textDelta: accumulated,
                reasoningText: reasoning,
                reasoningDelta: reasoning,
                tokensGenerated,
                tokensPerSecond: 0,
              });
            }
            return {
              text: accumulated,
              reasoningText: reasoning,
              tokensGenerated,
              tokensPerSecond: 0,
            };
          }

          if (!res.body) {
            throw new Error('llama-server returned a streaming response with no body.');
          }

          for await (const data of iterateSse(res.body)) {
            if (data === '[DONE]') break;
            let parsed: {
              choices?: Array<{
                delta?: { content?: string; reasoning_content?: string };
              }>;
            };
            try {
              parsed = JSON.parse(data) as typeof parsed;
            } catch {
              continue;
            }

            const delta = parsed.choices?.[0]?.delta?.content ?? '';
            // Thinking models (Gemma 4, DeepSeek-R1, Qwen3, …) emit their chain
            // of thought on a separate channel when llama-server runs with
            // --jinja. Reading only `content` made such a model look like it had
            // generated nothing at all: a live Gemma 4 E4B run reported 0 tokens
            // and an empty sample while spending its entire budget reasoning.
            const reasoningDelta = parsed.choices?.[0]?.delta?.reasoning_content ?? '';
            if (!delta && !reasoningDelta) continue;

            if (firstTokenAt === 0) firstTokenAt = Date.now();
            tokensGenerated += 1;
            accumulated += delta;
            reasoning += reasoningDelta;

            // `onToken` is the answer stream, so reasoning does not go through
            // it — a UI bound to it would otherwise render the model's private
            // deliberation as the reply. `onChunk` carries both, separated.
            if (delta) opts.onToken?.(delta);
            opts.onChunk?.({
              rawToken: delta || reasoningDelta,
              text: accumulated,
              textDelta: delta,
              reasoningText: reasoning,
              reasoningDelta,
              tokensGenerated,
              tokensPerSecond: decodeRate(tokensGenerated, firstTokenAt),
            });
          }
        } finally {
          // Drop the listener when the call settles, so a stale controller can
          // never cancel a later call on the same session.
          if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
          if (activeAbort === controller) activeAbort = null;
        }

        return {
          text: accumulated,
          reasoningText: reasoning,
          tokensGenerated,
          tokensPerSecond: decodeRate(tokensGenerated, firstTokenAt),
        };
      };

      return {
        modelId: input.modelId,
        backendId: BACKEND_ID,
        resolvedContract,
        capabilitySnapshot,
        complete: (prompt, completion) =>
          runChat([{ role: 'user', content: prompt }], completion),
        completeChat: (messages: ActivationChatMessage[], completion) =>
          runChat(
            messages.map((message) => toWireMessage(message, supportsVision)),
            completion,
          ),
        contextState: async (): Promise<ActivationContextState> => ({
          strategy: input.contextStrategy ?? 'fresh',
          reuseStateAvailable: false,
          maxContextTokens: contextTokens,
          overflowStrategy: 'reset',
          notes: [
            'llama-server keeps its own KV cache per slot; the adapter re-sends the full history each call.',
          ],
        }),
        resetContext: async () => undefined,
        probeVisionReadiness: async () => ({
          ready: resolvedContract.resolvedCapabilities.visionImageInput,
          detail: supportsVision
            ? 'A projector (--mmproj) is loaded; image parts are forwarded as image_url content.'
            : 'No projector loaded. Start llama-server with --mmproj and set supportsVision to enable images.',
        }),
        diagnostics: async () => diagnostics,
        abort: async () => {
          activeAbort?.abort();
        },
        close: async () => undefined,
      };
    },
  };
}
