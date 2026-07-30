import { strict as assert } from 'node:assert';

import type { ActivationChatMessage } from '../../src/index';

import { llamaServerRuntime } from '../../src/runtime/llamaServerRuntime';
import { decodeRate } from '../../src/runtime/wire';
import { test } from '../_harness';
import { createFakeServer } from './_fakeServer';

const BASE = 'http://127.0.0.1:9999';

async function session(
  server: ReturnType<typeof createFakeServer>,
  overrides: Partial<Parameters<typeof llamaServerRuntime>[0]> = {},
) {
  const runtime = llamaServerRuntime({
    baseUrl: BASE,
    fetchImpl: server.fetchImpl,
    ...overrides,
  });
  return runtime.createSession({ filePath: '/models/qwen2.5-0.5b-instruct-q4_k_m.gguf' });
}

test('llama runtime streams SSE deltas into text and per-chunk progress', async () => {
  const server = createFakeServer({ deltas: ['Hel', 'lo', ' there'] });
  const s = await session(server);

  const chunks: string[] = [];
  const result = await s.complete('hi', { onChunk: (c) => chunks.push(c.textDelta) });

  assert.equal(result.text, 'Hello there');
  assert.equal(result.tokensGenerated, 3);
  assert.deepEqual(chunks, ['Hel', 'lo', ' there']);
});

test('llama runtime forwards the FULL chat history, not just the last message', async () => {
  // The regression this pins: an adapter that sent only the last message made
  // the SDK's tool loop silently unable to see its own tool results.
  const server = createFakeServer();
  const s = await session(server);

  const history: ActivationChatMessage[] = [
    { role: 'system', content: 'You are a tool user.' },
    { role: 'user', content: 'weather in Paris?' },
    { role: 'assistant', content: '{"tool":"weather","args":{"city":"Paris"}}' },
    { role: 'tool', content: '{"tempC":18}' },
  ];
  await s.completeChat(history);

  const sent = server.completions[0].body.messages as Array<{ role: string; content: string }>;
  assert.equal(sent.length, 4);
  assert.deepEqual(
    sent.map((m) => m.role),
    ['system', 'user', 'assistant', 'user'],
  );
});

test('llama runtime folds the tool role into a user turn', async () => {
  const server = createFakeServer();
  const s = await session(server);

  await s.completeChat([{ role: 'tool', content: '{"tempC":18}' }]);

  const sent = server.completions[0].body.messages as Array<{ role: string; content: string }>;
  assert.equal(sent[0].role, 'user');
  assert.equal(sent[0].content, 'Tool result: {"tempC":18}');
});

test('llama runtime passes GBNF grammar through on the request body', async () => {
  const server = createFakeServer();
  const s = await session(server);

  const grammar = 'root ::= "{" ws "\\"ok\\"" ws ":" ws boolean ws "}"';
  await s.complete('give me json', { grammar });

  assert.equal(server.completions[0].body.grammar, grammar);
});

test('llama runtime does not duplicate a system prompt already in the history', async () => {
  const server = createFakeServer();
  const s = await session(server);

  await s.completeChat([
    { role: 'system', content: 'from history' },
    { role: 'user', content: 'hi' },
  ], { systemPrompt: 'from options' });

  const sent = server.completions[0].body.messages as Array<{ role: string; content: string }>;
  assert.equal(sent.filter((m) => m.role === 'system').length, 1);
  assert.equal(sent[0].content, 'from history');
});

test('llama runtime prepends systemPrompt when the history has none', async () => {
  const server = createFakeServer();
  const s = await session(server);

  await s.complete('hi', { systemPrompt: 'be terse' });

  const sent = server.completions[0].body.messages as Array<{ role: string; content: string }>;
  assert.equal(sent[0].role, 'system');
  assert.equal(sent[0].content, 'be terse');
  assert.equal(sent[1].role, 'user');
});

test('llama runtime supports non-streaming mode', async () => {
  const server = createFakeServer({ message: 'single shot' });
  const s = await session(server, { stream: false });

  const result = await s.complete('hi');

  assert.equal(server.completions[0].body.stream, false);
  assert.equal(result.text, 'single shot');
  assert.equal(result.tokensGenerated, 7);
});

test('llama runtime drops image parts when no projector is loaded', async () => {
  const server = createFakeServer();
  const s = await session(server);

  await s.completeChat([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    },
  ]);

  const sent = server.completions[0].body.messages as Array<{ role: string; content: unknown }>;
  assert.equal(sent[0].content, 'what is this?');
});

test('llama runtime forwards image parts when a projector is loaded', async () => {
  const server = createFakeServer();
  const s = await session(server, { supportsVision: true });

  await s.completeChat([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', url: 'data:image/png;base64,AAAA' },
      ],
    },
  ]);

  const sent = server.completions[0].body.messages as Array<{
    role: string;
    content: Array<{ type: string; image_url?: { url: string } }>;
  }>;
  assert.equal(sent[0].content.length, 2);
  assert.equal(sent[0].content[0].type, 'text');
  assert.equal(sent[0].content[1].type, 'image_url');
  assert.equal(sent[0].content[1].image_url?.url, 'data:image/png;base64,AAAA');
});

test('llama runtime reads the real context window from /props', async () => {
  const server = createFakeServer({ props: { default_generation_settings: { n_ctx: 32768 } } });
  const s = await session(server);

  const state = await s.contextState();
  assert.equal(state.maxContextTokens, 32768);
  assert.equal(s.capabilitySnapshot.model.contextWindowTokens, 32768);
});

test('llama runtime falls back to defaults when /props is unavailable', async () => {
  const server = createFakeServer({ props: null });
  const logs: string[] = [];
  const s = await session(server, { onLog: (line) => logs.push(line) });

  // A missing /props must not fail activation — it is an advisory, not a gate.
  assert.equal(s.capabilitySnapshot.model.contextWindowTokens, 4096);
  assert.equal(s.resolvedContract.compatible, true);
  assert.ok(logs.some((line) => line.includes('/props')));
});

test('llama runtime honors an aborted caller signal', async () => {
  const server = createFakeServer();
  const s = await session(server);

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => s.complete('hi', { abortSignal: controller.signal }),
    (error: Error) => error.name === 'AbortError',
  );
});

test('llama runtime surfaces a non-OK response with the server body', async () => {
  const server = createFakeServer({ status: 500, errorBody: 'context shift failed' });
  const s = await session(server);

  await assert.rejects(
    () => s.complete('hi'),
    (error: Error) =>
      error.message.includes('500') && error.message.includes('context shift failed'),
  );
});

test('llama runtime reports GPU acceleration through the resolved contract', async () => {
  const server = createFakeServer();
  const s = await session(server, { acceleration: 'gpu' });

  assert.equal(s.resolvedContract.resolvedCapabilities.accelerationMode, 'gpu');
  const diag = await s.diagnostics();
  assert.equal(diag.accelerationMode, 'gpu');
});

test('llama runtime declares structured output and tool calling as compatible', async () => {
  const server = createFakeServer();
  const runtime = llamaServerRuntime({ baseUrl: BASE, fetchImpl: server.fetchImpl });
  const s = await runtime.createSession({
    filePath: '/models/m.gguf',
    appRequirements: { structuredJsonOutput: true, toolCalling: true, streaming: true },
  });

  assert.equal(s.resolvedContract.compatible, true);
  assert.equal(s.resolvedContract.resolvedCapabilities.structuredJsonOutput, true);
  assert.equal(s.resolvedContract.resolvedCapabilities.toolCalling, true);
  assert.equal(s.resolvedContract.resolvedCapabilities.streaming, true);
});

test('llama runtime sends the api key as a bearer token', async () => {
  const server = createFakeServer();
  const s = await session(server, { apiKey: 'sk-local' });

  await s.complete('hi');

  assert.equal(server.completions[0].headers.Authorization, 'Bearer sk-local');
});

test('llama runtime separates reasoning_content from the answer', async () => {
  // Found on hardware: a live Gemma 4 E4B run reported 0 tokens and an empty
  // sample because the adapter read only `delta.content`, and the model had
  // spent its whole budget on `reasoning_content`. Thinking models are the norm
  // now, so an adapter that ignores that channel reports them as broken.
  const server = createFakeServer({
    reasoningDeltas: ['The user ', 'asks about X.'],
    deltas: ['X is ', 'a thing.'],
  });
  const s = await session(server);

  const answerTokens: string[] = [];
  const reasoningSeen: string[] = [];
  const result = await s.complete('what is X?', {
    onToken: (t) => answerTokens.push(t),
    onChunk: (c) => {
      if (c.reasoningDelta) reasoningSeen.push(c.reasoningDelta);
    },
  });

  assert.equal(result.text, 'X is a thing.');
  assert.equal(result.reasoningText, 'The user asks about X.');
  // onToken is the answer stream only — a UI bound to it must not render the
  // model's private deliberation as the reply.
  assert.deepEqual(answerTokens, ['X is ', 'a thing.']);
  assert.deepEqual(reasoningSeen, ['The user ', 'asks about X.']);
  // Reasoning tokens are real work and must be counted.
  assert.equal(result.tokensGenerated, 4);
});

test('llama runtime reports reasoning even when the answer is empty', async () => {
  // This is the exact live failure mode: budget exhausted while thinking.
  const server = createFakeServer({ reasoningDeltas: ['Still thinking'], deltas: [] });
  const s = await session(server);

  const result = await s.complete('hard question', { maxTokens: 4 });

  assert.equal(result.text, '');
  assert.equal(result.reasoningText, 'Still thinking');
  assert.ok(result.tokensGenerated > 0, 'generation happened even though no answer arrived');
});

test('llama runtime carries reasoning through the non-streaming path too', async () => {
  const server = createFakeServer({
    message: 'the answer',
    reasoningDeltas: ['deliberation'],
  });
  const s = await session(server, { stream: false });

  const result = await s.complete('hi');

  assert.equal(result.text, 'the answer');
  assert.equal(result.reasoningText, 'deliberation');
});

test('extraBody supplies backend knobs the contract does not model', async () => {
  // Collecta-Local needs min_p and repeat_penalty. Before this existed, needing
  // one unmodelled sampler knob was reason enough to fork the whole adapter.
  const server = createFakeServer();
  const s = await session(server, {
    extraBody: { min_p: 0.05, repeat_penalty: 1.1, temperature: 0.3 },
  });

  await s.complete('hi');

  const body = server.completions[0].body;
  assert.equal(body.min_p, 0.05);
  assert.equal(body.repeat_penalty, 1.1);
  assert.equal(body.temperature, 0.3, 'acts as a default when the call sets nothing');
});

test('an explicit per-call value beats extraBody', async () => {
  const server = createFakeServer();
  const s = await session(server, { extraBody: { temperature: 0.3 } });

  await s.complete('hi', { temperature: 0.9 });

  assert.equal(server.completions[0].body.temperature, 0.9);
});

test('extraBody cannot clobber correctness-critical fields', async () => {
  const server = createFakeServer();
  const s = await session(server, {
    extraBody: { grammar: 'root ::= "hijacked"', stream: false, messages: [] },
  });

  await s.complete('hi', { grammar: 'root ::= "real"' });

  const body = server.completions[0].body;
  assert.equal(body.grammar, 'root ::= "real"');
  assert.equal(body.stream, true);
  assert.equal((body.messages as unknown[]).length, 1);
});

test('decodeRate excludes the prompt-eval interval', () => {
  // One token gives no decode interval to measure.
  assert.equal(decodeRate(1, Date.now() - 1000), 0);
  assert.equal(decodeRate(0, 0), 0);

  // 3 tokens over ~1s of post-first-token time is 2 intervals, so ~2 tok/s.
  const rate = decodeRate(3, Date.now() - 1000);
  assert.ok(rate > 1.5 && rate < 2.5, `expected ~2 tok/s, got ${rate}`);
});

test('llamaServerRuntime tolerates a trailing slash in baseUrl', async () => {
  const server = createFakeServer();
  const runtime = llamaServerRuntime({
    baseUrl: `${BASE}/`,
    fetchImpl: server.fetchImpl,
  });
  const s = await runtime.createSession({ filePath: '/models/m.gguf' });
  await s.complete('hi');

  assert.equal(server.completions[0].url, `${BASE}/v1/chat/completions`);
});
