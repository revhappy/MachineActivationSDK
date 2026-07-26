import type {
  ActivationCompletionOptions,
  ActivationCompletionResult,
  ActivationSession,
} from '../activation/activationAdapter';
import type {
  GenerateTextOptions,
  GenerateTextResult,
  UsageInfo,
  FinishReason,
} from './types';
import { linkSessionAbort, throwIfAborted } from './abort';
// The loop itself is shared with `streamText`, which drives the same steps with
// a streaming runner. See toolLoop.ts.
import { runToolLoop, shouldRunToolLoop } from './toolLoop';

export async function generateText(
  options: GenerateTextOptions,
): Promise<GenerateTextResult> {
  throwIfAborted(options.abortSignal, 'generateText was aborted before it started.');

  const session = await options.model.getSession();
  // Sessions are reused across calls, so the listener has to come back off
  // when this call settles — otherwise a later abort would cancel an
  // unrelated generation.
  const unlinkAbort = linkSessionAbort(options.abortSignal, session);

  try {
    if (shouldRunToolLoop(options)) {
      return await runWithTools(session, options);
    }
    return await runPlain(session, options);
  } finally {
    unlinkAbort();
  }
}

async function runPlain(
  session: ActivationSession,
  options: GenerateTextOptions,
): Promise<GenerateTextResult> {
  const completionOptions = toCompletionOptions(options);
  const result = await runCompletion(session, options, completionOptions);
  throwIfAborted(options.abortSignal, 'generateText was aborted during generation.');

  const diagnostics = await session.diagnostics();
  const finishReason = inferFinishReason(result, options);

  return {
    text: result.text,
    usage: toUsage(result),
    finishReason,
    reasoningText: result.reasoningText || undefined,
    steps: [
      {
        stepIndex: 0,
        text: result.text,
        toolCalls: [],
        toolResults: [],
        finishReason,
      },
    ],
    diagnostics,
  };
}

async function runWithTools(
  session: ActivationSession,
  options: GenerateTextOptions,
): Promise<GenerateTextResult> {
  const outcome = await runToolLoop({
    tools: options.tools!,
    toolChoice: options.toolChoice,
    system: options.system,
    prompt: options.prompt,
    messages: options.messages,
    maxSteps: options.maxSteps,
    abortSignal: options.abortSignal,
    onStepFinish: options.onStepFinish,
    label: 'generateText',
    runStep: async ({ messages, grammar }) => {
      const completionOptions = toCompletionOptions(options);
      completionOptions.responseFormat = 'json';
      // The tool preamble already carries the caller's `system` (see
      // buildToolSystemPrompt) as messages[0]. Sending it again here made
      // adapters render it twice; they had to work around that locally.
      delete completionOptions.systemPrompt;
      if (grammar) {
        completionOptions.grammar = grammar;
      }

      const result = await session.completeChat(messages, completionOptions);
      return {
        text: result.text,
        tokensGenerated: result.tokensGenerated,
        tokensPerSecond: result.tokensPerSecond,
      };
    },
  });

  const diagnostics = await session.diagnostics();

  return {
    text: outcome.text,
    usage: {
      completionTokens: outcome.completionTokens,
      tokensPerSecond: outcome.tokensPerSecond,
    },
    finishReason: outcome.finishReason,
    steps: outcome.steps,
    diagnostics,
  };
}

async function runCompletion(
  session: ActivationSession,
  options: GenerateTextOptions,
  completionOptions: ActivationCompletionOptions,
): Promise<ActivationCompletionResult> {
  if (options.messages && options.messages.length > 0) {
    return session.completeChat(options.messages, completionOptions);
  }
  if (options.prompt) {
    return session.complete(options.prompt, completionOptions);
  }
  throw new Error('generateText requires either `prompt` or `messages`.');
}

function toCompletionOptions(
  options: GenerateTextOptions,
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

function toUsage(result: ActivationCompletionResult): UsageInfo {
  return {
    completionTokens: result.tokensGenerated,
    tokensPerSecond: result.tokensPerSecond,
  };
}

function inferFinishReason(
  result: ActivationCompletionResult,
  options: GenerateTextOptions,
): FinishReason {
  if (
    typeof options.maxTokens === 'number' &&
    result.tokensGenerated >= options.maxTokens
  ) {
    return 'length';
  }
  return 'stop';
}
