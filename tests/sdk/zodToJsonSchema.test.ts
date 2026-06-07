import assert from 'node:assert/strict';
import { test } from '../_harness';
import { zodToJsonSchema } from '../../src/sdk/zodToJsonSchema';
import { zodSchema } from '../../src/sdk/zodSchema';

// The tests use hand-built objects that mimic zod v3's `_def` shape.
// We never import zod itself — the walker is duck-typed.

function mockZod(def: Record<string, unknown>): { _def: Record<string, unknown> } {
  return { _def: def };
}

test('zodToJsonSchema maps ZodString to { type: string }', () => {
  const result = zodToJsonSchema(mockZod({ typeName: 'ZodString' }));
  assert.deepEqual(result, { type: 'string' });
});

test('zodToJsonSchema maps ZodNumber to { type: number }', () => {
  const result = zodToJsonSchema(mockZod({ typeName: 'ZodNumber' }));
  assert.deepEqual(result, { type: 'number' });
});

test('zodToJsonSchema detects z.number().int() via checks', () => {
  const result = zodToJsonSchema(
    mockZod({ typeName: 'ZodNumber', checks: [{ kind: 'int' }] }),
  );
  assert.deepEqual(result, { type: 'integer' });
});

test('zodToJsonSchema maps ZodBoolean and ZodNull', () => {
  assert.deepEqual(zodToJsonSchema(mockZod({ typeName: 'ZodBoolean' })), {
    type: 'boolean',
  });
  assert.deepEqual(zodToJsonSchema(mockZod({ typeName: 'ZodNull' })), {
    type: 'null',
  });
});

test('zodToJsonSchema maps ZodLiteral to const', () => {
  assert.deepEqual(
    zodToJsonSchema(mockZod({ typeName: 'ZodLiteral', value: 'hello' })),
    { const: 'hello' },
  );
  assert.deepEqual(
    zodToJsonSchema(mockZod({ typeName: 'ZodLiteral', value: 42 })),
    { const: 42 },
  );
});

test('zodToJsonSchema maps ZodEnum values into enum', () => {
  const result = zodToJsonSchema(
    mockZod({ typeName: 'ZodEnum', values: ['pos', 'neg', 'neu'] }),
  );
  assert.deepEqual(result, { enum: ['pos', 'neg', 'neu'] });
});

test('zodToJsonSchema maps ZodNativeEnum object values, dedupes', () => {
  const result = zodToJsonSchema(
    mockZod({
      typeName: 'ZodNativeEnum',
      values: { A: 'a', B: 'b', ALIAS: 'a' },
    }),
  );
  assert.deepEqual(result, { enum: ['a', 'b'] });
});

test('zodToJsonSchema maps ZodArray with item walk', () => {
  const result = zodToJsonSchema(
    mockZod({
      typeName: 'ZodArray',
      type: mockZod({ typeName: 'ZodString' }),
    }),
  );
  assert.deepEqual(result, { type: 'array', items: { type: 'string' } });
});

test('zodToJsonSchema maps ZodObject with required fields', () => {
  const result = zodToJsonSchema(
    mockZod({
      typeName: 'ZodObject',
      shape: () => ({
        name: mockZod({ typeName: 'ZodString' }),
        age: mockZod({ typeName: 'ZodNumber' }),
      }),
    }),
  );
  assert.deepEqual(result, {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'number' },
    },
    required: ['name', 'age'],
  });
});

test('zodToJsonSchema unwraps ZodOptional and omits from required', () => {
  const result = zodToJsonSchema(
    mockZod({
      typeName: 'ZodObject',
      shape: () => ({
        name: mockZod({ typeName: 'ZodString' }),
        nickname: mockZod({
          typeName: 'ZodOptional',
          innerType: mockZod({ typeName: 'ZodString' }),
        }),
      }),
    }),
  );
  assert.deepEqual(result, {
    type: 'object',
    properties: {
      name: { type: 'string' },
      nickname: { type: 'string' },
    },
    required: ['name'],
  });
});

test('zodToJsonSchema treats ZodDefault as optional-with-default', () => {
  const result = zodToJsonSchema(
    mockZod({
      typeName: 'ZodObject',
      shape: () => ({
        count: mockZod({
          typeName: 'ZodDefault',
          innerType: mockZod({ typeName: 'ZodNumber' }),
          defaultValue: () => 0,
        }),
      }),
    }),
  );
  assert.deepEqual(result, {
    type: 'object',
    properties: { count: { type: 'number' } },
  });
});

test('zodToJsonSchema maps ZodNullable as anyOf with null', () => {
  const result = zodToJsonSchema(
    mockZod({
      typeName: 'ZodNullable',
      innerType: mockZod({ typeName: 'ZodString' }),
    }),
  );
  assert.deepEqual(result, {
    anyOf: [{ type: 'string' }, { type: 'null' }],
  });
});

test('zodToJsonSchema maps ZodUnion to anyOf', () => {
  const result = zodToJsonSchema(
    mockZod({
      typeName: 'ZodUnion',
      options: [
        mockZod({ typeName: 'ZodString' }),
        mockZod({ typeName: 'ZodNumber' }),
      ],
    }),
  );
  assert.deepEqual(result, {
    anyOf: [{ type: 'string' }, { type: 'number' }],
  });
});

test('zodToJsonSchema returns null for unknown zod node types', () => {
  const result = zodToJsonSchema(mockZod({ typeName: 'ZodTransformer' }));
  assert.equal(result, null);
});

test('zodToJsonSchema returns null for non-zod inputs', () => {
  assert.equal(zodToJsonSchema(null), null);
  assert.equal(zodToJsonSchema({}), null);
  assert.equal(zodToJsonSchema({ _def: {} }), null);
});

test('zodSchema wraps a zod-shaped schema with toJsonSchema attached', () => {
  const fakeZod = {
    _def: { typeName: 'ZodString' },
    parse: (value: unknown) => {
      if (typeof value !== 'string') throw new Error('bad');
      return value;
    },
    safeParse: (value: unknown) => {
      if (typeof value === 'string') {
        return { success: true as const, data: value };
      }
      return { success: false as const, error: new Error('bad') };
    },
  };
  const schema = zodSchema(fakeZod);
  assert.equal(typeof schema.toJsonSchema, 'function');
  const json = schema.toJsonSchema?.();
  assert.deepEqual(json, { type: 'string' });
  assert.equal(schema.parse('hi'), 'hi');
  const sp = schema.safeParse?.(123);
  assert.equal(sp?.success, false);
});
