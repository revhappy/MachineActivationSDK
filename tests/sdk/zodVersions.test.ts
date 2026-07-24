import assert from 'node:assert/strict';
import { test } from '../_harness';
import { zodToJsonSchema } from '../../src/sdk/zodToJsonSchema';
import { zodSchema } from '../../src/sdk/zodSchema';
import { jsonSchemaToGbnf } from '../../src/sdk/jsonSchemaToGbnf';

// The rest of the zod tests use hand-built `_def` mocks so the suite has no
// hard dependency on zod. These run against the REAL library — both major
// versions, installed side by side as `zod3` / `zod4` devDependencies.
//
// Mocks can't catch what actually broke consumers here: the peer range
// excluded v4, and when people installed it anyway with --legacy-peer-deps the
// walker silently returned null (v4 renamed `_def.typeName` → `_def.type`), so
// `generateObject` dropped its grammar instead of erroring. A mock shaped like
// v3 will never notice that.
//
// eslint-disable-next-line @typescript-eslint/no-var-requires
const zodVersions: Array<[string, any]> = [
  ['zod v3', require('zod3')],
  ['zod v4', require('zod4')],
];

for (const [label, z] of zodVersions) {
  test(`${label}: primitives map to the JsonSchema subset`, () => {
    assert.deepEqual(zodToJsonSchema(z.string()), { type: 'string' });
    assert.deepEqual(zodToJsonSchema(z.number()), { type: 'number' });
    assert.deepEqual(zodToJsonSchema(z.number().int()), { type: 'integer' });
    assert.deepEqual(zodToJsonSchema(z.boolean()), { type: 'boolean' });
    assert.deepEqual(zodToJsonSchema(z.null()), { type: 'null' });
    assert.deepEqual(zodToJsonSchema(z.any()), {});
    assert.deepEqual(zodToJsonSchema(z.unknown()), {});
  });

  test(`${label}: literals and enums`, () => {
    assert.deepEqual(zodToJsonSchema(z.literal('ok')), { const: 'ok' });
    assert.deepEqual(zodToJsonSchema(z.literal(7)), { const: 7 });
    assert.deepEqual(zodToJsonSchema(z.enum(['low', 'high'])), {
      enum: ['low', 'high'],
    });
    assert.deepEqual(zodToJsonSchema(z.nativeEnum({ A: 'a', B: 'b' })), {
      enum: ['a', 'b'],
    });
  });

  test(`${label}: objects track required vs optional`, () => {
    const schema = z.object({
      title: z.string(),
      count: z.number().int(),
      note: z.string().optional(),
      fallback: z.string().default('x'),
    });

    assert.deepEqual(zodToJsonSchema(schema), {
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'integer' },
        note: { type: 'string' },
        fallback: { type: 'string' },
      },
      required: ['title', 'count'],
    });
  });

  test(`${label}: arrays, nullables and unions`, () => {
    assert.deepEqual(zodToJsonSchema(z.array(z.string())), {
      type: 'array',
      items: { type: 'string' },
    });
    assert.deepEqual(zodToJsonSchema(z.string().nullable()), {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
    assert.deepEqual(zodToJsonSchema(z.union([z.string(), z.number()])), {
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
  });

  test(`${label}: nested schema survives the round trip to GBNF`, () => {
    const schema = z.object({
      sentiment: z.enum(['positive', 'negative', 'neutral']),
      score: z.number(),
      tags: z.array(z.string()),
      meta: z.object({ source: z.string().optional() }),
    });

    const jsonSchema = zodToJsonSchema(schema);
    assert.ok(jsonSchema, 'walker returned a schema');

    // GBNF string literals arrive JSON-escaped, e.g. `"\"positive\""`.
    const gbnf = jsonSchemaToGbnf(jsonSchema!);
    assert.match(gbnf, /^root ::= /);
    assert.match(gbnf, /"\\"positive\\""/);
    assert.match(gbnf, /"\\"sentiment\\""/);
    assert.match(gbnf, /"\\"tags\\""/);
  });

  test(`${label}: zodSchema() wraps parse, safeParse and toJsonSchema`, () => {
    const schema = zodSchema(z.object({ n: z.number() }));

    assert.deepEqual(schema.parse({ n: 1 }), { n: 1 });
    assert.equal(schema.safeParse!({ n: 'nope' }).success, false);
    assert.deepEqual(schema.toJsonSchema!(), {
      type: 'object',
      properties: { n: { type: 'number' } },
      required: ['n'],
    });
  });

  test(`${label}: unrepresentable constructs degrade to null, not a throw`, () => {
    // No GBNF for these yet — the contract is a graceful null so callers fall
    // back to prompt-only JSON mode.
    assert.equal(zodToJsonSchema(z.record(z.string(), z.string())), null);
    assert.equal(zodToJsonSchema(z.tuple([z.string(), z.number()])), null);
  });
}
