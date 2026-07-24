import type {
  ActivationChatMessage,
  ActivationCompletionOptions,
  ActivationCompletionResult,
  ActivationSession,
} from '../activation/activationAdapter';
import type {
  AnyToolDefinition,
  GenerateTextOptions,
  GenerateTextResult,
  StepResult,
  ToolDefinition,
  UsageInfo,
  FinishReason,
} from './types';
import type { JsonSchema } from './jsonSchema';
import { jsonSchemaToGbnf } from './jsonSchemaToGbnf';
import { linkSessionAbort, throwIfAborted } from './abort';

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

/**
 * `toolChoice: 'none'` means "do not call a tool", so we skip the loop
 * entirely and generate plain text — the tool preamble would only confuse the
 * model about a contract it isn't allowed to use.
 */
function shouldRunToolLoop(options: GenerateTextOptions): boolean {
  if (!options.tools || Object.keys(options.tools).length === 0) return false;
  return options.toolChoice !== 'none';
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
  const tools = options.tools!;
  const maxSteps = options.maxSteps ?? 5;
  const forcedToolName = resolveForcedToolName(options);

  const initialMessages: ActivationChatMessage[] = [...(options.messages ?? [])];
  if (options.prompt && initialMessages.length === 0) {
    initialMessages.push({ role: 'user', content: options.prompt });
  }

  const toolSystemPrompt = buildToolSystemPrompt(tools, options.system, forcedToolName);
  const messages: ActivationChatMessage[] = [
    { role: 'system', content: toolSystemPrompt },
    ...initialMessages,
  ];

  const toolLoopGrammar = buildToolLoopGrammar(tools);
  // `toolChoice: { toolName }` forces the FIRST step only: the grammar drops
  // the `answer` branch and every other tool, so the model can't do anything
  // but call it. Later steps go back to the full grammar, otherwise the loop
  // could never terminate.
  const forcedStepGrammar = forcedToolName
    ? buildToolLoopGrammar(tools, forcedToolName)
    : undefined;

  const steps: StepResult[] = [];
  let aggregateCompletionTokens = 0;
  let lastTokensPerSecond = 0;
  let finalText = '';

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    throwIfAborted(
      options.abortSignal,
      `generateText was aborted before tool-loop step ${stepIndex}.`,
    );

    const completionOptions = toCompletionOptions(options);
    completionOptions.responseFormat = 'json';
    // The tool preamble already carries the caller's `system` (see
    // buildToolSystemPrompt) as messages[0]. Sending it again here made
    // adapters render it twice; they had to work around that locally.
    delete completionOptions.systemPrompt;

    const stepGrammar =
      stepIndex === 0 && forcedStepGrammar ? forcedStepGrammar : toolLoopGrammar;
    if (stepGrammar) {
      completionOptions.grammar = stepGrammar;
    }

    const result = await session.completeChat(messages, completionOptions);
    throwIfAborted(
      options.abortSignal,
      `generateText was aborted during tool-loop step ${stepIndex}.`,
    );
    aggregateCompletionTokens += result.tokensGenerated;
    lastTokensPerSecond = result.tokensPerSecond;

    const parsed = tryParseToolJson(result.text);
    if (!parsed) {
      finalText = result.text;
      steps.push({
        stepIndex,
        text: result.text,
        toolCalls: [],
        toolResults: [],
        finishReason: 'stop',
      });
      if (options.onStepFinish) {
        await options.onStepFinish(steps[steps.length - 1]);
      }
      break;
    }

    if ('answer' in parsed && typeof parsed.answer === 'string') {
      finalText = parsed.answer;
      steps.push({
        stepIndex,
        text: parsed.answer,
        toolCalls: [],
        toolResults: [],
        finishReason: 'stop',
      });
      if (options.onStepFinish) {
        await options.onStepFinish(steps[steps.length - 1]);
      }
      break;
    }

    if (
      'tool' in parsed &&
      typeof parsed.tool === 'string' &&
      tools[parsed.tool]
    ) {
      const toolName = parsed.tool;
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

      const step: StepResult = {
        stepIndex,
        text: result.text,
        toolCalls: [{ toolName, args: parsedArgs }],
        toolResults: [
          toolError
            ? { toolName, result: null, error: toolError }
            : { toolName, result: toolResult },
        ],
        finishReason: 'tool-calls',
      };
      steps.push(step);
      if (options.onStepFinish) {
        await options.onStepFinish(step);
      }

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
    steps.push({
      stepIndex,
      text: result.text,
      toolCalls: [],
      toolResults: [],
      finishReason: 'other',
    });
    if (options.onStepFinish) {
      await options.onStepFinish(steps[steps.length - 1]);
    }
    break;
  }

  const diagnostics = await session.diagnostics();
  const last = steps[steps.length - 1];
  const finishReason: FinishReason =
    steps.length >= maxSteps && last?.finishReason === 'tool-calls'
      ? 'length'
      : last?.finishReason ?? 'other';

  return {
    text: finalText,
    usage: {
      completionTokens: aggregateCompletionTokens,
      tokensPerSecond: lastTokensPerSecond,
    },
    finishReason,
    steps,
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
  };
}

/**
 * Resolve `toolChoice: { toolName }` to a tool name, failing loudly if the
 * caller named a tool they didn't pass. Silently falling back to `auto` here
 * would turn a typo into a subtly different agent.
 */
function resolveForcedToolName(options: GenerateTextOptions): string | undefined {
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

function buildToolSystemPrompt(
  tools: Record<string, AnyToolDefinition>,
  existingSystem?: string,
  forcedToolName?: string,
): string {
  const toolList = Object.entries(tools)
    .map(([name, def]) => `- ${name}: ${def.description}`)
    .join('\n');

  const guidance = [
    existingSystem?.trim(),
    'You have access to the following tools:',
    toolList,
    '',
    'When you need to call a tool, respond with exactly:',
    '{"tool":"<tool_name>","args":{...}}',
    '',
    'When you are done and have a final answer, respond with exactly:',
    '{"answer":"<your final answer>"}',
    '',
    'Respond only with JSON in one of these two shapes.',
    forcedToolName ? `Start by calling the ${forcedToolName} tool.` : undefined,
  ]
    .filter(Boolean)
    .join('\n');

  return guidance;
}

function tryParseToolJson(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = safeJsonParse(trimmed);
  if (direct) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = safeJsonParse(fenced[1].trim());
    if (parsed) return parsed;
  }

  const bracketed = trimmed.match(/\{[\s\S]*\}/);
  if (bracketed) {
    const parsed = safeJsonParse(bracketed[0]);
    if (parsed) return parsed;
  }

  return null;
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Fallback `args` shape for a tool whose schema can't describe itself: any
 *  JSON object. Still far stronger than dropping the grammar — the model can
 *  only emit an object there, and the envelope around it stays locked. */
const ANY_TOOL_ARGS: JsonSchema = { type: 'object' };

/**
 * Build the GBNF for the tool-loop envelope:
 * `{"answer": string} | {"tool": "<name>", "args": {...}}`.
 *
 * A tool whose `parameters` can't produce a JSON Schema degrades to
 * `ANY_TOOL_ARGS` for *that tool's args only*. It used to sink the whole
 * grammar — one unschema'd tool and the entire loop, envelope included, ran
 * unconstrained. On 2–4B local models an unconstrained ReAct loop is exactly
 * where reliability collapses, so the envelope is the last thing to give up.
 *
 * `forcedToolName` narrows the union to that single tool (no `answer`
 * branch), which is how `toolChoice: { toolName }` is enforced.
 */
function buildToolLoopGrammar(
  tools: Record<string, AnyToolDefinition>,
  forcedToolName?: string,
): string | undefined {
  const branches: JsonSchema[] = [];

  if (!forcedToolName) {
    branches.push({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    });
  }

  for (const [toolName, def] of Object.entries(tools)) {
    if (forcedToolName && toolName !== forcedToolName) continue;
    branches.push({
      type: 'object',
      properties: {
        tool: { const: toolName },
        args: toolArgsSchema(def),
      },
      required: ['tool', 'args'],
    });
  }

  if (branches.length === 0) return undefined;
  return jsonSchemaToGbnf(branches.length === 1 ? branches[0] : { anyOf: branches });
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
