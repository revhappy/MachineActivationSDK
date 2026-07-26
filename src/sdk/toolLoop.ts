// The agentic loop itself, independent of how a step is generated.
//
// `generateText` and `streamText` run the *same* loop: same preamble, same
// envelope grammar, same forced-tool rule, same termination. They differ only in
// how one step reaches the model — a plain `completeChat`, or one wired to an
// `EnvelopeStreamParser` so the final answer can be shown as it decodes.
//
// That difference is a callback (`runStep`), not a second implementation. This
// repo has already paid for the alternative once: the llama-server adapter
// existed in four divergent copies and no fix ever propagated between them.
// A tool loop is a worse thing to fork, because the ways it drifts — a
// termination rule, an off-by-one on `maxSteps`, whether a failed tool ends the
// turn — are invisible until an agent misbehaves in production.

import type { ActivationChatMessage } from '../activation/activationAdapter';
import type {
  AnyToolDefinition,
  FinishReason,
  StepResult,
  ToolDefinition,
} from './types';
import type { JsonSchema } from './jsonSchema';
import { throwIfAborted } from './abort';
import {
  ANY_TOOL_ARGS,
  buildToolLoopGrammar,
  buildToolSystemPrompt,
  tryParseToolJson,
  type ToolDescriptor,
} from './toolProtocol';

export interface ToolLoopStepInput {
  messages: ActivationChatMessage[];
  /** The envelope grammar for this step. Undefined only if none could be built. */
  grammar?: string;
  stepIndex: number;
}

export interface ToolLoopStepOutput {
  text: string;
  tokensGenerated: number;
  tokensPerSecond: number;
  /**
   * The decoded answer, when the driver has already shown it to a consumer.
   *
   * Set by the streaming driver. It wins over re-parsing `text`, because a turn
   * truncated by `maxTokens` leaves unparseable JSON in `text` while the
   * consumer has already seen perfectly good partial prose — reporting the raw
   * `{"answer":"…` at that point would contradict what they just read.
   */
  committedAnswer?: string;
}

export interface ToolLoopOptions {
  tools: Record<string, AnyToolDefinition>;
  toolChoice?: 'auto' | 'none' | { toolName: string };
  system?: string;
  prompt?: string;
  messages?: ActivationChatMessage[];
  maxSteps?: number;
  abortSignal?: AbortSignal;
  onStepFinish?: (step: StepResult) => void | Promise<void>;
  runStep: (input: ToolLoopStepInput) => Promise<ToolLoopStepOutput>;
  /** Names the caller in abort messages, e.g. `generateText`. */
  label: string;
}

export interface ToolLoopOutcome {
  text: string;
  steps: StepResult[];
  completionTokens: number;
  tokensPerSecond: number;
  finishReason: FinishReason;
}

/**
 * `toolChoice: 'none'` means "do not call a tool", so the loop is skipped
 * entirely — the tool preamble would only confuse the model about a contract it
 * isn't allowed to use.
 */
export function shouldRunToolLoop(options: {
  tools?: Record<string, AnyToolDefinition>;
  toolChoice?: 'auto' | 'none' | { toolName: string };
}): boolean {
  if (!options.tools || Object.keys(options.tools).length === 0) return false;
  return options.toolChoice !== 'none';
}

export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopOutcome> {
  const { tools, label } = options;
  const maxSteps = options.maxSteps ?? 5;
  const forcedToolName = resolveForcedToolName(options);

  const initialMessages: ActivationChatMessage[] = [...(options.messages ?? [])];
  if (options.prompt && initialMessages.length === 0) {
    initialMessages.push({ role: 'user', content: options.prompt });
  }

  const descriptors = toDescriptors(tools);
  const toolSystemPrompt = buildToolSystemPrompt(
    descriptors,
    options.system,
    forcedToolName,
  );
  const messages: ActivationChatMessage[] = [
    { role: 'system', content: toolSystemPrompt },
    ...initialMessages,
  ];

  const toolLoopGrammar = buildToolLoopGrammar(descriptors);
  // `toolChoice: { toolName }` forces the FIRST step only: the grammar drops
  // the `answer` branch and every other tool, so the model can't do anything
  // but call it. Later steps go back to the full grammar, otherwise the loop
  // could never terminate.
  const forcedStepGrammar = forcedToolName
    ? buildToolLoopGrammar(descriptors, forcedToolName)
    : undefined;

  const steps: StepResult[] = [];
  let aggregateCompletionTokens = 0;
  let lastTokensPerSecond = 0;
  let finalText = '';

  const finishStep = async (step: StepResult): Promise<void> => {
    steps.push(step);
    if (options.onStepFinish) {
      await options.onStepFinish(step);
    }
  };

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    throwIfAborted(
      options.abortSignal,
      `${label} was aborted before tool-loop step ${stepIndex}.`,
    );

    const grammar =
      stepIndex === 0 && forcedStepGrammar ? forcedStepGrammar : toolLoopGrammar;

    const result = await options.runStep({ messages, grammar, stepIndex });
    throwIfAborted(
      options.abortSignal,
      `${label} was aborted during tool-loop step ${stepIndex}.`,
    );
    aggregateCompletionTokens += result.tokensGenerated;
    lastTokensPerSecond = result.tokensPerSecond;

    const parsed = tryParseToolJson(result.text);

    // A committed answer outranks the parse: the consumer has already read it.
    if (result.committedAnswer !== undefined && !isToolCall(parsed, tools)) {
      finalText = result.committedAnswer;
      await finishStep({
        stepIndex,
        text: finalText,
        toolCalls: [],
        toolResults: [],
        finishReason: 'stop',
      });
      break;
    }

    if (!parsed) {
      finalText = result.text;
      await finishStep({
        stepIndex,
        text: result.text,
        toolCalls: [],
        toolResults: [],
        finishReason: 'stop',
      });
      break;
    }

    if ('answer' in parsed && typeof parsed.answer === 'string') {
      finalText = parsed.answer;
      await finishStep({
        stepIndex,
        text: parsed.answer,
        toolCalls: [],
        toolResults: [],
        finishReason: 'stop',
      });
      break;
    }

    if (isToolCall(parsed, tools)) {
      const toolName = parsed.tool as string;
      const rawArgs = (parsed.args ?? {}) as unknown;
      const tool = tools[toolName] as ToolDefinition<unknown, unknown>;

      const parsedArgs = parseToolArgs(tool, rawArgs);
      let toolResult: unknown = undefined;
      let toolError: string | undefined;
      try {
        toolResult = await tool.execute(parsedArgs);
      } catch (error) {
        toolError = error instanceof Error ? error.message : String(error);
      }

      await finishStep({
        stepIndex,
        text: result.text,
        toolCalls: [{ toolName, args: parsedArgs }],
        toolResults: [
          toolError
            ? { toolName, result: null, error: toolError }
            : { toolName, result: toolResult },
        ],
        finishReason: 'tool-calls',
      });

      messages.push({ role: 'assistant', content: result.text });
      messages.push({
        role: 'tool',
        content: JSON.stringify({
          tool: toolName,
          result: toolError ? { error: toolError } : toolResult,
        }),
      });
      continue;
    }

    finalText = result.text;
    await finishStep({
      stepIndex,
      text: result.text,
      toolCalls: [],
      toolResults: [],
      finishReason: 'other',
    });
    break;
  }

  const last = steps[steps.length - 1];
  const finishReason: FinishReason =
    steps.length >= maxSteps && last?.finishReason === 'tool-calls'
      ? 'length'
      : (last?.finishReason ?? 'other');

  return {
    text: finalText,
    steps,
    completionTokens: aggregateCompletionTokens,
    tokensPerSecond: lastTokensPerSecond,
    finishReason,
  };
}

function isToolCall(
  parsed: Record<string, unknown> | null,
  tools: Record<string, AnyToolDefinition>,
): boolean {
  return Boolean(
    parsed && typeof parsed.tool === 'string' && tools[parsed.tool as string],
  );
}

/**
 * Resolve `toolChoice: { toolName }` to a tool name, failing loudly if the
 * caller named a tool they didn't pass. Silently falling back to `auto` here
 * would turn a typo into a subtly different agent.
 */
export function resolveForcedToolName(options: {
  tools?: Record<string, AnyToolDefinition>;
  toolChoice?: 'auto' | 'none' | { toolName: string };
}): string | undefined {
  const choice = options.toolChoice;
  if (!choice || typeof choice === 'string') return undefined;

  const { toolName } = choice;
  if (!options.tools || !options.tools[toolName]) {
    const available = Object.keys(options.tools ?? {}).join(', ') || '(none)';
    throw new Error(
      `toolChoice named "${toolName}", which is not in \`tools\`. Available: ${available}.`,
    );
  }
  return toolName;
}

/** Reduce the SDK's executable tools to the protocol's transport shape. */
export function toDescriptors(
  tools: Record<string, AnyToolDefinition>,
): ToolDescriptor[] {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    jsonSchema: toolArgsSchema(def),
  }));
}

function toolArgsSchema(def: AnyToolDefinition): JsonSchema {
  if (typeof def.parameters.toJsonSchema !== 'function') return ANY_TOOL_ARGS;
  try {
    return def.parameters.toJsonSchema() ?? ANY_TOOL_ARGS;
  } catch {
    return ANY_TOOL_ARGS;
  }
}

function parseToolArgs<T>(tool: ToolDefinition<T, unknown>, raw: unknown): T {
  if (tool.parameters.safeParse) {
    const result = tool.parameters.safeParse(raw);
    if (result.success) {
      return result.data;
    }
    return raw as T;
  }
  try {
    return tool.parameters.parse(raw);
  } catch {
    return raw as T;
  }
}
