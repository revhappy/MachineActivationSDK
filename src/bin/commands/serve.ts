import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join as pathJoin, resolve as pathResolve } from 'node:path';

import type {
  ActivationChatMessage,
  ActivationMessagePart,
  ActivationSession,
} from '../../activation/activationAdapter';
import { parseCartridgeManifest } from '../../cartridge';
import { createNodeCartridgeCache } from '../../catalog/nodeCartridgeCache';
import {
  discoverLlamaServer,
  ensureLlamaServer,
  type LlamaServerHandle,
} from '../../runtime/nodeLlamaServer';
import { createMachine } from '../../sdk/createMachine';
import { generateText } from '../../sdk/generateText';
import { jsonSchemaToGbnf } from '../../sdk/jsonSchemaToGbnf';
import {
  buildToolLoopGrammar,
  buildToolSystemPrompt,
  parseToolEnvelope,
  type ToolDescriptor,
} from '../../sdk/toolProtocol';
import { streamText } from '../../sdk/streamText';
import type { JsonSchema } from '../../sdk/jsonSchema';
import type { MachineModel } from '../../sdk/types';
import { getBoolFlag, getStringFlag, parseArgs } from '../args';
import { bold, dim, errorln, green, println, red } from '../output';

const DEFAULT_PORT = 8177;

const HELP = `\
machine serve <model.gguf | cartridge-id> [flags]

Expose a local model over HTTP so an app in any language can use it.

Speaks the OpenAI chat-completions dialect, so most existing clients work by
changing a base URL and nothing else — Python, Go, Ruby, Swift, curl. Also
exposes the activation contract at /machine/activation, which is the part no
cloud API has a vocabulary for: load time, memory fit, acceleration, and what
is degraded on this machine.

Flags:
  --port <n>            Port to listen on (default: ${DEFAULT_PORT}). 0 picks a
                        free one — see --supervised.
  --host <addr>         Address to bind (default: 127.0.0.1).
  --supervised          Run as a child of another process: emit one line of JSON
                        on stdout when ready (and on failure), and shut down when
                        stdin closes. Use this to spawn a model from a Python,
                        Electron or Go app instead of asking a user to start one.
  --cache <dir>         Cache root when resolving a cartridge id.
  --server <path>       Path to llama-server[.exe]. Defaults to $MACHINE_LLAMA_SERVER
                        or a vendored build under ./vendor/llama-cpp/.
  --gpu-layers <n>      Layers to offload (default: 0 = CPU).
  --ctx <n>             Context size (default: 4096).
  --api-key <key>       Require this bearer token on every request.
  --cors                Send permissive CORS headers (for browser callers).
  --help                Show this message.

Endpoints:
  GET  /health                  Liveness plus the loaded model.
  GET  /v1/models               OpenAI-shaped model list.
  POST /v1/chat/completions     Chat, streaming or not. Honors response_format,
                                tools and tool_choice (returns OpenAI tool_calls).
  POST /v1/completions          Legacy prompt completion.
  GET  /machine/activation      The resolved activation contract.

Binds to 127.0.0.1 by default: this is a local model, and exposing weights plus
unmetered inference to a network should be a deliberate act. Pass
--host 0.0.0.0 with --api-key if you mean it.
`;

/**
 * The supervision handshake.
 *
 * A parent that spawns this process has two problems the human at a terminal
 * does not: it cannot read "● machine serve" to know the model finished
 * loading, and with --port 0 it does not even know where to connect. So in
 * supervised mode exactly one line of JSON goes to stdout — `ready` with the
 * resolved URL, or `error` with the reason — and everything else stays on
 * stderr where it cannot corrupt the handshake.
 */
interface ServeEvent {
  event: 'ready' | 'error';
  url?: string;
  port?: number;
  host?: string;
  model?: { id: string; path: string };
  pid?: number;
  message?: string;
}

function emitEvent(supervised: boolean, event: ServeEvent): void {
  if (!supervised) return;
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

interface ServeConfig {
  port: number;
  host: string;
  apiKey?: string;
  cors: boolean;
  modelPath: string;
  modelId: string;
  contextTokens: number;
  gpuLayers: number;
  serverBinary: string;
}

export async function runServe(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const supervised = getBoolFlag(args, 'supervised', false);
  // In supervised mode stdout carries the handshake and nothing else, so the
  // human-facing chatter moves to stderr rather than corrupting it.
  const say = supervised ? errorln : println;
  const fail = (message: string, hint?: string): number => {
    errorln(red(`serve: ${message}`));
    if (hint) errorln(dim(`  ${hint}`));
    emitEvent(supervised, { event: 'error', message });
    return 2;
  };

  const target = args.positionals[0];
  if (!target) {
    errorln(HELP);
    return fail('missing model path or cartridge id');
  }

  const resolved = await resolveModel(target, getStringFlag(args, 'cache'));
  if (!resolved) {
    return fail(
      `cannot read ${target}`,
      'Pass a path to a .gguf, or the id of a cartridge you have pulled (`machine list`).',
    );
  }

  const serverBinary =
    getStringFlag(args, 'server') ??
    discoverLlamaServer(process.cwd(), dirname(resolved.modelPath)) ??
    undefined;
  if (!serverBinary) {
    return fail(
      'no llama-server binary found.',
      'Get one for this machine:  machine fetch-runtime\n' +
        'Or point at your own:      --server <path> / $MACHINE_LLAMA_SERVER',
    );
  }

  const config: ServeConfig = {
    port: Number(getStringFlag(args, 'port', String(DEFAULT_PORT))),
    host: getStringFlag(args, 'host', '127.0.0.1')!,
    apiKey: getStringFlag(args, 'api-key'),
    cors: getBoolFlag(args, 'cors', false),
    modelPath: resolved.modelPath,
    modelId: resolved.modelId,
    contextTokens: Number(getStringFlag(args, 'ctx', '4096')),
    gpuLayers: Number(getStringFlag(args, 'gpu-layers', '0')),
    serverBinary,
  };

  say(dim(`Loading ${basename(config.modelPath)} …`));

  let handle: LlamaServerHandle;
  try {
    handle = await ensureLlamaServer({
      serverBinary: config.serverBinary,
      modelPath: config.modelPath,
      contextTokens: config.contextTokens,
      gpuLayers: config.gpuLayers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorln(red(`serve: ${message}`));
    emitEvent(supervised, { event: 'error', message });
    return 1;
  }

  const machine = createMachine({
    runtimes: handle.runtime,
    compatibilityPolicy: 'permissive',
  });
  const model = machine.model({ filePath: config.modelPath, modelId: config.modelId });

  let server: Awaited<ReturnType<typeof createMachineHttpServer>>;
  try {
    server = await createMachineHttpServer({ model, config });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => resolve());
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorln(red(`serve: ${message}`));
    emitEvent(supervised, { event: 'error', message });
    await handle.close();
    return 1;
  }

  // `--port 0` asks the OS for a free one, which is how a supervisor avoids
  // colliding with whatever else is on the machine. The port is only knowable
  // after listen, and only through the handshake.
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  const url = `http://${config.host}:${port}`;

  say('');
  say(`${green('●')} ${bold('machine serve')} — ${basename(config.modelPath)}`);
  say(`  ${url}/v1/chat/completions`);
  say(`  ${url}/machine/activation`);
  if (!config.apiKey && config.host !== '127.0.0.1' && config.host !== 'localhost') {
    say('');
    say(red(`  Bound to ${config.host} with no --api-key. Anyone who can reach this port`));
    say(red('  can run inference on your machine.'));
  }
  say('');
  say(dim(supervised ? '  Supervised; stdin close stops it.' : '  Ctrl-C to stop.'));

  emitEvent(supervised, {
    event: 'ready',
    url,
    port,
    host: config.host,
    model: { id: config.modelId, path: config.modelPath },
    pid: process.pid,
  });

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      server.close(() => resolve());
      void handle.close();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    if (supervised) {
      // The parent dying is the case a signal handler cannot cover: a killed
      // parent sends nothing, and this process would keep several GB of weights
      // resident forever. A closed stdin pipe is the one cross-platform signal
      // that survives it — Windows has no process groups to inherit and no
      // PDEATHSIG.
      process.stdin.resume();
      process.stdin.on('end', shutdown);
      process.stdin.on('close', shutdown);
      process.stdin.on('error', shutdown);
    }
  });

  return 0;
}

// ---------------------------------------------------------------------------
// Server construction
// ---------------------------------------------------------------------------

export interface MachineHttpServerInput {
  model: MachineModel;
  /** Only `modelId`, `modelPath`, `apiKey` and `cors` affect request handling. */
  config: ServeConfig;
}

/**
 * Build the HTTP server around an already-configured model.
 *
 * Separate from `runServe` so the wire translation — OpenAI request in,
 * activation call out, OpenAI response back — can be tested against any
 * `ActivationRuntime`, including `stubRuntime()`, with no binary and no weights.
 */
export async function createMachineHttpServer(
  input: MachineHttpServerInput,
): Promise<ReturnType<typeof createServer>> {
  const { model, config } = input;

  // Resolve the session once, up front. It is what makes /machine/activation
  // answerable, and it surfaces a fit problem now rather than on the first
  // request from a caller who cannot interpret it.
  const session = await model.getSession();

  return createServer((req, res) => {
    void handleRequest(req, res, { config, model, session }).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, 500, config, {
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: 'internal_error',
        },
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

interface RequestContext {
  config: ServeConfig;
  model: MachineModel;
  session: ActivationSession;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
): Promise<void> {
  const { config } = ctx;
  const url = (req.url ?? '/').split('?')[0];

  if (req.method === 'OPTIONS') {
    applyCors(res, config);
    res.writeHead(204).end();
    return;
  }

  if (config.apiKey) {
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (presented !== config.apiKey) {
      sendJson(res, 401, config, {
        error: { message: 'Invalid API key.', type: 'invalid_request_error' },
      });
      return;
    }
  }

  if (req.method === 'GET' && url === '/health') {
    sendJson(res, 200, config, {
      status: 'ok',
      model: { id: config.modelId, path: config.modelPath },
      backend: ctx.session.backendId,
    });
    return;
  }

  if (req.method === 'GET' && url === '/v1/models') {
    sendJson(res, 200, config, {
      object: 'list',
      data: [
        {
          id: config.modelId,
          object: 'model',
          owned_by: 'local',
          created: 0,
        },
      ],
    });
    return;
  }

  if (req.method === 'GET' && url === '/machine/activation') {
    // Deliberately not OpenAI-shaped. None of this exists in a cloud API, and
    // flattening it into an OpenAI response would throw away the only vocabulary
    // that describes running a model on hardware you own.
    const snapshot = ctx.session.capabilitySnapshot;
    sendJson(res, 200, config, {
      schemaVersion: snapshot.schemaVersion,
      model: {
        id: config.modelId,
        path: config.modelPath,
        format: snapshot.model.modelFormat,
        contextWindowTokens: snapshot.model.contextWindowTokens,
      },
      backend: snapshot.backend,
      device: snapshot.device,
      contract: snapshot.resolvedContract,
      diagnostics: await ctx.session.diagnostics(),
    });
    return;
  }

  if (req.method === 'POST' && url === '/v1/chat/completions') {
    await handleChatCompletions(req, res, ctx);
    return;
  }

  if (req.method === 'POST' && url === '/v1/completions') {
    await handleLegacyCompletions(req, res, ctx);
    return;
  }

  sendJson(res, 404, config, {
    error: { message: `No route for ${req.method} ${url}.`, type: 'invalid_request_error' },
  });
}

// ---------------------------------------------------------------------------
// Chat completions
// ---------------------------------------------------------------------------

interface OpenAiMessage {
  role?: string;
  content?: string | Array<Record<string, unknown>>;
}

interface ChatCompletionsBody {
  messages?: OpenAiMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop?: string | string[];
  grammar?: string;
  tools?: unknown[];
  tool_choice?: 'auto' | 'none' | 'required' | { function?: { name?: string } };
  response_format?: {
    type?: string;
    json_schema?: { schema?: JsonSchema };
  };
}

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
): Promise<void> {
  const { config } = ctx;
  const body = await readJsonBody<ChatCompletionsBody>(req);
  if (!body) {
    sendJson(res, 400, config, {
      error: { message: 'Request body must be JSON.', type: 'invalid_request_error' },
    });
    return;
  }

  const tools = parseOpenAiTools(body.tools);
  const messages = toActivationMessages(body.messages ?? []);
  if (messages.length === 0) {
    sendJson(res, 400, config, {
      error: { message: '`messages` must contain at least one entry.', type: 'invalid_request_error' },
    });
    return;
  }

  const completionId = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);

  // Tool calling: the model decides, the *caller* executes.
  //
  // The SDK's own loop runs tools in-process, which is impossible here — the
  // functions live in the client's process, in a language we do not run. So we
  // run one step of the same grammar-constrained protocol and hand the parsed
  // call back as OpenAI `tool_calls`. The client executes it, appends a `tool`
  // message, and calls again. Same envelope, same grammar, different driver.
  if (tools.length > 0) {
    await handleToolStep(res, ctx, {
      body,
      messages,
      tools,
      completionId,
      created,
    });
    return;
  }

  const grammar = resolveGrammar(body);
  const common = {
    model: ctx.model,
    messages,
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    topP: body.top_p,
    topK: body.top_k,
    stopSequences: typeof body.stop === 'string' ? [body.stop] : body.stop,
  };

  if (body.stream) {
    startSse(res, config);
    const result = streamText({ ...common, grammar });
    try {
      for await (const delta of result.textStream) {
        writeSse(res, {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: config.modelId,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
        });
      }
      const finishReason = await result.finishReason;
      writeSse(res, {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: config.modelId,
        choices: [{ index: 0, delta: {}, finish_reason: toOpenAiFinishReason(finishReason) }],
      });
      res.write('data: [DONE]\n\n');
    } catch (error) {
      // Headers are already sent, so the only way to report this is in-band.
      writeSse(res, {
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: 'internal_error',
        },
      });
    }
    res.end();
    return;
  }

  const result = await generateText({ ...common, grammar });
  sendJson(res, 200, config, {
    id: completionId,
    object: 'chat.completion',
    created,
    model: config.modelId,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: result.text },
        finish_reason: toOpenAiFinishReason(result.finishReason),
      },
    ],
    usage: {
      prompt_tokens: result.usage.promptTokens ?? 0,
      completion_tokens: result.usage.completionTokens ?? 0,
      total_tokens:
        (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0),
    },
  });
}

/**
 * One step of the tool protocol, returned in OpenAI's shape.
 *
 * Streaming is deliberately not supported for a tool step: the response is a
 * grammar-constrained JSON envelope, and streaming its fragments would emit
 * partial JSON that no OpenAI client knows how to assemble into a `tool_calls`
 * delta. Real clients tolerate a non-streamed tool step; they cannot tolerate
 * malformed deltas.
 */
async function handleToolStep(
  res: ServerResponse,
  ctx: RequestContext,
  input: {
    body: ChatCompletionsBody;
    messages: ActivationChatMessage[];
    tools: ToolDescriptor[];
    completionId: string;
    created: number;
  },
): Promise<void> {
  const { config } = ctx;
  const { body, messages, tools, completionId, created } = input;

  const forced = resolveForcedTool(body.tool_choice, tools);
  if (forced === INVALID_TOOL_CHOICE) {
    sendJson(res, 400, config, {
      error: {
        message: '`tool_choice` names a function that is not in `tools`.',
        type: 'invalid_request_error',
        param: 'tool_choice',
      },
    });
    return;
  }

  // `tool_choice: "none"` means answer without calling anything, so the tool
  // preamble would only confuse the model about a contract it may not use.
  if (body.tool_choice === 'none') {
    const plain = await generateText({
      model: ctx.model,
      messages,
      maxTokens: body.max_tokens,
      temperature: body.temperature,
    });
    sendJson(res, 200, config, {
      id: completionId,
      object: 'chat.completion',
      created,
      model: config.modelId,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: plain.text },
          finish_reason: 'stop',
        },
      ],
      usage: toUsagePayload(plain.usage),
    });
    return;
  }

  const system = messages.find((m) => m.role === 'system');
  const systemText =
    system && typeof system.content === 'string' ? system.content : undefined;
  const preamble = buildToolSystemPrompt(tools, systemText, forced);
  const conversation: ActivationChatMessage[] = [
    { role: 'system', content: preamble },
    ...messages.filter((m) => m !== system),
  ];

  const result = await generateText({
    model: ctx.model,
    messages: conversation,
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    // The same envelope grammar generateText uses for its in-process loop.
    grammar: buildToolLoopGrammar(tools, forced),
  });

  const envelope = parseToolEnvelope(
    result.text,
    tools.map((tool) => tool.name),
  );

  if (envelope.kind === 'tool') {
    sendJson(res, 200, config, {
      id: completionId,
      object: 'chat.completion',
      created,
      model: config.modelId,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                // OpenAI clients echo this id back on the `tool` message that
                // carries the result, so it has to be stable within the turn.
                id: `call_${completionId}_0`,
                type: 'function',
                function: {
                  name: envelope.name,
                  // OpenAI sends arguments as a JSON *string*, not an object.
                  arguments: JSON.stringify(envelope.args),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: toUsagePayload(result.usage),
    });
    return;
  }

  const content = envelope.kind === 'answer' ? envelope.answer : envelope.text;
  sendJson(res, 200, config, {
    id: completionId,
    object: 'chat.completion',
    created,
    model: config.modelId,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: toUsagePayload(result.usage),
  });
}

const INVALID_TOOL_CHOICE = Symbol('invalid tool_choice');

function resolveForcedTool(
  toolChoice: ChatCompletionsBody['tool_choice'],
  tools: ToolDescriptor[],
): string | undefined | typeof INVALID_TOOL_CHOICE {
  if (!toolChoice || toolChoice === 'auto' || toolChoice === 'none') return undefined;
  if (typeof toolChoice === 'object' && toolChoice.function?.name) {
    const name = toolChoice.function.name;
    return tools.some((tool) => tool.name === name) ? name : INVALID_TOOL_CHOICE;
  }
  if (toolChoice === 'required') {
    // "Call something, I don't care what" has no single-tool grammar; the
    // envelope simply drops its `answer` branch. Handled by passing a name only
    // when one was given, so `required` degrades to `auto` here.
    return undefined;
  }
  return undefined;
}

/** OpenAI `tools` → the transport-shaped descriptors the protocol works on. */
function parseOpenAiTools(tools: unknown): ToolDescriptor[] {
  if (!Array.isArray(tools)) return [];
  const out: ToolDescriptor[] = [];
  for (const entry of tools) {
    if (!entry || typeof entry !== 'object') continue;
    const fn = (entry as { function?: Record<string, unknown> }).function;
    if (!fn || typeof fn.name !== 'string') continue;
    out.push({
      name: fn.name,
      description: typeof fn.description === 'string' ? fn.description : undefined,
      // A tool with no parameters schema still gets a locked envelope; only its
      // `args` degrade to "any JSON object".
      jsonSchema: (fn.parameters as JsonSchema | undefined) ?? null,
    });
  }
  return out;
}

function toUsagePayload(usage: { promptTokens?: number; completionTokens: number }) {
  return {
    prompt_tokens: usage.promptTokens ?? 0,
    completion_tokens: usage.completionTokens ?? 0,
    total_tokens: (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
  };
}

interface LegacyCompletionsBody {
  prompt?: string;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  stop?: string | string[];
  grammar?: string;
}

async function handleLegacyCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
): Promise<void> {
  const { config } = ctx;
  const body = await readJsonBody<LegacyCompletionsBody>(req);
  if (!body?.prompt) {
    sendJson(res, 400, config, {
      error: { message: '`prompt` is required.', type: 'invalid_request_error' },
    });
    return;
  }

  const result = await generateText({
    model: ctx.model,
    prompt: body.prompt,
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    stopSequences: typeof body.stop === 'string' ? [body.stop] : body.stop,
    grammar: body.grammar,
  });

  sendJson(res, 200, config, {
    id: `cmpl-${Date.now().toString(36)}`,
    object: 'text_completion',
    created: Math.floor(Date.now() / 1000),
    model: config.modelId,
    choices: [{ index: 0, text: result.text, finish_reason: toOpenAiFinishReason(result.finishReason) }],
  });
}

// ---------------------------------------------------------------------------
// Translation helpers
// ---------------------------------------------------------------------------

/**
 * Turn OpenAI `response_format` into a GBNF grammar.
 *
 * `json_schema` is the interesting case: llama.cpp enforces a grammar in its
 * sampler, so a caller in any language gets output that *cannot* violate the
 * schema — the same guarantee `generateObject` gives TypeScript callers, reached
 * over HTTP. `json_object` has no schema to compile, so it falls through to the
 * adapter's json mode.
 */
function resolveGrammar(body: ChatCompletionsBody): string | undefined {
  if (body.grammar) return body.grammar;
  const schema = body.response_format?.json_schema?.schema;
  if (body.response_format?.type === 'json_schema' && schema) {
    return jsonSchemaToGbnf(schema);
  }
  return undefined;
}

function toActivationMessages(messages: OpenAiMessage[]): ActivationChatMessage[] {
  const out: ActivationChatMessage[] = [];
  for (const message of messages) {
    const role = message.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') continue;

    if (typeof message.content === 'string') {
      out.push({ role, content: message.content });
      continue;
    }
    if (!Array.isArray(message.content)) continue;

    const parts: ActivationMessagePart[] = [];
    for (const part of message.content) {
      const type = part.type;
      if (type === 'text' && typeof part.text === 'string') {
        parts.push({ type: 'text', text: part.text });
      } else if (type === 'image_url') {
        const imageUrl = part.image_url as { url?: string } | undefined;
        if (imageUrl?.url) parts.push({ type: 'image_url', image_url: { url: imageUrl.url } });
      }
    }
    if (parts.length > 0) out.push({ role, content: parts });
  }
  return out;
}

function toOpenAiFinishReason(reason: string): string {
  // The SDK's vocabulary is close but not identical; map rather than leak ours.
  if (reason === 'length' || reason === 'max_tokens') return 'length';
  if (reason === 'abort' || reason === 'aborted') return 'stop';
  if (reason === 'tool_calls') return 'tool_calls';
  return 'stop';
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 32 * 1024 * 1024;

async function readJsonBody<T>(req: IncomingMessage): Promise<T | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    // Base64 images make chat bodies large; the cap is there so a stuck client
    // cannot exhaust memory, not to be stingy.
    if (total > MAX_BODY_BYTES) throw new Error('Request body too large.');
    chunks.push(buf);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    return undefined;
  }
}

function applyCors(res: ServerResponse, config: ServeConfig): void {
  if (!config.cors) return;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(
  res: ServerResponse,
  status: number,
  config: ServeConfig,
  payload: unknown,
): void {
  applyCors(res, config);
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function startSse(res: ServerResponse, config: ServeConfig): void {
  applyCors(res, config);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
}

function writeSse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/** Accept a filesystem path or the id of an already-pulled cartridge. */
async function resolveModel(
  target: string,
  cacheDir: string | undefined,
): Promise<{ modelPath: string; modelId: string } | undefined> {
  const asPath = pathResolve(target);
  if (existsSync(asPath)) {
    return { modelPath: asPath, modelId: basename(asPath) };
  }

  if (target.includes('/') || target.includes('\\')) return undefined;

  try {
    const cache = createNodeCartridgeCache(cacheDir ? { rootDir: cacheDir } : {});
    const entries = await cache.list();
    const matches = entries.filter((entry) => entry.id === target);
    if (matches.length === 0) return undefined;

    const chosen = matches.sort((a, b) => a.version.localeCompare(b.version)).pop()!;
    const parsed = parseCartridgeManifest(
      JSON.parse(readFileSync(pathJoin(chosen.cartridgeDir, 'manifest.json'), 'utf8')) as unknown,
    );
    if (!parsed.valid) return undefined;

    const weightsPath = pathJoin(chosen.cartridgeDir, parsed.manifest.weights.path);
    if (!existsSync(weightsPath)) return undefined;
    return { modelPath: weightsPath, modelId: parsed.manifest.id };
  } catch {
    return undefined;
  }
}
