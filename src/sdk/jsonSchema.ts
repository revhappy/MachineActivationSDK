/**
 * Minimal JSON Schema subset used by the SDK to emit GBNF for
 * grammar-constrained generation. Kept intentionally narrow: we support the
 * constructs we can lower to GBNF cleanly. Unknown constructs degrade to
 * "any valid JSON" when emitted.
 *
 * This type is NOT a full JSON Schema Draft 2020-12 type — it's the subset
 * the emitter understands. `zodToJsonSchema` and hand-built schemas should
 * target this shape.
 */

export type JsonSchemaPrimitiveType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array';

export interface JsonSchema {
  type?: JsonSchemaPrimitiveType | JsonSchemaPrimitiveType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  enum?: Array<string | number | boolean | null>;
  const?: string | number | boolean | null;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  nullable?: boolean;
  description?: string;
  title?: string;
}
