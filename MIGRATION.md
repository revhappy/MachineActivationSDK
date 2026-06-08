# Migration Guide

> Coming from Vercel AI SDK, OpenAI SDK, or Anthropic SDK?
> This is the shortest path from cloud LLM to **the same app running locally** with `machineai-activation`.

## The promise

The drop-in API of `machineai-activation` matches the Vercel AI SDK shape verbatim — `createMachine`, `generateText`, `streamText`, `generateObject`, `tool`. For Vercel AI SDK users this is a **one-import swap**. For OpenAI / Anthropic users it's a small refactor that mostly removes provider-specific scaffolding.

What stays the same: your UI, your prompts, your schemas (any Zod-shaped schema works — Zod is an optional peer dep), your tool definitions, your streaming UX.

What you add: one `ActivationRuntime` adapter that bridges to your chosen local backend (`llama.rn`, `llama.cpp` via `llama-server`, `@mlc-ai/web-llm`, MediaPipe, LiteRT-LM, …). The scaffolder ships five ready-made adapters as templates — see *Reference apps & templates* below.

---

## From Vercel AI SDK

Old:

```ts
import { generateText, streamText, generateObject, tool } from 'ai';
import { openai } from '@ai-sdk/openai';

const { text } = await generateText({
  model: openai('gpt-4o-mini'),
  prompt: 'Summarize: ...',
});
```

New:

```ts
import {
  createMachine,
  generateText,
  streamText,
  generateObject,
  tool,
} from 'machineai-activation';
import { llamaRnRuntime } from './activationRuntime'; // your adapter

const machine = createMachine({ runtimes: [llamaRnRuntime] });

const { text } = await generateText({
  model: machine.model({ filePath: '/models/gemma.gguf' }),
  prompt: 'Summarize: ...',
});
```

Every call site below is identical between the two SDKs — `streamText({ model, prompt }).textStream`, `generateObject({ model, schema, prompt })`, `tool({ description, parameters, execute })`. **You change the import line and the `model:` factory; everything downstream stays put.**

---

## From OpenAI SDK

The OpenAI SDK uses `client.chat.completions.create()`. Translate that pattern to `generateText` / `streamText`:

Old:

```ts
import OpenAI from 'openai';
const client = new OpenAI();

const completion = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'What is 2+2?' },
  ],
});
const text = completion.choices[0].message.content;
```

New:

```ts
import { createMachine, generateText } from 'machineai-activation';
import { llamaRnRuntime } from './activationRuntime';

const machine = createMachine({ runtimes: [llamaRnRuntime] });
const model = machine.model({ filePath: '/models/gemma.gguf' });

const { text } = await generateText({
  model,
  system: 'Be concise.',
  prompt: 'What is 2+2?',
});
```

For streaming, replace `stream: true` + the AsyncIterable over `delta.content` with `streamText({ model, prompt }).textStream`. For structured output, swap `response_format: { type: 'json_schema', ... }` for `generateObject({ model, schema, prompt })` — pass any Zod schema (or any object with a `parse(value)` method).

For tool calling, OpenAI's `tools: [{ type: 'function', function: {...} }]` + the two-roundtrip handshake collapses into:

```ts
const result = await generateText({
  model,
  prompt: 'What time is it?',
  tools: { clock: tool({ description: '...', parameters: schema, execute }) },
  maxSteps: 3,
});
```

The ReAct-style loop runs inside `generateText` — you don't manually feed tool results back.

---

## From Anthropic SDK

Anthropic's `client.messages.create()` maps cleanly:

Old:

```ts
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();

const msg = await client.messages.create({
  model: 'claude-3-5-sonnet-latest',
  max_tokens: 1024,
  system: 'Be concise.',
  messages: [{ role: 'user', content: 'What is 2+2?' }],
});
const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
```

New:

```ts
import { createMachine, generateText } from 'machineai-activation';
import { llamaRnRuntime } from './activationRuntime';

const machine = createMachine({ runtimes: [llamaRnRuntime] });
const model = machine.model({ filePath: '/models/gemma.gguf' });

const { text } = await generateText({
  model,
  system: 'Be concise.',
  prompt: 'What is 2+2?',
  maxTokens: 1024,
});
```

Streaming, structured output, and tool calling translate identically to the OpenAI sections above.

---

## What you need to add: the runtime adapter

Local inference needs *some* backend. `machineai-activation` is backend-agnostic — you bring the engine, the SDK handles capability resolution, session management, streaming, GBNF grammar for structured output, and the ReAct loop for tools.

A minimal adapter:

```ts
import type { ActivationRuntime, ActivationSession } from 'machineai-activation';

export const myRuntime: ActivationRuntime = {
  id: 'my.runtime',
  name: 'My Runtime',
  async createSession(input): Promise<ActivationSession> {
    // load the model at input.filePath, return an ActivationSession that
    // implements complete()/completeChat()/contextState()/abort()/close().
    // …
  },
};
```

Optional richer hooks (`listBackendCapabilities`, `probeDeviceCapabilities`, `probeModelPackage`, `canHandleModel`) let the SDK build better diagnostics and onboarding plans — you can add them after the minimal session runtime works.

---

## Reference apps & templates

Two production reference apps prove the end-to-end shape; both are pure Machine-Activation-SDK call sites:

- **Ingredient Analyzer** (the first reference port).
- **Second Brain** (a local conversational notebook on Electron) at `Second Brain - Activation SDK\`.

Five scaffolder templates ship with `create-machineai-app` — pick the closest match and copy the runtime adapter from it:

| Template | Backend | Adapter source to copy |
|---|---|---|
| `expo-local-chat` | `llama.rn` | `src/llamaRuntime.ts` |
| `rn-cli-local-chat` | `llama.rn` | `src/llamaRuntime.ts` |
| `next-local-chat` | `@mlc-ai/web-llm` | `src/lib/webLlmRuntime.ts` |
| `electron-local-chat` | `llama-server` subprocess (and MediaPipe `.task` via WASM) | `electron/llamaServerRuntime.ts`, `src/mediaPipeRuntime.ts` |
| `node-script` | Node-resolved cartridge | `src/llamaRuntime.ts` |

Run `npx create-machineai-app my-app` and pick a template, or vendor the adapter file into your existing project.

---

## What changes vs. cloud

Below is the honest list of differences — the SDK does **not** pretend cloud and local are identical:

- **Latency profile.** First-token latency is dominated by model load on first session; subsequent calls stream at the underlying tokens/sec. The Activation handshake caches sessions per model spec.
- **Capabilities are resolved, not assumed.** Vision/tool-calling/streaming/structured-JSON are checked against the actual model + backend + device. `client.diagnoseModel()` returns the resolved contract; `client.activateModel()` is permissive by default (advisory warnings, doesn't block).
- **Structured output is grammar-constrained.** `generateObject({ schema })` emits a JSON-Schema → GBNF grammar to llama-family runtimes — the model is constrained at the sampler level, not prompt-only. Zod schemas are passed through `zodSchema(zod)` if you want explicit grammar emission.
- **Tool calling is sampler-constrained when possible.** When every tool's `parameters` self-describes (e.g. via `zodSchema`), the SDK emits a union grammar so the model can only emit `{ answer }` or `{ tool, args }` — eliminating the "model invented a fake tool name" failure mode.
- **One active model at a time (mobile).** On RAM-constrained devices, `createMachine` keeps one session live and reuses it across `generateText`/`streamText` calls. Use `machine.close()` when done.

---

## API parity table

| Vercel AI SDK | `machineai-activation` | Notes |
|---|---|---|
| `generateText({ model, prompt, system, messages, maxTokens, stopSequences, tools, maxSteps })` | same shape | identical call site after import swap |
| `streamText({ model, prompt }).textStream` | same | async iterable of deltas |
| `generateObject({ model, schema, prompt })` | same | any Zod-shaped schema; grammar-constrained on llama-family runtimes |
| `tool({ description, parameters, execute })` | same | ReAct loop inside `generateText` |
| `openai('gpt-4o-mini')` / `anthropic('claude-3-5-sonnet')` | `machine.model({ filePath, modelId? })` or `machine.model({ cartridge: 'id', cartridgeResolver })` | swap the model factory |
| Provider client (`new OpenAI()` / `new Anthropic()`) | `createMachine({ runtimes: [...] })` | the runtime adapter is the local equivalent of a provider |

---

## When to also reach for the activation handshake

The drop-in API hides the activation contract behind sensible defaults. If you want explicit pre-flight or onboarding logic:

```ts
import { createMachineActivationSdk } from 'machineai-activation';

const client = createMachineActivationSdk(runtime).createActivationClient();

const snapshot = await client.diagnoseModel({
  model: { filePath: '/models/gemma.gguf' },
  appRequirements: { textChat: true, streaming: true, structuredJsonOutput: true },
});

if (snapshot.resolvedContract.warnings.length > 0) {
  // surface advisory warnings to the user
}

const plan = await client.buildOnboardingPlan({
  appName: 'My App',
  model: { filePath: '/models/gemma.gguf' },
  appRequirements: { textChat: true },
});
// → turn `plan` into a model picker + install guide
```

See [`GETTING_STARTED.md`](./GETTING_STARTED.md), [`BACKEND_CAPABILITIES.md`](./BACKEND_CAPABILITIES.md), and [`APP_INTEGRATION_PLAYBOOK.md`](./APP_INTEGRATION_PLAYBOOK.md) for the full handshake surface.
