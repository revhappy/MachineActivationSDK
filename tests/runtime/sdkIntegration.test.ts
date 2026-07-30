import { strict as assert } from 'node:assert';

import { createMachine, generateObject, generateText, streamText, tool } from '../../src/index';
import type { JsonSchema, SchemaLike } from '../../src/index';

import { llamaServerRuntime } from '../../src/runtime/llamaServerRuntime';
import { stubRuntime } from '../../src/runtime/stubRuntime';
import { test } from '../_harness';
import { createFakeServer } from './_fakeServer';

// These tests drive the adapter through the *real* SDK entry points rather than
// calling the session directly. That is the check that matters: three shipped
// adapters carried a broken `complete`/`completeChat` signature for months
// because nothing ever asked the SDK to call them.

const BASE = 'http://127.0.0.1:9999';

function jsonSchemaOf<T>(schema: JsonSchema, parse: (value: unknown) => T): SchemaLike<T> {
  return { parse, toJsonSchema: () => schema };
}

test('createMachine + generateText runs through the llama adapter', async () => {
  const server = createFakeServer({ deltas: ['Bon', 'jour'] });
  const machine = createMachine({
    runtimes: [llamaServerRuntime({ baseUrl: BASE, fetchImpl: server.fetchImpl })],
    compatibilityPolicy: 'permissive',
  });
  const model = machine.model({ filePath: '/models/m.gguf', modelId: 'local' });

  const result = await generateText({ model, prompt: 'say hello in French' });

  assert.equal(result.text, 'Bonjour');
  assert.equal(server.completions.length, 1);
});

test('streamText delivers deltas through the llama adapter', async () => {
  const server = createFakeServer({ deltas: ['a', 'b', 'c'] });
  const machine = createMachine({
    runtimes: [llamaServerRuntime({ baseUrl: BASE, fetchImpl: server.fetchImpl })],
    compatibilityPolicy: 'permissive',
  });
  const model = machine.model({ filePath: '/models/m.gguf' });

  // streamText exposes an async-iterable `textStream`; the adapter's `onChunk`
  // is what feeds it. Iterating here proves the whole path, deltas included.
  const result = streamText({ model, prompt: 'count' });

  const seen: string[] = [];
  for await (const delta of result.textStream) seen.push(delta);

  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(await result.text, 'abc');
});

test('generateObject emits a grammar and parses the result', async () => {
  const server = createFakeServer({ deltas: ['{"language":"French",', '"confidence":0.95}'] });
  const machine = createMachine({
    runtimes: [llamaServerRuntime({ baseUrl: BASE, fetchImpl: server.fetchImpl })],
    compatibilityPolicy: 'permissive',
  });
  const model = machine.model({ filePath: '/models/m.gguf' });

  const schema = jsonSchemaOf<{ language: string; confidence: number }>(
    {
      type: 'object',
      properties: { language: { type: 'string' }, confidence: { type: 'number' } },
      required: ['language', 'confidence'],
    },
    (value) => value as { language: string; confidence: number },
  );

  const result = await generateObject({ model, schema, prompt: 'detect the language of "bonjour"' });

  assert.equal(result.object.language, 'French');
  // The grammar must reach the wire, or structured output degrades to the
  // prompt-only retry path without anyone noticing.
  const grammar = server.completions[0].body.grammar;
  assert.equal(typeof grammar, 'string');
  assert.ok(String(grammar).includes('root'));
});

test('the tool loop completes over the llama adapter', async () => {
  // First turn: the model asks for the tool. Second turn: it answers.
  const server = createFakeServer({
    script: [
      ['{"tool":"weather","args":{"city":"Paris"}}'],
      ['{"answer":"It is 18C in Paris."}'],
    ],
  });

  const machine = createMachine({
    runtimes: [llamaServerRuntime({ baseUrl: BASE, fetchImpl: server.fetchImpl })],
    compatibilityPolicy: 'permissive',
  });
  const model = machine.model({ filePath: '/models/m.gguf' });

  const weather = tool({
    description: 'Look up the current weather for a city.',
    parameters: jsonSchemaOf<{ city: string }>(
      { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      (value) => value as { city: string },
    ),
    execute: ({ city }) => ({ tempC: 18, city }),
  });

  const result = await generateText({
    model,
    prompt: 'What is the weather in Paris?',
    tools: { weather },
    maxSteps: 3,
  });

  assert.equal(result.text, 'It is 18C in Paris.');
  assert.equal(server.completions.length, 2, 'expected one tool step and one answer step');

  // The second request must carry the tool result forward.
  const second = server.completions[1].body.messages as Array<{ role: string; content: string }>;
  assert.ok(
    second.some((m) => m.content.includes('tempC') || m.content.includes('18')),
    'the tool result was not forwarded to the model',
  );
});

test('the stub runtime satisfies the SDK end to end', async () => {
  const machine = createMachine({
    runtimes: [stubRuntime({ respond: () => 'canned answer' })],
    compatibilityPolicy: 'permissive',
  });
  const model = machine.model({ filePath: 'stub' });

  const result = await generateText({ model, prompt: 'anything' });
  assert.equal(result.text, 'canned answer');
});

test('the stub runtime can drive generateObject for pipeline tests', async () => {
  const machine = createMachine({
    runtimes: [stubRuntime({ respond: () => '{"title":"Note","tags":["a"]}' })],
    compatibilityPolicy: 'permissive',
  });
  const model = machine.model({ filePath: 'stub' });

  const schema = jsonSchemaOf<{ title: string; tags: string[] }>(
    {
      type: 'object',
      properties: { title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['title', 'tags'],
    },
    (value) => value as { title: string; tags: string[] },
  );

  const result = await generateObject({ model, schema, prompt: 'extract' });
  assert.equal(result.object.title, 'Note');
  assert.deepEqual(result.object.tags, ['a']);
});
