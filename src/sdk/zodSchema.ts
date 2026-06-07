import type { SchemaLike } from './types';
import type { JsonSchema } from './jsonSchema';
import { zodToJsonSchema } from './zodToJsonSchema';

/**
 * Wrap a Zod schema into the SDK's `SchemaLike` shape with `toJsonSchema()`
 * pre-attached. Using this wrapper lets `generateObject` and the tool loop
 * emit a schema-specific GBNF grammar; without it, they fall back to
 * prompt-only JSON mode.
 */
export interface ZodLikeSchema<T> {
  parse(value: unknown): T;
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: unknown };
}

export function zodSchema<T>(zod: ZodLikeSchema<T>): SchemaLike<T> {
  return {
    parse: (value: unknown) => zod.parse(value),
    safeParse: (value: unknown) => zod.safeParse(value),
    toJsonSchema: (): JsonSchema | null => zodToJsonSchema(zod),
  };
}
