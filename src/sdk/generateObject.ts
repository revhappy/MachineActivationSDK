import type { ActivationCompletionOptions } from '../activation/activationAdapter';
import type {
  FinishReason,
  GenerateObjectOptions,
  GenerateObjectResult,
  SchemaLike,
  UsageInfo,
} from './types';
import { jsonSchemaToGbnf } from './jsonSchemaToGbnf';

export async function generateObject<T>(
  options: GenerateObjectOptions<T>,
): Promise<GenerateObjectResult<T>> {
  const session = await options.model.getSession();
  const grammar = buildGrammarFromSchema(options.schema);
  // Grammar-constrained generation should only ever emit a valid JSON instance
  // of the schema, so retrying against a schema-violating sample is pointless.
  // Callers who need the retry loop (no grammar) keep the default of 1.
  const maxRetries = options.maxRetries ?? (grammar ? 0 : 1);

  const baseCompletionOptions: ActivationCompletionOptions = {
    systemPrompt: buildSystemPrompt(options),
    temperature: options.temperature,
    topP: options.topP,
    topK: options.topK,
    maxTokens: options.maxTokens,
    stopSequences: options.stopSequences,
    responseFormat: 'json',
    grammar,
  };

  const initialMessages = options.messages && options.messages.length > 0
    ? options.messages
    : undefined;
  const initialPrompt = options.prompt;

  let lastRaw = '';
  let lastResult:
    | {
        text: string;
        tokensGenerated: number;
        tokensPerSecond: number;
      }
    | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const completionOptions: ActivationCompletionOptions = {
      ...baseCompletionOptions,
      systemPrompt:
        attempt === 0
          ? baseCompletionOptions.systemPrompt
          : `${baseCompletionOptions.systemPrompt}\n\nYour last response was not valid JSON in the required shape. Return ONLY a single JSON object that matches the schema. No prose, no fences.`,
    };

    const result = initialMessages
      ? await session.completeChat(initialMessages, completionOptions)
      : initialPrompt
        ? await session.complete(initialPrompt, completionOptions)
        : (() => {
            throw new Error('generateObject requires either `prompt` or `messages`.');
          })();

    lastResult = result;
    lastRaw = result.text;

    const extracted = extractJson(result.text);
    if (extracted !== null) {
      const parsed = tryParseSchema(options.schema, extracted);
      if (parsed.ok) {
        const diagnostics = await session.diagnostics();
        return {
          object: parsed.value,
          raw: result.text,
          usage: toUsage(result),
          finishReason: inferFinishReason(result, options),
          diagnostics,
        };
      }
      lastError = parsed.error;
    } else {
      lastError = new Error('Response was not parseable as JSON.');
    }
  }

  const diagnostics = await session.diagnostics();
  const err = new Error(
    `generateObject failed after ${maxRetries + 1} attempt(s). Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
  (err as Error & { raw?: string; usage?: UsageInfo; diagnostics?: unknown }).raw = lastRaw;
  if (lastResult) {
    (err as Error & { usage?: UsageInfo }).usage = toUsage(lastResult);
  }
  (err as Error & { diagnostics?: unknown }).diagnostics = diagnostics;
  throw err;
}

function buildGrammarFromSchema<T>(schema: SchemaLike<T>): string | undefined {
  if (typeof schema.toJsonSchema !== 'function') return undefined;
  try {
    const jsonSchema = schema.toJsonSchema();
    if (!jsonSchema) return undefined;
    return jsonSchemaToGbnf(jsonSchema);
  } catch {
    return undefined;
  }
}

function buildSystemPrompt<T>(options: GenerateObjectOptions<T>): string {
  const base = options.system?.trim();
  const pieces: string[] = [];
  if (base) pieces.push(base);
  pieces.push('Respond with a single JSON object and nothing else.');
  if (options.schemaDescription) {
    pieces.push(`The JSON must match this schema:\n${options.schemaDescription}`);
  }
  pieces.push('Do not include prose, markdown fences, or commentary.');
  return pieces.join('\n\n');
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const direct = safeJsonParse(trimmed);
  if (direct !== undefined) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = safeJsonParse(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }

  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj) {
    const parsed = safeJsonParse(obj[0]);
    if (parsed !== undefined) return parsed;
  }

  const arr = trimmed.match(/\[[\s\S]*\]/);
  if (arr) {
    const parsed = safeJsonParse(arr[0]);
    if (parsed !== undefined) return parsed;
  }

  return null;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function tryParseSchema<T>(
  schema: SchemaLike<T>,
  value: unknown,
): { ok: true; value: T } | { ok: false; error: unknown } {
  if (schema.safeParse) {
    const result = schema.safeParse(value);
    if (result.success) {
      return { ok: true, value: result.data };
    }
    return { ok: false, error: result.error };
  }
  try {
    const data = schema.parse(value);
    return { ok: true, value: data };
  } catch (error) {
    return { ok: false, error };
  }
}

function toUsage(result: {
  tokensGenerated: number;
  tokensPerSecond: number;
}): UsageInfo {
  return {
    completionTokens: result.tokensGenerated,
    tokensPerSecond: result.tokensPerSecond,
  };
}

function inferFinishReason<T>(
  result: { tokensGenerated: number },
  options: GenerateObjectOptions<T>,
): FinishReason {
  if (
    typeof options.maxTokens === 'number' &&
    result.tokensGenerated >= options.maxTokens
  ) {
    return 'length';
  }
  return 'stop';
}
