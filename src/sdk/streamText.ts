import type {
  ActivationCompletionChunk,
  ActivationCompletionOptions,
  ActivationCompletionResult,
} from '../activation/activationAdapter';
import type {
  FinishReason,
  StreamTextOptions,
  StreamTextResult,
  UsageInfo,
} from './types';

const MAX_QUEUED_CHUNKS = 1024;

export function streamText(options: StreamTextOptions): StreamTextResult {
  const queue: string[] = [];
  let waitNext: (() => void) | null = null;
  let done = false;
  let error: unknown = null;
  let droppedChunks = 0;

  const wake = (): void => {
    if (waitNext) {
      const fn = waitNext;
      waitNext = null;
      fn();
    }
  };

  const finalCompletion: Promise<ActivationCompletionResult> = (async () => {
    const session = await options.model.getSession();

    const completionOptions: ActivationCompletionOptions = {
      systemPrompt: options.system,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      maxTokens: options.maxTokens,
      stopSequences: options.stopSequences,
      onChunk: (chunk: ActivationCompletionChunk) => {
        if (chunk.textDelta) {
          if (queue.length >= MAX_QUEUED_CHUNKS) {
            queue.shift();
            droppedChunks += 1;
          }
          queue.push(chunk.textDelta);
          wake();
        }
      },
    };

    if (options.abortSignal) {
      const abortHandler = (): void => {
        void session.abort();
      };
      if (options.abortSignal.aborted) {
        abortHandler();
      } else {
        options.abortSignal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    if (options.messages && options.messages.length > 0) {
      return session.completeChat(options.messages, completionOptions);
    }
    if (options.prompt) {
      return session.complete(options.prompt, completionOptions);
    }
    throw new Error('streamText requires either `prompt` or `messages`.');
  })();

  finalCompletion.then(
    () => {
      done = true;
      wake();
    },
    (err) => {
      error = err;
      done = true;
      wake();
    },
  );

  const textStream: AsyncIterable<string> = {
    [Symbol.asyncIterator](): AsyncIterator<string> {
      return {
        async next(): Promise<IteratorResult<string>> {
          while (true) {
            if (queue.length > 0) {
              return { value: queue.shift()!, done: false };
            }
            if (done) {
              if (error) throw error;
              if (droppedChunks > 0) {
                // Surface once in console so devs notice — soft-fail only.
                console.warn(
                  `[machine] streamText dropped ${droppedChunks} chunk(s) due to consumer backpressure.`,
                );
                droppedChunks = 0;
              }
              return { value: undefined, done: true };
            }
            await new Promise<void>((resolve) => {
              waitNext = resolve;
            });
          }
        },
      };
    },
  };

  const text: Promise<string> = finalCompletion.then((result) => result.text);
  const usage: Promise<UsageInfo> = finalCompletion.then((result) => ({
    completionTokens: result.tokensGenerated,
    tokensPerSecond: result.tokensPerSecond,
  }));
  const finishReason: Promise<FinishReason> = finalCompletion.then((result) => {
    if (
      typeof options.maxTokens === 'number' &&
      result.tokensGenerated >= options.maxTokens
    ) {
      return 'length';
    }
    return 'stop';
  });

  // Mark the derived promises as observed so Node doesn't emit unhandled
  // rejection warnings when a consumer only iterates `textStream` and never
  // awaits text/usage/finishReason. Consumers who do await still receive the
  // rejection on the original promise chain.
  const swallow = (): undefined => undefined;
  text.catch(swallow);
  usage.catch(swallow);
  finishReason.catch(swallow);

  return {
    textStream,
    text,
    usage,
    finishReason,
    async abort() {
      const session = await options.model.getSession();
      await session.abort();
    },
  };
}
