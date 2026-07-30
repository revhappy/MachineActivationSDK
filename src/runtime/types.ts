import type { ActivationAccelerationMode } from '../activation/activationContract';

/**
 * The subset of `fetch` this adapter uses. Declared structurally rather than as
 * `typeof fetch` so the package typechecks in a React Native / DOM-less
 * TypeScript project, and so tests can inject a fake without `as unknown as`.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface LlamaServerRuntimeOptions {
  /**
   * Base URL of a running llama-server, without a trailing slash — e.g.
   * `http://127.0.0.1:8080`. Any OpenAI-compatible endpoint that honors the
   * `grammar` body field works here.
   */
  baseUrl: string;

  /**
   * Injected `fetch`. Defaults to the global. Provide one to add retries or
   * proxying, or in a runtime where `fetch` is not global.
   */
  fetchImpl?: FetchLike;

  /** Sent as `Authorization: Bearer <apiKey>` when set (llama-server `--api-key`). */
  apiKey?: string;

  /** Value of the request's `model` field. llama-server ignores it; proxies may not. */
  modelName?: string;

  /**
   * Context window to report through the activation contract. Prefer leaving
   * this unset — the adapter reads the real value from llama-server `/props`.
   */
  contextTokens?: number;

  /**
   * Acceleration actually in effect. The adapter cannot detect this over HTTP,
   * so whoever launched the server declares it. `startLlamaServer()` fills it in
   * from the vendored build record.
   */
  acceleration?: ActivationAccelerationMode;

  /**
   * Set when the server was started with an `--mmproj` projector. Image parts
   * are then forwarded as OpenAI `image_url` content instead of being dropped.
   */
  supportsVision?: boolean;

  /** Stream tokens over SSE. Default `true`. */
  stream?: boolean;

  /** `max_tokens` when a call does not specify one. Default 512. */
  defaultMaxTokens?: number;

  /** Platform label for the device declaration. Defaults to a best guess. */
  platform?: string;

  /** Free-form notes surfaced in diagnostics — e.g. the llama.cpp build id. */
  backendVersion?: string;

  /** Called with adapter-level log lines (request failures, `/props` misses). */
  onLog?: (line: string) => void;

  /**
   * Extra fields merged into every request body — for llama.cpp sampler knobs
   * the activation contract does not model (`min_p`, `repeat_penalty`,
   * `mirostat`, `dry_multiplier`, …).
   *
   * These act as **defaults**: a value here is used only when the individual
   * call did not set that field, and `messages` / `stream` / `grammar` can never
   * be overridden. This exists so needing one backend-specific knob does not
   * force an app to fork the adapter — which is exactly how the duplicated
   * copies of it came about.
   */
  extraBody?: Record<string, unknown>;
}
