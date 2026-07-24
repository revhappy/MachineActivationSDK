/**
 * Cancellation helpers shared by `generateText`, `streamText`, and
 * `generateObject`.
 *
 * Two things have to happen for a caller's `abortSignal` to actually stop
 * local inference:
 *
 *  1. The signal is forwarded to the runtime adapter via
 *     `ActivationCompletionOptions.abortSignal`, so adapters that can cancel
 *     natively (an HTTP-backed llama-server, a `fetch` to a web runtime) do.
 *  2. The SDK calls `session.abort()`, which every adapter implements, for
 *     runtimes that only expose imperative cancellation.
 *
 * `AbortSignal`/`AbortController` are available on Node 16+, in browsers, and
 * in the React Native runtime, so this stays portable — no `node:*` imports.
 */

/**
 * Build the conventional abort rejection. We construct a plain `Error` with
 * `name = 'AbortError'` rather than a `DOMException`, which isn't reliably
 * present across React Native runtimes. `error.name === 'AbortError'` is the
 * check callers should write.
 */
export function createAbortError(message = 'The operation was aborted.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/** Throw an `AbortError` if `signal` is already aborted. */
export function throwIfAborted(signal: AbortSignal | undefined, message?: string): void {
  if (signal?.aborted) {
    throw createAbortError(message);
  }
}

interface AbortableSession {
  abort(): Promise<void>;
}

/**
 * Bridge a caller's `AbortSignal` to a session's imperative `abort()`.
 * Returns a disposer that MUST be called once the operation settles, so the
 * listener doesn't outlive it and abort an unrelated later call on the same
 * (reused) session.
 */
export function linkSessionAbort(
  signal: AbortSignal | undefined,
  session: AbortableSession,
): () => void {
  if (!signal) {
    return () => undefined;
  }

  const onAbort = (): void => {
    void session.abort();
  };

  if (signal.aborted) {
    onAbort();
    return () => undefined;
  }

  signal.addEventListener('abort', onAbort, { once: true });
  return () => {
    signal.removeEventListener('abort', onAbort);
  };
}
