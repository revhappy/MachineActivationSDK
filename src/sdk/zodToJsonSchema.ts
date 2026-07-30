import type { JsonSchema } from './jsonSchema';

/**
 * Convert a Zod schema into the portable `JsonSchema` subset the SDK's GBNF
 * emitter understands. Supports **both Zod v3 and Zod v4** and never imports
 * zod — it duck-types on the internal `_def`, which keeps zod an optional peer
 * dependency.
 *
 * The two versions describe themselves differently:
 *
 * | | v3 | v4 |
 * |---|---|---|
 * | discriminator | `_def.typeName` (`'ZodString'`) | `_def.type` (`'string'`) |
 * | array element | `_def.type` | `_def.element` |
 * | literal | `_def.value` (one) | `_def.values` (array) |
 * | enum | `_def.values` (array) | `_def.entries` (record) |
 * | integer | `checks: [{ kind: 'int' }]` | `format: 'safeint'` |
 *
 * Everything else (`innerType`, `options`, `shape`) happens to line up.
 *
 * Returns `null` if a sub-schema can't be represented in our JsonSchema
 * subset. Callers should treat `null` as "no grammar available, fall back to
 * prompt-only JSON mode".
 */
export function zodToJsonSchema(zodSchema: unknown): JsonSchema | null {
  return walk(zodSchema);
}

/** Canonical node kinds, normalized across zod versions. */
type ZodKind =
  | 'string'
  | 'number'
  | 'bigint'
  | 'boolean'
  | 'null'
  | 'any'
  | 'literal'
  | 'enum'
  | 'nativeEnum'
  | 'array'
  | 'object'
  | 'passthrough'
  | 'nullable'
  | 'union';

interface ZodDefLike {
  [k: string]: unknown;
}

interface NormalizedNode {
  kind: ZodKind;
  def: ZodDefLike;
  /** True for v4-shaped defs; a few accessors still differ. */
  v4: boolean;
  /** True for wrappers that make an object property optional. */
  optionalWrapper: boolean;
}

// v3: `_def.typeName`.
const V3_KINDS: Record<string, { kind: ZodKind; optionalWrapper?: boolean }> = {
  ZodString: { kind: 'string' },
  ZodNumber: { kind: 'number' },
  ZodBigInt: { kind: 'bigint' },
  ZodBoolean: { kind: 'boolean' },
  ZodNull: { kind: 'null' },
  ZodAny: { kind: 'any' },
  ZodUnknown: { kind: 'any' },
  ZodLiteral: { kind: 'literal' },
  ZodEnum: { kind: 'enum' },
  ZodNativeEnum: { kind: 'nativeEnum' },
  ZodArray: { kind: 'array' },
  ZodObject: { kind: 'object' },
  ZodOptional: { kind: 'passthrough', optionalWrapper: true },
  ZodDefault: { kind: 'passthrough', optionalWrapper: true },
  ZodCatch: { kind: 'passthrough', optionalWrapper: true },
  ZodReadonly: { kind: 'passthrough' },
  ZodBranded: { kind: 'passthrough' },
  ZodNullable: { kind: 'nullable' },
  ZodUnion: { kind: 'union' },
  ZodDiscriminatedUnion: { kind: 'union' },
};

// v4: `_def.type`. Native enums collapse into `enum` here, and discriminated
// unions collapse into `union` (they carry an extra `discriminator` key we
// don't need).
const V4_KINDS: Record<string, { kind: ZodKind; optionalWrapper?: boolean }> = {
  string: { kind: 'string' },
  number: { kind: 'number' },
  int: { kind: 'bigint' },
  bigint: { kind: 'bigint' },
  boolean: { kind: 'boolean' },
  null: { kind: 'null' },
  any: { kind: 'any' },
  unknown: { kind: 'any' },
  literal: { kind: 'literal' },
  enum: { kind: 'enum' },
  array: { kind: 'array' },
  object: { kind: 'object' },
  optional: { kind: 'passthrough', optionalWrapper: true },
  default: { kind: 'passthrough', optionalWrapper: true },
  prefault: { kind: 'passthrough', optionalWrapper: true },
  catch: { kind: 'passthrough', optionalWrapper: true },
  readonly: { kind: 'passthrough' },
  nonoptional: { kind: 'passthrough' },
  nullable: { kind: 'nullable' },
  union: { kind: 'union' },
};

function readNode(node: unknown): NormalizedNode | null {
  if (!node || typeof node !== 'object') return null;
  const def = (node as { _def?: unknown })._def;
  if (!def || typeof def !== 'object') return null;

  const typeName = (def as { typeName?: unknown }).typeName;
  if (typeof typeName === 'string') {
    const mapped = V3_KINDS[typeName];
    if (!mapped) return null;
    return {
      kind: mapped.kind,
      def: def as ZodDefLike,
      v4: false,
      optionalWrapper: mapped.optionalWrapper === true,
    };
  }

  const type = (def as { type?: unknown }).type;
  if (typeof type === 'string') {
    const mapped = V4_KINDS[type];
    if (!mapped) return null;
    return {
      kind: mapped.kind,
      def: def as ZodDefLike,
      v4: true,
      optionalWrapper: mapped.optionalWrapper === true,
    };
  }

  return null;
}

function walk(node: unknown): JsonSchema | null {
  const normalized = readNode(node);
  if (!normalized) return null;
  const { kind, def, v4 } = normalized;

  switch (kind) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: isIntegerNumber(def, v4) ? 'integer' : 'number' };
    case 'bigint':
      return { type: 'integer' };
    case 'boolean':
      return { type: 'boolean' };
    case 'null':
      return { type: 'null' };
    case 'any':
      return {};
    case 'literal':
      return literalSchema(def, v4);
    case 'enum':
      return enumSchema(def, v4);
    case 'nativeEnum':
      return nativeEnumSchema(def);
    case 'array': {
      const inner = walk(v4 ? def.element : def.type);
      if (!inner) return null;
      return { type: 'array', items: inner };
    }
    case 'object':
      return objectSchema(def);
    case 'passthrough':
      return walk(def.innerType);
    case 'nullable': {
      const inner = walk(def.innerType);
      if (!inner) return null;
      return { anyOf: [inner, { type: 'null' }] };
    }
    case 'union': {
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

type PrimitiveLiteral = string | number | boolean | null;

function isPrimitiveLiteral(value: unknown): value is PrimitiveLiteral {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

function literalSchema(def: ZodDefLike, v4: boolean): JsonSchema | null {
  if (!v4) {
    return isPrimitiveLiteral(def.value) ? { const: def.value } : null;
  }
  // v4 literals can carry several values (`z.literal(['a','b'])`).
  const values = Array.isArray(def.values) ? def.values : null;
  if (!values || values.length === 0) return null;
  if (!values.every(isPrimitiveLiteral)) return null;
  if (values.length === 1) return { const: values[0] };
  return { enum: values };
}

function enumSchema(def: ZodDefLike, v4: boolean): JsonSchema | null {
  if (!v4) {
    const values = Array.isArray(def.values) ? def.values.slice() : null;
    if (!values) return null;
    return { enum: values as PrimitiveLiteral[] };
  }
  // v4 unifies `z.enum([...])` and `z.nativeEnum(...)` behind `entries`.
  return nativeEnumSchema({ values: def.entries });
}

function nativeEnumSchema(def: ZodDefLike): JsonSchema | null {
  const raw = def.values as Record<string, string | number> | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const values = Array.from(new Set(Object.values(raw))) as Array<string | number>;
  if (values.length === 0) return null;
  return { enum: values };
}

function objectSchema(def: ZodDefLike): JsonSchema | null {
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

/**
 * v3 records `z.number().int()` as a check with `kind: 'int'`. v4 records it
 * as a `number_format` check (or a top-level `format`) whose value is
 * `'safeint'` — `z.int()` and `z.number().int()` both land there.
 */
function isIntegerNumber(def: ZodDefLike, v4: boolean): boolean {
  if (!v4) {
    const checks = def.checks as Array<{ kind?: string }> | undefined;
    return Array.isArray(checks) && checks.some((c) => c && c.kind === 'int');
  }

  if (def.format === 'safeint' || def.format === 'int32' || def.format === 'uint32') {
    return true;
  }
  const checks = def.checks as
    | Array<{ _zod?: { def?: { format?: string } } }>
    | undefined;
  if (!Array.isArray(checks)) return false;
  return checks.some((c) => {
    const format = c?._zod?.def?.format;
    return format === 'safeint' || format === 'int32' || format === 'uint32';
  });
}

function readShape(def: ZodDefLike): Record<string, unknown> | null {
  const shape = def.shape;
  if (!shape) return null;
  // v3 objects expose `shape` as a lazy getter function; v4 as a plain object.
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
  const normalized = readNode(node);
  if (!normalized) return { node, isOptional: false };
  if (normalized.optionalWrapper) {
    const unwrapped = unwrapOptional(normalized.def.innerType);
    return { node: unwrapped.node, isOptional: true };
  }
  return { node, isOptional: false };
}
