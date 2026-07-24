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

test('tool loop still locks the envelope when a tool is missing toJsonSchema', async () => {
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

  // No toJsonSchema on `parameters`. This used to drop the grammar for the
  // WHOLE loop — outer envelope included — leaving a small local model to
  // free-form its way through a ReAct loop. Only the args should degrade.
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
    assert.ok(g, 'grammar must still be emitted without toJsonSchema');
    assert.match(g!, /"\\"answer\\""/, 'answer branch stays constrained');
    assert.match(g!, /"\\"plain\\""/, 'tool name stays constrained');
    assert.match(g!, /anyObject/, "the unschema'd tool's args degrade to any object");
  }

  await machine.close();
});

test('tool loop keeps a schema-specific grammar for the tools that have one', async () => {
  const capturedGrammars: Array<string | undefined> = [];
  const runtime = createMockRuntime({
    completeChatText: async () => '{"answer":"done"}',
    onCompletionOptions: (opts) => {
      capturedGrammars.push(opts.grammar);
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  // One tool self-describes, one doesn't. The described one must keep its
  // real args grammar rather than being dragged down to `anyObject`.
  const describedSchema: SchemaLike<{ city: string }> = {
    ...passthroughSchema<{ city: string }>(),
    toJsonSchema: () => ({
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    }),
  };

  await generateText({
    model,
    prompt: 'go',
    tools: {
      weather: tool({
        description: 'weather',
        parameters: describedSchema,
        execute: async () => ({ ok: true }),
      }),
      plain: tool({
        description: 'plain',
        parameters: passthroughSchema<{ q: string }>(),
        execute: async () => ({ ok: true }),
      }),
    },
    maxSteps: 1,
  });

  const grammar = capturedGrammars[0];
  assert.ok(grammar);
  assert.match(grammar!, /"\\"city\\""/, 'described tool keeps its own args grammar');
  assert.match(grammar!, /"\\"weather\\""/);
  assert.match(grammar!, /"\\"plain\\""/);

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

test('toolChoice: none skips the tool loop entirely', async () => {
  let completeCalls = 0;
  let chatCalls = 0;
  const capturedGrammars: Array<string | undefined> = [];
  const runtime = createMockRuntime({
    completeText: async () => {
      completeCalls += 1;
      return 'plain answer';
    },
    completeChatText: async () => {
      chatCalls += 1;
      return '{"answer":"nope"}';
    },
    onCompletionOptions: (opts) => {
      capturedGrammars.push(opts.grammar);
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const result = await generateText({
    model,
    prompt: 'go',
    toolChoice: 'none',
    tools: {
      plain: tool({
        description: 'plain',
        parameters: passthroughSchema<{ q: string }>(),
        execute: async () => ({ ok: true }),
      }),
    },
  });

  assert.equal(result.text, 'plain answer');
  assert.equal(completeCalls, 1, 'should take the plain completion path');
  assert.equal(chatCalls, 0, 'should never enter the tool loop');
  assert.deepEqual(capturedGrammars, [undefined], 'no tool grammar when tools are off');

  await machine.close();
});

test('toolChoice: { toolName } forces that tool on the first step only', async () => {
  const scripted = [
    '{"tool":"lookup","args":{"query":"x"}}',
    '{"answer":"done"}',
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

  await generateText({
    model,
    prompt: 'go',
    toolChoice: { toolName: 'lookup' },
    maxSteps: 3,
    tools: {
      lookup: tool({
        description: 'lookup',
        parameters: passthroughSchema<{ query: string }>(),
        execute: async () => ({ ok: true }),
      }),
      other: tool({
        description: 'other',
        parameters: passthroughSchema<{ q: string }>(),
        execute: async () => ({ ok: true }),
      }),
    },
  });

  assert.ok(capturedGrammars.length >= 2, 'loop should run more than one step');

  const first = capturedGrammars[0]!;
  assert.match(first, /"\\"lookup\\""/, 'forced tool is available on step 0');
  assert.doesNotMatch(first, /"\\"answer\\""/, 'no escape hatch on the forced step');
  assert.doesNotMatch(
    first,
    /"\\"other\\""/,
    'other tools are excluded on the forced step',
  );

  // Without this the loop could never terminate — it would be forced to call
  // the same tool forever.
  const second = capturedGrammars[1]!;
  assert.match(second, /"\\"answer\\""/, 'later steps regain the answer branch');
  assert.match(second, /"\\"other\\""/, 'later steps regain the other tools');

  await machine.close();
});

test('toolChoice naming a tool that was not passed fails loudly', async () => {
  const runtime = createMockRuntime({
    completeChatText: async () => '{"answer":"done"}',
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  await assert.rejects(
    () =>
      generateText({
        model,
        prompt: 'go',
        toolChoice: { toolName: 'typo' },
        tools: {
          lookup: tool({
            description: 'lookup',
            parameters: passthroughSchema<{ query: string }>(),
            execute: async () => ({ ok: true }),
          }),
        },
      }),
    /toolChoice named "typo".*Available: lookup/s,
  );

  await machine.close();
});

test('tool loop sends the caller system prompt once, not twice', async () => {
  const capturedSystemPrompts: Array<string | undefined> = [];
  let capturedMessages: unknown[] = [];
  const runtime = createMockRuntime({
    completeChatText: async (messages, opts) => {
      capturedMessages = messages;
      capturedSystemPrompts.push(opts.systemPrompt);
      return '{"answer":"done"}';
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  await generateText({
    model,
    prompt: 'go',
    system: 'BE-TERSE-MARKER',
    tools: {
      lookup: tool({
        description: 'lookup',
        parameters: passthroughSchema<{ query: string }>(),
        execute: async () => ({ ok: true }),
      }),
    },
  });

  // It belongs in messages[0] (baked into the tool preamble) and nowhere else.
  // Adapters used to have to de-duplicate this themselves.
  assert.deepEqual(capturedSystemPrompts, [undefined]);
  const first = capturedMessages[0] as { role: string; content: string };
  assert.equal(first.role, 'system');
  assert.match(first.content, /BE-TERSE-MARKER/);

  await machine.close();
});
