import assert from 'node:assert/strict';
import { test } from '../_harness';
import { createMachine, generateObject } from '../../src/index';
import type { SchemaLike } from '../../src/index';
import { createMockRuntime } from './_mockRuntime';

interface Review {
  summary: string;
  sentiment: 'pos' | 'neg' | 'neu';
}

function reviewSchema(): SchemaLike<Review> {
  return {
    parse(value: unknown): Review {
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as Record<string, unknown>).summary === 'string' &&
        ['pos', 'neg', 'neu'].includes(
          String((value as Record<string, unknown>).sentiment),
        )
      ) {
        return value as Review;
      }
      throw new Error('Invalid review shape.');
    },
    safeParse(value: unknown) {
      try {
        const data = this.parse(value);
        return { success: true as const, data };
      } catch (error) {
        return { success: false as const, error };
      }
    },
  };
}

test('generateObject parses valid JSON into the schema type', async () => {
  const runtime = createMockRuntime({
    completeText: async () =>
      '{"summary":"great product","sentiment":"pos"}',
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const { object, raw } = await generateObject({
    model,
    schema: reviewSchema(),
    prompt: 'Analyze: I loved it.',
  });

  assert.equal(object.summary, 'great product');
  assert.equal(object.sentiment, 'pos');
  assert.ok(raw.includes('great product'));

  await machine.close();
});

test('generateObject retries once when first response is not valid JSON', async () => {
  let calls = 0;
  const runtime = createMockRuntime({
    completeText: async () => {
      calls += 1;
      if (calls === 1) return 'sorry, I cannot comply';
      return '{"summary":"good","sentiment":"pos"}';
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const { object } = await generateObject({
    model,
    schema: reviewSchema(),
    prompt: 'review please',
  });

  assert.equal(calls, 2);
  assert.equal(object.sentiment, 'pos');

  await machine.close();
});

test('generateObject extracts JSON from fenced markdown blocks', async () => {
  const runtime = createMockRuntime({
    completeText: async () =>
      'here you go:\n```json\n{"summary":"ok","sentiment":"neu"}\n```\n',
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const { object } = await generateObject({
    model,
    schema: reviewSchema(),
    prompt: 'review',
  });

  assert.equal(object.sentiment, 'neu');

  await machine.close();
});

test('generateObject emits a schema-specific GBNF when schema.toJsonSchema is available', async () => {
  let capturedGrammar: string | undefined;
  const runtime = createMockRuntime({
    completeText: async () => '{"summary":"ok","sentiment":"pos"}',
    onCompletionOptions: (opts) => {
      capturedGrammar = opts.grammar;
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const schemaWithJson: SchemaLike<Review> = {
    ...reviewSchema(),
    toJsonSchema: () => ({
      type: 'object',
      properties: {
        summary: { type: 'string' },
        sentiment: { enum: ['pos', 'neg', 'neu'] },
      },
      required: ['summary', 'sentiment'],
    }),
  };

  const { object } = await generateObject({
    model,
    schema: schemaWithJson,
    prompt: 'Analyze: ok',
  });

  assert.equal(object.sentiment, 'pos');
  assert.ok(capturedGrammar, 'grammar should have been passed to the session');
  assert.match(capturedGrammar!, /"\\"summary\\"" ws ":" ws string/);
  assert.match(capturedGrammar!, /"\\"pos\\"" \| "\\"neg\\"" \| "\\"neu\\""/);

  await machine.close();
});

test('generateObject skips grammar when toJsonSchema returns null (fallback to retry)', async () => {
  let capturedGrammar: string | undefined;
  let calls = 0;
  const runtime = createMockRuntime({
    completeText: async () => {
      calls += 1;
      if (calls === 1) return 'oops not json';
      return '{"summary":"ok","sentiment":"neu"}';
    },
    onCompletionOptions: (opts) => {
      capturedGrammar = opts.grammar;
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const schemaWithNullJson: SchemaLike<Review> = {
    ...reviewSchema(),
    toJsonSchema: () => null,
  };

  const { object } = await generateObject({
    model,
    schema: schemaWithNullJson,
    prompt: 'review',
  });

  assert.equal(object.sentiment, 'neu');
  assert.equal(capturedGrammar, undefined);
  assert.equal(calls, 2); // retry path still engaged

  await machine.close();
});

test('generateObject throws after max retries exhausted', async () => {
  const runtime = createMockRuntime({
    completeText: async () => 'definitely not json',
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  await assert.rejects(
    () =>
      generateObject({
        model,
        schema: reviewSchema(),
        prompt: 'go',
        maxRetries: 1,
      }),
    /generateObject failed after 2 attempt/,
  );

  await machine.close();
});
