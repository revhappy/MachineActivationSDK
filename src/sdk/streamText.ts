import type {
  ActivationCompletionChunk,
  ActivationCompletionOptions,
} from '../activation/activationAdapter';
import type {
  FinishReason,
  StepResult,
  StreamTextOptions,
  StreamTextResult,
  UsageInfo,
} from './types';
import { linkSessionAbort } from './abort';
import { createEnvelopeStreamParser } from './toolProtocol';
import { runToolLoop, shouldRunToolLoop } from './toolLoop';

const MAX_QUEUED_CHUNKS = 1024;

/** What a run — plain or agentic — settles to once the last token is in. */
interface StreamOutcome {
  text: string;
  usage: UsageInfo;
  finishReason: FinishReason;
  steps: StepResult[];
}

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

  const emit = (delta: string): void => {
    if (!delta) return;
    if (queue.length >= MAX_QUEUED_CHUNKS) {
      queue.shift();
      droppedChunks += 1;
    }
    queue.push(delta);
    wake();
  };

  const finalCompletion: Promise<StreamOutcome> = (async () => {
    const session = await options.model.getSession();

    // `completionOptions.abortSignal` covers adapters that cancel natively;
    // this covers the rest. See src/sdk/abort.ts.
    const unlinkAbort = linkSessionAbort(options.abortSignal, session);

    try {
      if (shouldRunToolLoop(options)) {
        const outcome = await runToolLoop({
          tools: options.tools!,
          toolChoice: options.toolChoice,
          system: options.system,
          prompt: options.prompt,
          messages: options.messages,
          maxSteps: options.maxSteps,
          abortSignal: options.abortSignal,
          onStepFinish: options.onStepFinish,
          label: 'streamText',
          runStep: async ({ messages, grammar }) => {
            // One parser per step: a tool step must not leak envelope
            // fragments, and the answer step must start decoding from scratch.
            const parser = createEnvelopeStreamParser();

            const completionOptions = toCompletionOptions(options);
            completionOptions.responseFormat = 'json';
            // The preamble in messages[0] already carries the caller's
            // `system`; sending it again makes adapters render it twice.
            delete completionOptions.systemPrompt;
            if (grammar) completionOptions.grammar = grammar;
            completionOptions.onChunk = (chunk: ActivationCompletionChunk) => {
              if (chunk.reasoningDelta) {
                options.onReasoning?.(chunk.reasoningText, chunk.reasoningDelta);
              }
              if (chunk.textDelta) emit(parser.push(chunk.textDelta));
            };

            const result = await session.completeChat(messages, completionOptions);
            return {
              text: result.text,
              tokensGenerated: result.tokensGenerated,
              tokensPerSecond: result.tokensPerSecond,
              committedAnswer: parser.committedAnswer,
            };
          },
        });

        return {
          text: outcome.text,
          usage: {
            completionTokens: outcome.completionTokens,
            tokensPerSecond: outcome.tokensPerSecond,
          },
          finishReason: outcome.finishReason,
          steps: outcome.steps,
        };
      }

      const completionOptions = toCompletionOptions(options);
      completionOptions.onChunk = (chunk: ActivationCompletionChunk) => {
        if (chunk.reasoningDelta) {
          options.onReasoning?.(chunk.reasoningText, chunk.reasoningDelta);
        }
        if (chunk.textDelta) emit(chunk.textDelta);
      };

      const result =
        options.messages && options.messages.length > 0
          ? await session.completeChat(options.messages, completionOptions)
          : options.prompt
            ? await session.complete(options.prompt, completionOptions)
            : (() => {
                throw new Error('streamText requires either `prompt` or `messages`.');
              })();

      const finishReason: FinishReason =
        typeof options.maxTokens === 'number' &&
        result.tokensGenerated >= options.maxTokens
          ? 'length'
          : 'stop';

      return {
        text: result.text,
        usage: {
          completionTokens: result.tokensGenerated,
          tokensPerSecond: result.tokensPerSecond,
        },
        finishReason,
        steps: [
          {
            stepIndex: 0,
            text: result.text,
            toolCalls: [],
            toolResults: [],
            finishReason,
          },
        ],
      };
    } finally {
      unlinkAbort();
    }
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
  const usage: Promise<UsageInfo> = finalCompletion.then((result) => result.usage);
  const finishReason: Promise<FinishReason> = finalCompletion.then(
    (result) => result.finishReason,
  );
  const steps: Promise<StepResult[]> = finalCompletion.then((result) => result.steps);
  const toolCalls: Promise<Array<{ toolName: string; args: unknown }>> =
    finalCompletion.then((result) => result.steps.flatMap((step) => step.toolCalls));

  // Mark the derived promises as observed so Node doesn't emit unhandled
  // rejection warnings when a consumer only iterates `textStream` and never
  // awaits text/usage/finishReason. Consumers who do await still receive the
  // rejection on the original promise chain.
  const swallow = (): undefined => undefined;
  text.catch(swallow);
  usage.catch(swallow);
  finishReason.catch(swallow);
  steps.catch(swallow);
  toolCalls.catch(swallow);

  return {
    textStream,
    text,
    usage,
    finishReason,
    steps,
    toolCalls,
    async abort() {
      const session = await options.model.getSession();
      await session.abort();
    },
  };
}

function toCompletionOptions(
  options: StreamTextOptions,
): ActivationCompletionOptions {
  return {
    systemPrompt: options.system,
    temperature: options.temperature,
    topP: options.topP,
    topK: options.topK,
    maxTokens: options.maxTokens,
    stopSequences: options.stopSequences,
    abortSignal: options.abortSignal,
    grammar: options.grammar,
  };
}
