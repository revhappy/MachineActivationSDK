import type { JsonSchema } from './jsonSchema';

/**
 * Convert a Zod v3 schema into the portable `JsonSchema` subset the SDK's
 * GBNF emitter understands. Duck-types on `_def.typeName` — never imports
 * zod — so this stays compatible with the optional-peer-dep rule.
 *
 * Returns `null` if a sub-schema can't be represented in our JsonSchema
 * subset. Callers should treat `null` as "no grammar available, fall back
 * to prompt-only JSON mode".
 */
export function zodToJsonSchema(zodSchema: unknown): JsonSchema | null {
  return walk(zodSchema);
}

function walk(node: unknown): JsonSchema | null {
  const def = readDef(node);
  if (!def) return null;
  const typeName = def.typeName;

  switch (typeName) {
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: isIntegerCheck(def) ? 'integer' : 'number' };
    case 'ZodBigInt':
      return { type: 'integer' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodNull':
      return { type: 'null' };
    case 'ZodAny':
    case 'ZodUnknown':
      return {};
    case 'ZodLiteral': {
      const value = def.value;
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
      ) {
        return { const: value };
      }
      return null;
    }
    case 'ZodEnum': {
      const values = Array.isArray(def.values) ? def.values.slice() : null;
      if (!values) return null;
      return { enum: values as Array<string | number | boolean | null> };
    }
    case 'ZodNativeEnum': {
      const raw = def.values as Record<string, string | number> | undefined;
      if (!raw || typeof raw !== 'object') return null;
      const values = Array.from(new Set(Object.values(raw))) as Array<
        string | number
      >;
      return { enum: values };
    }
    case 'ZodArray': {
      const inner = walk(def.type);
      if (!inner) return null;
      return { type: 'array', items: inner };
    }
    case 'ZodObject': {
      const shape = readShape(def);
      if (!shape) return null;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const key of Object.keys(shape)) {
        const { node: innerNode, isOptional } = unwrapOptional(shape[key]);
        const innerSchema = walk(innerNode);
        if (!innerSchema) return null;
        properties[key] = innerSchema;
        if (!isOptional) required.push(key);
      }
      const out: JsonSchema = { type: 'object', properties };
      if (required.length > 0) out.required = required;
      return out;
    }
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
    case 'ZodBranded':
      return walk(def.innerType);
    case 'ZodNullable': {
      const inner = walk(def.innerType);
      if (!inner) return null;
      return { anyOf: [inner, { type: 'null' }] };
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = Array.isArray(def.options) ? def.options : null;
      if (!options) return null;
      const jsonOptions: JsonSchema[] = [];
      for (const opt of options) {
        const inner = walk(opt);
        if (!inner) return null;
        jsonOptions.push(inner);
      }
      return { anyOf: jsonOptions };
    }
    default:
      return null;
  }
}

interface ZodDefLike {
  typeName: string;
  [k: string]: unknown;
}

function readDef(node: unknown): ZodDefLike | null {
  if (!node || typeof node !== 'object') return null;
  const def = (node as { _def?: unknown })._def;
  if (!def || typeof def !== 'object') return null;
  const typeName = (def as { typeName?: unknown }).typeName;
  if (typeof typeName !== 'string') return null;
  return def as ZodDefLike;
}

function isIntegerCheck(def: ZodDefLike): boolean {
  const checks = def.checks as Array<{ kind?: string }> | undefined;
  if (!Array.isArray(checks)) return false;
  return checks.some((c) => c && c.kind === 'int');
}

function readShape(def: ZodDefLike): Record<string, unknown> | null {
  const shape = def.shape;
  if (!shape) return null;
  if (typeof shape === 'function') {
    try {
      const called = (shape as () => unknown)();
      if (called && typeof called === 'object') {
        return called as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  if (typeof shape === 'object') {
    return shape as Record<string, unknown>;
  }
  return null;
}

function unwrapOptional(node: unknown): {
  node: unknown;
  isOptional: boolean;
} {
  const def = readDef(node);
  if (!def) return { node, isOptional: false };
  if (
    def.typeName === 'ZodOptional' ||
    def.typeName === 'ZodDefault' ||
    def.typeName === 'ZodCatch'
  ) {
    const unwrapped = unwrapOptional(def.innerType);
    return { node: unwrapped.node, isOptional: true };
  }
  return { node, isOptional: false };
}
