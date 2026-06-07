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

export async function generateText(
  options: GenerateTextOptions,
): Promise<GenerateTextResult> {
  const session = await options.model.getSession();

  if (options.tools && Object.keys(options.tools).length > 0) {
    return runWithTools(session, options);
  }

  return runPlain(session, options);
}

async function runPlain(
  session: ActivationSession,
  options: GenerateTextOptions,
): Promise<GenerateTextResult> {
  const completionOptions = toCompletionOptions(options);
  const result = await runCompletion(session, options, completionOptions);

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

  const initialMessages: ActivationChatMessage[] = [...(options.messages ?? [])];
  if (options.prompt && initialMessages.length === 0) {
    initialMessages.push({ role: 'user', content: options.prompt });
  }

  const toolSystemPrompt = buildToolSystemPrompt(tools, options.system);
  const messages: ActivationChatMessage[] = [
    { role: 'system', content: toolSystemPrompt },
    ...initialMessages,
  ];

  const toolLoopGrammar = buildToolLoopGrammar(tools);

  const steps: StepResult[] = [];
  let aggregateCompletionTokens = 0;
  let lastTokensPerSecond = 0;
  let finalText = '';

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    const completionOptions = toCompletionOptions(options);
    completionOptions.responseFormat = 'json';
    if (toolLoopGrammar) {
      completionOptions.grammar = toolLoopGrammar;
    }

    const result = await session.completeChat(messages, completionOptions);
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

function buildToolSystemPrompt(
  tools: Record<string, AnyToolDefinition>,
  existingSystem?: string,
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

function buildToolLoopGrammar(
  tools: Record<string, AnyToolDefinition>,
): string | undefined {
  const branches: JsonSchema[] = [
    {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
  ];

  for (const [toolName, def] of Object.entries(tools)) {
    if (typeof def.parameters.toJsonSchema !== 'function') {
      return undefined;
    }
    let argsSchema: JsonSchema | null;
    try {
      argsSchema = def.parameters.toJsonSchema();
    } catch {
      return undefined;
    }
    if (!argsSchema) return undefined;
    branches.push({
      type: 'object',
      properties: {
        tool: { const: toolName },
        args: argsSchema,
      },
      required: ['tool', 'args'],
    });
  }

  return jsonSchemaToGbnf({ anyOf: branches });
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
