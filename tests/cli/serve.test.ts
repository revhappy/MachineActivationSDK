import { strict as assert } from 'node:assert';
import type { Server } from 'node:http';

import { createMachineHttpServer } from '../../src/bin/commands/serve';
import { createMachine } from '../../src/sdk/createMachine';
import { stubRuntime } from '../../src/runtime/stubRuntime';
import { test } from '../_harness';

// `machine serve` is how an app in a language the SDK does not ship for — the
// Python sidecar in Agent On Deck, say — reaches a local model. Its contract is
// the wire format, so that is what these tests exercise: a real HTTP server on a
// real socket, driven by a stub runtime so no weights are needed.

interface Harness {
  url: string;
  close(): Promise<void>;
  /** Every request body the model saw, in order. */
  seen: Array<{ messages: unknown; grammar?: string }>;
}

async function serveStub(
  options: { respond?: () => string; apiKey?: string; cors?: boolean } = {},
): Promise<Harness> {
  const seen: Harness['seen'] = [];
  const runtime = stubRuntime({
    respond: (messages, completion) => {
      seen.push({ messages, grammar: completion?.grammar });
      return options.respond ? options.respond() : 'stubbed answer';
    },
  });

  const machine = createMachine({ runtimes: [runtime], compatibilityPolicy: 'permissive' });
  const model = machine.model({ filePath: 'stub.gguf', modelId: 'stub-model' });

  const server: Server = await createMachineHttpServer({
    model,
    config: {
      port: 0,
      host: '127.0.0.1',
      apiKey: options.apiKey,
      cors: options.cors ?? false,
      modelPath: '/models/stub.gguf',
      modelId: 'stub-model',
      contextTokens: 4096,
      gpuLayers: 0,
      serverBinary: 'stub',
    },
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('server did not bind');

  return {
    url: `http://127.0.0.1:${address.port}`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

test('serve answers /health with the loaded model', async () => {
  const h = await serveStub();
  try {
    const res = await fetch(`${h.url}/health`);
    const body = (await res.json()) as { status: string; model: { id: string } };
    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.model.id, 'stub-model');
  } finally {
    await h.close();
  }
});

test('serve lists the model in the OpenAI shape', async () => {
  const h = await serveStub();
  try {
    const res = await fetch(`${h.url}/v1/models`);
    const body = (await res.json()) as { object: string; data: Array<{ id: string }> };
    assert.equal(body.object, 'list');
    assert.equal(body.data[0].id, 'stub-model');
  } finally {
    await h.close();
  }
});

test('serve handles a non-streaming chat completion', async () => {
  const h = await serveStub({ respond: () => 'Bonjour' });
  try {
    const res = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'stub-model',
        messages: [{ role: 'user', content: 'say hello in French' }],
      }),
    });
    const body = (await res.json()) as {
      object: string;
      choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
      usage: { completion_tokens: number };
    };

    assert.equal(res.status, 200);
    assert.equal(body.object, 'chat.completion');
    assert.equal(body.choices[0].message.role, 'assistant');
    assert.equal(body.choices[0].message.content, 'Bonjour');
    assert.equal(body.choices[0].finish_reason, 'stop');
  } finally {
    await h.close();
  }
});

test('serve streams chat completions as OpenAI SSE chunks', async () => {
  const h = await serveStub({ respond: () => 'one two three' });
  try {
    const res = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'count' }],
        stream: true,
      }),
    });

    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const text = await res.text();

    const payloads = text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6).trim());

    assert.ok(payloads.includes('[DONE]'), 'stream must terminate with [DONE]');

    const deltas = payloads
      .filter((p) => p !== '[DONE]')
      .map((p) => JSON.parse(p) as { choices: Array<{ delta: { content?: string } }> })
      .map((p) => p.choices[0].delta.content ?? '')
      .join('');
    assert.equal(deltas, 'one two three');
  } finally {
    await h.close();
  }
});

test('serve compiles response_format json_schema into a grammar', async () => {
  // This is the payoff for a non-JS caller: the same grammar-constrained
  // guarantee TypeScript gets from generateObject, reached over HTTP.
  const h = await serveStub({ respond: () => '{"language":"French"}' });
  try {
    const res = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'detect language' }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            schema: {
              type: 'object',
              properties: { language: { type: 'string' } },
              required: ['language'],
            },
          },
        },
      }),
    });

    assert.equal(res.status, 200);
    const grammar = h.seen[0]?.grammar;
    assert.equal(typeof grammar, 'string');
    assert.ok(String(grammar).includes('root'), 'expected a GBNF grammar to reach the runtime');
    assert.ok(String(grammar).includes('language'), 'grammar should encode the schema keys');
  } finally {
    await h.close();
  }
});

test('serve forwards a raw grammar when one is supplied', async () => {
  const h = await serveStub();
  try {
    await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        grammar: 'root ::= "yes"',
      }),
    });
    assert.equal(h.seen[0]?.grammar, 'root ::= "yes"');
  } finally {
    await h.close();
  }
});

test('serve exposes the activation contract on a non-OpenAI route', async () => {
  const h = await serveStub();
  try {
    const res = await fetch(`${h.url}/machine/activation`);
    const body = (await res.json()) as {
      contract: { compatible: boolean; compatibility: string; warnings: string[] };
      backend: { backendId: string };
      model: { id: string };
    };

    assert.equal(res.status, 200);
    assert.equal(body.model.id, 'stub-model');
    assert.equal(body.contract.compatible, true);
    assert.ok(Array.isArray(body.contract.warnings));
    assert.equal(body.backend.backendId, 'stub');
  } finally {
    await h.close();
  }
});

// Tool calling over HTTP is what lets an *agent* app in any language use a local
// model. Agent On Deck is an agent product whose entire AI surface is Python;
// without this, the SDK's most differentiated feature was TypeScript-only.

const WEATHER_TOOL = {
  type: 'function',
  function: {
    name: 'weather',
    description: 'Look up the weather for a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
};

test('serve returns an OpenAI tool_call the client can execute', async () => {
  const h = await serveStub({
    respond: () => '{"tool":"weather","args":{"city":"Paris"}}',
  });
  try {
    const res = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'weather in Paris?' }],
        tools: [WEATHER_TOOL],
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      choices: Array<{
        message: { content: string | null; tool_calls?: Array<Record<string, any>> };
        finish_reason: string;
      }>;
    };

    const choice = body.choices[0];
    assert.equal(choice.finish_reason, 'tool_calls');
    assert.equal(choice.message.content, null);

    const call = choice.message.tool_calls?.[0];
    assert.ok(call, 'expected a tool call');
    assert.equal(call.type, 'function');
    assert.equal(call.function.name, 'weather');
    // OpenAI sends arguments as a JSON *string*, not an object. Clients call
    // JSON.parse on it; an object here breaks every one of them.
    assert.equal(typeof call.function.arguments, 'string');
    assert.deepEqual(JSON.parse(call.function.arguments), { city: 'Paris' });
    assert.ok(typeof call.id === 'string' && call.id.length > 0);
  } finally {
    await h.close();
  }
});

test('serve constrains the tool step with a grammar', async () => {
  const h = await serveStub({ respond: () => '{"answer":"done"}' });
  try {
    await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        tools: [WEATHER_TOOL],
      }),
    });

    const grammar = String(h.seen[0]?.grammar ?? '');
    // The envelope must be locked, or a 2-4B model produces prose where a tool
    // call belongs — which is exactly where agentic behavior collapses locally.
    assert.ok(grammar.includes('root'), 'expected a GBNF grammar');
    assert.ok(grammar.includes('weather'), 'grammar should name the tool');
    assert.ok(grammar.includes('answer'), 'grammar should keep the answer branch');
  } finally {
    await h.close();
  }
});

test('serve returns content, not a tool call, when the model answers', async () => {
  const h = await serveStub({ respond: () => '{"answer":"It is 18C."}' });
  try {
    const res = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'weather?' }],
        tools: [WEATHER_TOOL],
      }),
    });
    const body = (await res.json()) as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
    };
    assert.equal(body.choices[0].finish_reason, 'stop');
    assert.equal(body.choices[0].message.content, 'It is 18C.');
  } finally {
    await h.close();
  }
});

test('serve completes the full client-driven tool round trip', async () => {
  // Turn 1 asks for the tool; turn 2 answers from the result the client fed back.
  let turn = 0;
  const h = await serveStub({
    respond: () =>
      turn++ === 0
        ? '{"tool":"weather","args":{"city":"Paris"}}'
        : '{"answer":"It is 18C in Paris."}',
  });
  try {
    const first = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'weather in Paris?' }],
        tools: [WEATHER_TOOL],
      }),
    });
    const firstBody = (await first.json()) as {
      choices: Array<{ message: { tool_calls?: Array<{ id: string }> } }>;
    };
    const callId = firstBody.choices[0].message.tool_calls![0].id;

    // The client executes the tool and sends the result back, OpenAI-style.
    const second = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'weather in Paris?' },
          { role: 'assistant', content: '{"tool":"weather","args":{"city":"Paris"}}' },
          { role: 'tool', tool_call_id: callId, content: '{"tempC":18}' },
        ],
        tools: [WEATHER_TOOL],
      }),
    });
    const secondBody = (await second.json()) as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
    };

    assert.equal(secondBody.choices[0].finish_reason, 'stop');
    assert.equal(secondBody.choices[0].message.content, 'It is 18C in Paris.');

    // The tool result must have reached the model, or the loop cannot close.
    const secondTurn = h.seen[1].messages as Array<{ role: string; content: string }>;
    assert.ok(
      secondTurn.some((m) => m.content.includes('18')),
      'the tool result was not forwarded',
    );
  } finally {
    await h.close();
  }
});

test('serve honors tool_choice by name', async () => {
  const h = await serveStub({ respond: () => '{"tool":"weather","args":{"city":"Rome"}}' });
  try {
    await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        tools: [WEATHER_TOOL],
        tool_choice: { type: 'function', function: { name: 'weather' } },
      }),
    });

    const grammar = String(h.seen[0]?.grammar ?? '');
    // Forcing a tool drops the answer branch, so the model cannot decline.
    assert.ok(!grammar.includes('answer'), 'forced tool grammar must drop the answer branch');
  } finally {
    await h.close();
  }
});

test('serve rejects a tool_choice naming an unknown function', async () => {
  const h = await serveStub();
  try {
    const res = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        tools: [WEATHER_TOOL],
        tool_choice: { type: 'function', function: { name: 'nope' } },
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { param?: string } };
    assert.equal(body.error.param, 'tool_choice');
  } finally {
    await h.close();
  }
});

test('serve skips the tool protocol entirely for tool_choice none', async () => {
  const h = await serveStub({ respond: () => 'plain answer' });
  try {
    const res = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        tools: [WEATHER_TOOL],
        tool_choice: 'none',
      }),
    });
    const body = (await res.json()) as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
    };
    assert.equal(body.choices[0].message.content, 'plain answer');
    assert.equal(body.choices[0].finish_reason, 'stop');
    assert.equal(h.seen[0]?.grammar, undefined, 'no tool grammar when tools are disabled');
  } finally {
    await h.close();
  }
});

test('serve locks the envelope even for a tool with no parameters schema', async () => {
  const h = await serveStub({ respond: () => '{"tool":"ping","args":{}}' });
  try {
    const res = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ type: 'function', function: { name: 'ping' } }],
      }),
    });
    const body = (await res.json()) as {
      choices: Array<{ message: { tool_calls?: unknown[] }; finish_reason: string }>;
    };
    assert.equal(body.choices[0].finish_reason, 'tool_calls');
    // Only the tool's args degrade to "any JSON object"; the envelope holds.
    assert.ok(String(h.seen[0]?.grammar ?? '').includes('ping'));
  } finally {
    await h.close();
  }
});

test('serve enforces the api key when one is configured', async () => {
  const h = await serveStub({ apiKey: 'secret' });
  try {
    const denied = await fetch(`${h.url}/v1/models`);
    assert.equal(denied.status, 401);

    const allowed = await fetch(`${h.url}/v1/models`, {
      headers: { Authorization: 'Bearer secret' },
    });
    assert.equal(allowed.status, 200);
  } finally {
    await h.close();
  }
});

test('serve rejects a malformed body with 400, not 500', async () => {
  const h = await serveStub();
  try {
    const res = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    assert.equal(res.status, 400);
  } finally {
    await h.close();
  }
});

test('serve rejects an empty message list', async () => {
  const h = await serveStub();
  try {
    const res = await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(res.status, 400);
  } finally {
    await h.close();
  }
});

test('serve 404s an unknown route', async () => {
  const h = await serveStub();
  try {
    const res = await fetch(`${h.url}/v1/embeddings`);
    assert.equal(res.status, 404);
  } finally {
    await h.close();
  }
});

test('serve translates multimodal content parts', async () => {
  const h = await serveStub();
  try {
    await fetch(`${h.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is this?' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            ],
          },
        ],
      }),
    });

    const messages = h.seen[0]?.messages as Array<{ content: Array<{ type: string }> }>;
    assert.equal(messages[0].content.length, 2);
    assert.equal(messages[0].content[1].type, 'image_url');
  } finally {
    await h.close();
  }
});

test('serve handles the legacy /v1/completions route', async () => {
  const h = await serveStub({ respond: () => 'completed' });
  try {
    const res = await fetch(`${h.url}/v1/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'finish this' }),
    });
    const body = (await res.json()) as { object: string; choices: Array<{ text: string }> };
    assert.equal(body.object, 'text_completion');
    assert.equal(body.choices[0].text, 'completed');
  } finally {
    await h.close();
  }
});

test('serve omits CORS headers unless asked', async () => {
  const off = await serveStub();
  try {
    const res = await fetch(`${off.url}/health`);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  } finally {
    await off.close();
  }

  const on = await serveStub({ cors: true });
  try {
    const res = await fetch(`${on.url}/health`);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  } finally {
    await on.close();
  }
});
