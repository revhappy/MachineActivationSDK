import assert from 'node:assert/strict';
import { test } from '../_harness';
import { createMachine, generateText, tool } from '../../src/index';
import type { SchemaLike } from '../../src/index';
import { createMockRuntime } from './_mockRuntime';

function passthroughSchema<T>(): SchemaLike<T> {
  return {
    parse(value: unknown): T {
      return value as T;
    },
    safeParse(value: unknown) {
      return { success: true as const, data: value as T };
    },
  };
}

test('tool helper returns the definition unchanged', () => {
  const echoTool = tool({
    description: 'Echo back the input',
    parameters: passthroughSchema<{ text: string }>(),
    execute: async ({ text }) => ({ echoed: text }),
  });

  assert.equal(echoTool.description, 'Echo back the input');
  assert.equal(typeof echoTool.execute, 'function');
});

test('generateText ReAct loop calls a tool and terminates on answer', async () => {
  const scripted = [
    '{"tool":"lookup","args":{"query":"apples"}}',
    '{"answer":"Apples are red fruits."}',
  ];
  let callIndex = 0;
  const runtime = createMockRuntime({
    completeChatText: async () => {
      const next = scripted[Math.min(callIndex, scripted.length - 1)];
      callIndex += 1;
      return next;
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const lookupTool = tool({
    description: 'Look up a topic',
    parameters: passthroughSchema<{ query: string }>(),
    execute: async ({ query }) => ({ found: `results for ${query}` }),
  });

  const result = await generateText({
    model,
    prompt: 'What are apples?',
    tools: { lookup: lookupTool },
    maxSteps: 4,
  });

  assert.equal(result.text, 'Apples are red fruits.');
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].toolCalls[0].toolName, 'lookup');
  assert.equal(result.finishReason, 'stop');
  assert.equal(callIndex, 2);

  await machine.close();
});

test('generateText ReAct loop stops at maxSteps when tool loop runs forever', async () => {
  const runtime = createMockRuntime({
    completeChatText: async () => '{"tool":"noop","args":{}}',
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const noopTool = tool({
    description: 'Does nothing',
    parameters: passthroughSchema<Record<string, never>>(),
    execute: async () => ({ ok: true }),
  });

  const result = await generateText({
    model,
    prompt: 'loop forever',
    tools: { noop: noopTool },
    maxSteps: 3,
  });

  assert.equal(result.steps.length, 3);
  assert.equal(result.finishReason, 'length');

  await machine.close();
});

test('generateText tool loop emits a union GBNF when all tools expose toJsonSchema', async () => {
  const scripted = [
    '{"tool":"lookup","args":{"query":"apples"}}',
    '{"answer":"Apples are red."}',
  ];
  let i = 0;
  const capturedGrammars: Array<string | undefined> = [];
  const runtime = createMockRuntime({
    completeChatText: async () => scripted[Math.min(i++, scripted.length - 1)],
    onCompletionOptions: (opts) => {
      capturedGrammars.push(opts.grammar);
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const lookupSchema: SchemaLike<{ query: string }> = {
    ...passthroughSchema<{ query: string }>(),
    toJsonSchema: () => ({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    }),
  };
  const lookupTool = tool({
    description: 'Look up a topic',
    parameters: lookupSchema,
    execute: async ({ query }: { query: string }) => ({ found: `results: ${query}` }),
  });

  await generateText({
    model,
    prompt: 'What are apples?',
    tools: { lookup: lookupTool },
    maxSteps: 3,
  });

  assert.ok(capturedGrammars.length >= 2, 'completion must have been invoked');
  for (const g of capturedGrammars) {
    assert.ok(g, 'every completion call in the tool loop should receive the grammar');
    assert.match(g!, /"\\"answer\\""/); // branch for final answer
    assert.match(g!, /"\\"tool\\""/); // discriminator field
    assert.match(g!, /"\\"lookup\\""/); // tool const value (in its own rule)
    assert.match(g!, /"\\"query\\""/); // arg schema
  }

  await machine.close();
});

test('generateText tool loop keeps prompt-only path when a tool is missing toJsonSchema', async () => {
  const scripted = ['{"answer":"done"}'];
  let i = 0;
  const capturedGrammars: Array<string | undefined> = [];
  const runtime = createMockRuntime({
    completeChatText: async () => scripted[Math.min(i++, scripted.length - 1)],
    onCompletionOptions: (opts) => {
      capturedGrammars.push(opts.grammar);
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  // No toJsonSchema on parameters — the tool loop should NOT emit a grammar.
  const plainTool = tool({
    description: 'plain',
    parameters: passthroughSchema<{ q: string }>(),
    execute: async () => ({ ok: true }),
  });

  await generateText({
    model,
    prompt: 'go',
    tools: { plain: plainTool },
    maxSteps: 2,
  });

  assert.ok(capturedGrammars.length > 0);
  for (const g of capturedGrammars) {
    assert.equal(g, undefined, 'grammar should stay undefined without toJsonSchema');
  }

  await machine.close();
});

test('onStepFinish is invoked per step', async () => {
  const scripted = [
    '{"tool":"x","args":{}}',
    '{"answer":"done"}',
  ];
  let i = 0;
  const runtime = createMockRuntime({
    completeChatText: async () => scripted[i++] ?? scripted[scripted.length - 1],
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const xTool = tool({
    description: 'x',
    parameters: passthroughSchema<Record<string, never>>(),
    execute: async () => ({}),
  });

  const seen: number[] = [];
  await generateText({
    model,
    prompt: 'go',
    tools: { x: xTool },
    onStepFinish: (step) => {
      seen.push(step.stepIndex);
    },
  });

  assert.deepEqual(seen, [0, 1]);

  await machine.close();
});
