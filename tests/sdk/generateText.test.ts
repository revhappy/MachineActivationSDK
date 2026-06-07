import assert from 'node:assert/strict';
import { test } from '../_harness';
import { createMachine, generateText } from '../../src/index';
import { createMockRuntime } from './_mockRuntime';

test('generateText returns text and usage for a simple prompt', async () => {
  const runtime = createMockRuntime({
    completeText: async (prompt) => `echo: ${prompt}`,
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const result = await generateText({
    model,
    prompt: 'hello',
    system: 'be brief',
    maxTokens: 50,
  });

  assert.equal(result.text, 'echo: hello');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage.tokensPerSecond, 42);
  assert.ok(result.usage.completionTokens > 0);
  assert.equal(result.steps.length, 1);
  assert.equal(result.diagnostics.backendId, 'mock-runtime');

  await machine.close();
});

test('generateText with messages uses completeChat', async () => {
  let capturedMessages: unknown = null;
  const runtime = createMockRuntime({
    completeChatText: async (messages) => {
      capturedMessages = messages;
      return 'chat-ok';
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const result = await generateText({
    model,
    messages: [
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'ping' },
    ],
  });

  assert.equal(result.text, 'chat-ok');
  assert.ok(Array.isArray(capturedMessages));
  assert.equal((capturedMessages as unknown[]).length, 2);

  await machine.close();
});

test('generateText returns finishReason length when maxTokens is hit', async () => {
  const runtime = createMockRuntime({
    completeText: async () => 'abcdefghijklmnop',
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const result = await generateText({
    model,
    prompt: 'x',
    maxTokens: 1,
  });

  assert.equal(result.finishReason, 'length');

  await machine.close();
});

test('generateText throws when neither prompt nor messages is provided', async () => {
  const runtime = createMockRuntime();
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  await assert.rejects(
    () => generateText({ model }),
    /requires either `prompt` or `messages`/,
  );

  await machine.close();
});
