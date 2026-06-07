import type { JsonSchema, JsonSchemaPrimitiveType } from './jsonSchema';

/**
 * Emit a llama.cpp-compatible GBNF grammar that matches exactly the JSON
 * values described by the given schema. Supports the portable subset
 * declared by `JsonSchema`. On an unsupported construct, falls back to
 * "any valid JSON" for that sub-tree.
 */
export function jsonSchemaToGbnf(schema: JsonSchema): string {
  const emitter = new GbnfEmitter();
  const rootRef = emitter.resolveRule(schema);
  return emitter.build(rootRef);
}

const BASE_RULE_DEFS: Record<string, string> = {
  ws: String.raw`[ \t\n\r]*`,
  string: String.raw`"\"" strchar* "\""`,
  strchar: String.raw`[^"\\] | "\\" escape`,
  escape: String.raw`["\\/bfnrt] | "u" hex hex hex hex`,
  hex: String.raw`[0-9a-fA-F]`,
  number: String.raw`"-"? ("0" | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [-+]? [0-9]+)?`,
  integer: String.raw`"-"? ("0" | [1-9] [0-9]*)`,
  boolean: String.raw`"true" | "false"`,
  null: String.raw`"null"`,
  anyValue: 'string | number | boolean | jsonNull | anyArray | anyObject',
  anyArray: String.raw`"[" ws (anyValue (ws "," ws anyValue)*)? ws "]"`,
  anyObject: String.raw`"{" ws (string ws ":" ws anyValue (ws "," ws string ws ":" ws anyValue)*)? ws "}"`,
};

const BASE_RULE_DEPS: Record<string, string[]> = {
  string: ['strchar'],
  strchar: ['escape'],
  escape: ['hex'],
  anyValue: ['string', 'number', 'boolean', 'jsonNull', 'anyArray', 'anyObject'],
  anyArray: ['ws', 'anyValue'],
  anyObject: ['ws', 'string', 'anyValue'],
};

const BASE_RULE_EMIT_ORDER: string[] = [
  'ws',
  'string',
  'strchar',
  'escape',
  'hex',
  'number',
  'integer',
  'boolean',
  'jsonNull',
  'anyValue',
  'anyArray',
  'anyObject',
];

const PRIMITIVE_TO_BASE_RULE: Partial<Record<JsonSchemaPrimitiveType, string>> = {
  string: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  null: 'jsonNull',
};

class GbnfEmitter {
  private readonly rules = new Map<string, string>();
  private nextId = 0;
  private readonly usedBase = new Set<string>();
  private readonly cache = new Map<string, string>();

  // `jsonNull` is our rename of the `null` base rule (to avoid clashing with
  // the GBNF reserved word "null" used in `anyValue`).
  private readonly baseDefs: Record<string, string> = {
    ...BASE_RULE_DEFS,
    jsonNull: BASE_RULE_DEFS.null,
  };

  resolveRule(schema: JsonSchema): string {
    const sig = canonicalize(schema);
    const cached = this.cache.get(sig);
    if (cached) return cached;

    // Primitive-typed with no additional constraints → reuse a base rule.
    if (isPlainPrimitive(schema)) {
      const baseName =
        PRIMITIVE_TO_BASE_RULE[schema.type as JsonSchemaPrimitiveType]!;
      this.useBase(baseName);
      this.cache.set(sig, baseName);
      return baseName;
    }

    // Schema with no type/enum/const/union → treat as "any value".
    if (isEffectivelyAny(schema)) {
      this.useBase('anyValue');
      this.cache.set(sig, 'anyValue');
      return 'anyValue';
    }

    const name = this.allocName(hintFor(schema));
    this.cache.set(sig, name);
    this.rules.set(name, ''); // placeholder
    this.rules.set(name, this.buildBody(schema));
    return name;
  }

  private buildBody(schema: JsonSchema): string {
    if (schema.const !== undefined) {
      return gbnfStringLiteral(JSON.stringify(schema.const));
    }

    if (schema.enum && schema.enum.length > 0) {
      return schema.enum
        .map((value) => gbnfStringLiteral(JSON.stringify(value)))
        .join(' | ');
    }

    const union = schema.anyOf ?? schema.oneOf;
    if (union && union.length > 0) {
      return union.map((sub) => this.resolveRule(sub)).join(' | ');
    }

    if (schema.allOf && schema.allOf.length === 1) {
      return this.resolveRule(schema.allOf[0]);
    }

    if (schema.nullable === true) {
      const stripped: JsonSchema = { ...schema, nullable: false };
      const inner = this.resolveRule(stripped);
      const nullRef = this.resolveRule({ type: 'null' });
      return `${inner} | ${nullRef}`;
    }

    if (Array.isArray(schema.type)) {
      return schema.type
        .map((t) => this.resolveRule({ ...schema, type: t }))
        .join(' | ');
    }

    switch (schema.type) {
      case 'object':
        return this.emitObjectBody(schema);
      case 'array':
        return this.emitArrayBody(schema);
      case 'string':
      case 'number':
      case 'integer':
      case 'boolean':
      case 'null': {
        const baseName = PRIMITIVE_TO_BASE_RULE[schema.type]!;
        this.useBase(baseName);
        return baseName;
      }
      default:
        this.useBase('anyValue');
        return 'anyValue';
    }
  }

  private emitObjectBody(schema: JsonSchema): string {
    const props = schema.properties ?? {};
    const keys = Object.keys(props);
    this.useBase('ws');

    if (keys.length === 0) {
      if (schema.additionalProperties === false) {
        return `"{" ws "}"`;
      }
      this.useBase('anyObject');
      return 'anyObject';
    }

    const required = new Set(schema.required ?? []);
    let tail = '';
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const key = keys[i];
      const ruleName = this.resolveRule(props[key]);
      const keyLiteral = gbnfStringLiteral(JSON.stringify(key));
      const pair = `${keyLiteral} ws ":" ws ${ruleName}`;
      const isOptional = !required.has(key);
      let segment =
        i === 0
          ? tail
            ? `${pair} ${tail}`
            : pair
          : tail
            ? `ws "," ws ${pair} ${tail}`
            : `ws "," ws ${pair}`;
      if (isOptional) {
        segment = `(${segment})?`;
      }
      tail = segment;
    }
    return `"{" ws ${tail} ws "}"`;
  }

  private emitArrayBody(schema: JsonSchema): string {
    this.useBase('ws');
    if (!schema.items) {
      this.useBase('anyValue');
      return `"[" ws (anyValue (ws "," ws anyValue)*)? ws "]"`;
    }
    const itemRule = this.resolveRule(schema.items);
    const minItems = typeof schema.minItems === 'number' ? schema.minItems : 0;
    if (minItems >= 1) {
      return `"[" ws ${itemRule} (ws "," ws ${itemRule})* ws "]"`;
    }
    return `"[" ws (${itemRule} (ws "," ws ${itemRule})*)? ws "]"`;
  }

  private useBase(name: string): void {
    if (this.usedBase.has(name)) return;
    this.usedBase.add(name);
    for (const dep of BASE_RULE_DEPS[name] ?? []) {
      this.useBase(dep);
    }
  }

  private allocName(hint: string): string {
    const id = this.nextId;
    this.nextId += 1;
    return `${hint}-${id}`;
  }

  build(rootRef: string): string {
    const lines: string[] = [`root ::= ${rootRef}`];
    for (const [name, rhs] of this.rules) {
      lines.push(`${name} ::= ${rhs}`);
    }
    for (const name of BASE_RULE_EMIT_ORDER) {
      if (this.usedBase.has(name)) {
        lines.push(`${name} ::= ${this.baseDefs[name]}`);
      }
    }
    return lines.join('\n');
  }
}

function isPlainPrimitive(schema: JsonSchema): boolean {
  if (typeof schema.type !== 'string') return false;
  if (schema.type === 'object' || schema.type === 'array') return false;
  if (schema.enum || schema.const !== undefined) return false;
  if (schema.anyOf || schema.oneOf || schema.allOf) return false;
  if (schema.nullable) return false;
  return true;
}

function isEffectivelyAny(schema: JsonSchema): boolean {
  return (
    schema.type === undefined &&
    schema.enum === undefined &&
    schema.const === undefined &&
    !schema.anyOf &&
    !schema.oneOf &&
    !schema.allOf &&
    !schema.nullable
  );
}

function hintFor(schema: JsonSchema): string {
  if (schema.type === 'object') return 'obj';
  if (schema.type === 'array') return 'arr';
  if (schema.enum) return 'enumv';
  if (schema.const !== undefined) return 'constv';
  if (schema.anyOf || schema.oneOf) return 'union';
  if (schema.allOf) return 'allof';
  return 'rule';
}

function gbnfStringLiteral(literal: string): string {
  const escaped = literal.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(',')}}`;
}
