import assert from 'node:assert/strict';
import { test } from '../_harness';
import { createMachine, streamText } from '../../src/index';
import { createMockRuntime } from './_mockRuntime';

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
