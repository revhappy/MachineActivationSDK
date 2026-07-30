import assert from 'node:assert/strict';
import { test } from '../_harness';
import {
  createMachine,
  generateObject,
  generateText,
  streamText,
  tool,
} from '../../src/index';
import type { SchemaLike } from '../../src/index';
import { createMockRuntime } from './_mockRuntime';

function passthroughSchema<T>(): SchemaLike<T> {
  return {
    parse: (value: unknown) => value as T,
    safeParse: (value: unknown) => ({ success: true as const, data: value as T }),
  };
}

test('generateText forwards abortSignal to the runtime adapter', async () => {
  let seenSignal: AbortSignal | undefined;
  const runtime = createMockRuntime({
    completeText: async () => 'ok',
    onCompletionOptions: (opts) => {
      seenSignal = opts.abortSignal;
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });
  const controller = new AbortController();

  await generateText({ model, prompt: 'hi', abortSignal: controller.signal });

  // Adapters that can cancel natively (fetch-backed llama-server, web-llm)
  // need the signal itself, not just a later session.abort() call.
  assert.equal(seenSignal, controller.signal);

  await machine.close();
});

test('generateText rejects immediately when the signal is already aborted', async () => {
  let completions = 0;
  const runtime = createMockRuntime({
    completeText: async () => {
      completions += 1;
      return 'ok';
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => generateText({ model, prompt: 'hi', abortSignal: controller.signal }),
    (error: Error) => error.name === 'AbortError',
  );
  assert.equal(completions, 0, 'should not have reached the runtime at all');

  await machine.close();
});

test('generateText calls session.abort() when the signal fires mid-flight', async () => {
  let aborts = 0;
  const controller = new AbortController();
  const runtime = createMockRuntime({
    onAbort: () => {
      aborts += 1;
    },
    completeText: async () => {
      // Fire while the completion is in flight, the way a user tapping
      // "stop" would.
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'partial';
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  await assert.rejects(
    () => generateText({ model, prompt: 'hi', abortSignal: controller.signal }),
    (error: Error) => error.name === 'AbortError',
  );
  assert.equal(aborts, 1, 'runtime cancellation should have been invoked');

  await machine.close();
});

test('a cancelled multi-step tool loop stops instead of running to maxSteps', async () => {
  const controller = new AbortController();
  let chatCalls = 0;
  let toolExecutions = 0;

  const runtime = createMockRuntime({
    completeChatText: async () => {
      chatCalls += 1;
      return '{"tool":"noop","args":{}}';
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  // This is the case that mattered: an on-device agent loop the user wants to
  // stop. Before abortSignal was honored, cancelling did nothing and the loop
  // ran all the way to maxSteps.
  await assert.rejects(
    () =>
      generateText({
        model,
        prompt: 'loop',
        maxSteps: 5,
        abortSignal: controller.signal,
        tools: {
          noop: tool({
            description: 'noop',
            parameters: passthroughSchema<Record<string, never>>(),
            execute: async () => {
              toolExecutions += 1;
              controller.abort();
              return { ok: true };
            },
          }),
        },
      }),
    (error: Error) => error.name === 'AbortError',
  );

  assert.equal(toolExecutions, 1);
  assert.equal(chatCalls, 1, 'the loop must not start another step after abort');

  await machine.close();
});

test('generateObject forwards abortSignal and refuses an aborted signal', async () => {
  let seenSignal: AbortSignal | undefined;
  const runtime = createMockRuntime({
    completeText: async () => '{"n":1}',
    onCompletionOptions: (opts) => {
      seenSignal = opts.abortSignal;
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const controller = new AbortController();
  await generateObject({
    model,
    prompt: 'give me a number',
    schema: passthroughSchema<{ n: number }>(),
    abortSignal: controller.signal,
  });
  assert.equal(seenSignal, controller.signal);

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    () =>
      generateObject({
        model,
        prompt: 'give me a number',
        schema: passthroughSchema<{ n: number }>(),
        abortSignal: aborted.signal,
      }),
    (error: Error) => error.name === 'AbortError',
  );

  await machine.close();
});

test('streamText forwards abortSignal to the runtime adapter', async () => {
  let seenSignal: AbortSignal | undefined;
  const runtime = createMockRuntime({
    completeText: async () => 'streamed',
    onCompletionOptions: (opts) => {
      seenSignal = opts.abortSignal;
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });
  const controller = new AbortController();

  const result = streamText({
    model,
    prompt: 'hi',
    abortSignal: controller.signal,
  });
  await result.text;

  assert.equal(seenSignal, controller.signal);

  await machine.close();
});

test('an abort listener does not leak onto the next call on the same session', async () => {
  let aborts = 0;
  const runtime = createMockRuntime({
    completeText: async () => 'ok',
    onAbort: () => {
      aborts += 1;
    },
  });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ filePath: '/models/mock.gguf' });

  const controller = new AbortController();
  await generateText({ model, prompt: 'first', abortSignal: controller.signal });

  // Sessions are reused across calls. Aborting the FIRST call's controller
  // after it settled must not cancel anything — the listener has to have been
  // removed when that call finished.
  controller.abort();
  const second = await generateText({ model, prompt: 'second' });

  assert.equal(second.text, 'ok');
  assert.equal(aborts, 0, 'a settled call must not leave an abort listener behind');

  await machine.close();
});
