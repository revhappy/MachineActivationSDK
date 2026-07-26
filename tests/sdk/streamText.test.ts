import assert from 'node:assert/strict';
import { test } from '../_harness';
import { createMachine, generateText, streamText, tool } from '../../src/index';
import { createMockRuntime } from './_mockRuntime';

/**
 * A runtime that replays a fixed script of model turns, one per step.
 *
 * The mock splits every turn into 4-character deltas, so an envelope always
 * arrives across chunk boundaries — which is the case that matters.
 */
function scriptedRuntime(turns: string[], onStep?: (index: number) => void) {
  let index = 0;
  return createMockRuntime({
    completeChatText: async () => {
      onStep?.(index);
      return turns[Math.min(index++, turns.length - 1)];
    },
  });
}

const weather = tool({
  description: 'Look up the weather in a city.',
  parameters: {
    parse: (value: unknown) => value as { city: string },
    toJsonSchema: () => ({
      type: 'object' as const,
      properties: { city: { type: 'string' as const } },
      required: ['city'],
    }),
  },
  execute: async ({ city }: { city: string }) => ({ city, sky: 'sunny' }),
});

test('streamText yields deltas in order and resolves final text', async () => {
  const runtime = createMockRuntime({
    completeText: async () => 'hello world',
    streamChunks: ['hel', 'lo ', 'wor', 'ld'],
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const stream = streamText({ model, prompt: 'greet' });

  const received: string[] = [];
  for await (const delta of stream.textStream) {
    received.push(delta);
  }

  assert.deepEqual(received, ['hel', 'lo ', 'wor', 'ld']);
  assert.equal(await stream.text, 'hello world');
  assert.equal(await stream.finishReason, 'stop');

  const usage = await stream.usage;
  assert.equal(usage.tokensPerSecond, 42);

  await machine.close();
});

test('streamText propagates errors through the iterator', async () => {
  const runtime = createMockRuntime({
    completeText: async () => {
      throw new Error('boom');
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const stream = streamText({ model, prompt: 'x' });

  await assert.rejects(
    (async () => {
      for await (const _ of stream.textStream) {
        // drain
      }
    })(),
    /boom/,
  );

  await machine.close();
});

test('streamText runs a tool loop and streams only the final answer', async () => {
  const runtime = scriptedRuntime([
    '{"tool":"weather","args":{"city":"Paris"}}',
    '{"answer":"It is sunny in Paris."}',
  ]);
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const stream = streamText({ model, prompt: 'weather in Paris?', tools: { weather } });

  const received: string[] = [];
  for await (const delta of stream.textStream) {
    received.push(delta);
  }

  // Nothing from the tool step reached the consumer, and the answer was
  // decoded out of its envelope rather than forwarded raw.
  assert.equal(received.join(''), 'It is sunny in Paris.');
  assert.ok(received.length > 1, 'the answer should arrive in pieces, not one blob');
  assert.equal(await stream.text, 'It is sunny in Paris.');
  assert.equal(await stream.finishReason, 'stop');

  const calls = await stream.toolCalls;
  assert.deepEqual(calls, [{ toolName: 'weather', args: { city: 'Paris' } }]);

  const steps = await stream.steps;
  assert.equal(steps.length, 2);
  assert.equal(steps[0].finishReason, 'tool-calls');
  assert.deepEqual(steps[0].toolResults, [
    { toolName: 'weather', result: { city: 'Paris', sky: 'sunny' } },
  ]);
  assert.equal(steps[1].finishReason, 'stop');

  await machine.close();
});

test('streamText and generateText agree on the same tool script', async () => {
  const script = [
    '{"tool":"weather","args":{"city":"Oslo"}}',
    '{"answer":"Cold in Oslo."}',
  ];
  const machineA = createMachine({ runtimes: scriptedRuntime(script) });
  const machineB = createMachine({ runtimes: scriptedRuntime(script) });

  const streamed = streamText({
    model: machineA.model({ filePath: '/models/mock.gguf' }),
    prompt: 'oslo?',
    tools: { weather },
  });
  for await (const _ of streamed.textStream) {
    // drain
  }
  const generated = await generateText({
    model: machineB.model({ filePath: '/models/mock.gguf' }),
    prompt: 'oslo?',
    tools: { weather },
  });

  assert.equal(await streamed.text, generated.text);
  assert.equal(await streamed.finishReason, generated.finishReason);
  assert.deepEqual(
    (await streamed.steps).map((step) => step.finishReason),
    generated.steps.map((step) => step.finishReason),
  );
  assert.deepEqual(await streamed.toolCalls, [{ toolName: 'weather', args: { city: 'Oslo' } }]);

  await machineA.close();
  await machineB.close();
});

test('streamText reports onStepFinish for every tool-loop step', async () => {
  const runtime = scriptedRuntime([
    '{"tool":"weather","args":{"city":"Lima"}}',
    '{"answer":"Mild."}',
  ]);
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const seen: number[] = [];
  const stream = streamText({
    model,
    prompt: 'lima?',
    tools: { weather },
    onStepFinish: (step) => {
      seen.push(step.stepIndex);
    },
  });
  for await (const _ of stream.textStream) {
    // drain
  }
  await stream.text;

  assert.deepEqual(seen, [0, 1]);

  await machine.close();
});

test('streamText stops at maxSteps when the model never answers', async () => {
  const runtime = scriptedRuntime(['{"tool":"weather","args":{"city":"Lima"}}']);
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const stream = streamText({
    model,
    prompt: 'loop',
    tools: { weather },
    maxSteps: 3,
  });
  const received: string[] = [];
  for await (const delta of stream.textStream) {
    received.push(delta);
  }

  assert.deepEqual(received, [], 'a loop that never answers shows the user nothing');
  assert.equal((await stream.steps).length, 3);
  assert.equal(await stream.finishReason, 'length');

  await machine.close();
});

test('streamText with toolChoice none skips the loop and streams plainly', async () => {
  const runtime = createMockRuntime({
    completeText: async () => 'no tools here',
    streamChunks: ['no ', 'tools ', 'here'],
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const stream = streamText({
    model,
    prompt: 'x',
    tools: { weather },
    toolChoice: 'none',
  });
  const received: string[] = [];
  for await (const delta of stream.textStream) {
    received.push(delta);
  }

  assert.deepEqual(received, ['no ', 'tools ', 'here']);
  assert.deepEqual(await stream.toolCalls, []);

  await machine.close();
});

test('streamText constrains tool-loop steps with the envelope grammar', async () => {
  const grammars: Array<string | undefined> = [];
  const runtime = createMockRuntime({
    completeChatText: async () => '{"answer":"done"}',
    onCompletionOptions: (options) => {
      grammars.push(options.grammar);
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const stream = streamText({ model, prompt: 'x', tools: { weather } });
  for await (const _ of stream.textStream) {
    // drain
  }
  await stream.text;

  assert.equal(grammars.length, 1);
  assert.ok(grammars[0], 'the streaming loop must still be grammar-constrained');
  assert.match(grammars[0]!, /answer/);

  await machine.close();
});

test('streamText with empty response closes iterator without yields', async () => {
  const runtime = createMockRuntime({
    completeText: async () => '',
    streamChunks: [],
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const stream = streamText({ model, prompt: 'x' });
  const received: string[] = [];
  for await (const delta of stream.textStream) {
    received.push(delta);
  }

  assert.deepEqual(received, []);
  assert.equal(await stream.text, '');

  await machine.close();
});
