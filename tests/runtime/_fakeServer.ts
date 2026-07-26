// A fake llama-server over the adapter's injected `fetch`.
//
// The adapter's whole job is to speak one wire protocol correctly, so the tests
// assert on the requests it emits and the streams it consumes. That is exactly
// the layer where the three hand-written copies of this adapter diverged —
// dropped history, dropped grammar, mangled tool roles — and none of them had a
// test that could see it.

import type { FetchLike, FetchLikeResponse } from '../../src/runtime/types';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface FakeServerOptions {
  /** Content deltas to emit as SSE chunks. */
  deltas?: string[];
  /** `reasoning_content` deltas, as a thinking model emits under --jinja. */
  reasoningDeltas?: string[];
  /**
   * One delta-array per successive completion request, for multi-turn flows like
   * the tool loop. Falls back to `deltas` once exhausted.
   */
  script?: string[][];
  /** Non-streaming reply body content. */
  message?: string;
  /** `/props` response. `null` makes /props fail with 404. */
  props?: Record<string, unknown> | null;
  /** Force a non-OK status on /v1/chat/completions. */
  status?: number;
  errorBody?: string;
}

export interface FakeServer {
  fetchImpl: FetchLike;
  requests: RecordedRequest[];
  /** Requests to /v1/chat/completions only. */
  completions: RecordedRequest[];
}

function sseStream(deltas: string[], reasoningDeltas: string[] = []): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frame = (delta: Record<string, string>): string =>
    `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
  const frames = [
    // A thinking model emits its reasoning first, then the answer.
    ...reasoningDeltas.map((delta) => frame({ reasoning_content: delta })),
    ...deltas.map((delta) => frame({ content: delta })),
    'data: [DONE]\n\n',
  ];
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= frames.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(frames[i]));
      i += 1;
    },
  });
}

function jsonResponse(value: unknown, status = 200): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    text: async () => JSON.stringify(value),
    json: async () => value,
  };
}

export function createFakeServer(options: FakeServerOptions = {}): FakeServer {
  const requests: RecordedRequest[] = [];
  let turn = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    const record: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      signal: init?.signal,
    };
    requests.push(record);

    if (url.endsWith('/props')) {
      if (options.props === null) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse(
        options.props ?? { default_generation_settings: { n_ctx: 8192 }, build_info: 'b9999' },
      );
    }

    if (init?.signal?.aborted) {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      throw error;
    }

    if (options.status && options.status >= 400) {
      return {
        ok: false,
        status: options.status,
        body: null,
        text: async () => options.errorBody ?? 'boom',
        json: async () => ({}),
      };
    }

    const scripted = options.script?.[turn];
    turn += 1;

    const streaming = record.body.stream === true;
    if (!streaming) {
      return jsonResponse({
        choices: [
          {
            message: {
              content: scripted?.join('') ?? options.message ?? 'non-streamed reply',
              reasoning_content: options.reasoningDeltas?.join('') ?? undefined,
            },
          },
        ],
        usage: { completion_tokens: 7 },
      });
    }

    return {
      ok: true,
      status: 200,
      body: sseStream(
        scripted ?? options.deltas ?? ['Hello', ' ', 'world'],
        options.reasoningDeltas ?? [],
      ),
      text: async () => '',
      json: async () => ({}),
    };
  };

  return {
    fetchImpl,
    requests,
    get completions() {
      return requests.filter((r) => r.url.endsWith('/v1/chat/completions'));
    },
  };
}
