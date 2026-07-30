# Porting an app to a local model

Three app shapes, three seams. Every example here comes from a real port in this
workspace, with what actually broke.

| Your app is… | Use | Reference port |
|---|---|---|
| Node, Next.js, Electron | `llamaServerRuntime` + `ensureLlamaServer` | `Collecta-Local` |
| React Native, Capacitor, browser | `llamaServerRuntime` (portable) or a native adapter | `Ingredient analyzer - Machine Activation SDK` |
| Python, Go, Ruby, Swift — anything not JS | `machine serve` over HTTP (Python: `MachineServer` supervises it) | `Agent On Deck - Local` |

Before any of it, check the model runs on your machine at all:

```bash
machine doctor model.gguf --run
```

That answers the questions a cloud API never raises — will it fit, how long does
it take to load, what acceleration is live, does grammar-constrained JSON work —
before you write a line of integration code.

---

## 1. Node / Next.js / Electron

```bash
npm install machineai-activation
```

```ts
import { createMachine, generateObject } from 'machineai-activation';
import { discoverLlamaServer, ensureLlamaServer } from 'machineai-activation/node';

const serverBinary = discoverLlamaServer(process.cwd());
if (!serverBinary) throw new Error('No llama-server found. See scripts/fetch-llama-cpp.js.');

const { runtime } = await ensureLlamaServer({
  serverBinary,
  modelPath: '/models/model.gguf',
  gpuLayers: 999,          // clamped to the model's real layer count
});

const machine = createMachine({ runtimes: [runtime], compatibilityPolicy: 'permissive' });
const model = machine.model({ filePath: '/models/model.gguf' });

const { object } = await generateObject({ model, schema, prompt });
```

**Use `ensureLlamaServer`, not `startLlamaServer`, in any long-lived host.** It
keeps one server per configuration and swaps it when the model changes. A Next.js
dev server re-evaluates modules on edit; an Inngest worker runs many jobs in one
process. Loading a 4 GB model twice does not just waste time, it exhausts RAM.
Call `closePooledLlamaServer()` on teardown.

### What the Collecta port hit

- **The seam was already there.** Every LLM call went through one funnel,
  `callGemini(args, schema)` → Zod-validated JSON. That maps exactly onto
  `generateObject({ schema })`, so the port was one file, not a refactor. If your
  app has no such funnel, build it *first* — it is the whole difference between a
  provider swap and a rewrite.
- **A vendored `file:` tarball silently froze the SDK.** Collecta pinned a
  tarball built two months before the rename, so it never received the abort,
  `toolChoice`, zod-v4 or tool-grammar fixes — while reporting the same version
  number. Depend on the package, not a snapshot of it.
- **Their hand-written adapter reported `streaming: false`** and dropped
  `reasoning_content`. Both were invisible until the contract was read back.
  See §4.

---

## 2. React Native / Capacitor / browser

The portable entry point has no `node:*` imports, so it bundles anywhere:

```ts
import { llamaServerRuntime } from 'machineai-activation';

const runtime = llamaServerRuntime({ baseUrl: 'http://127.0.0.1:8080' });
```

That covers a device talking to a server elsewhere. For **on-device** inference
you need a native engine, and that adapter is platform-specific:

```bash
npm install machineai-activation machineai-activation-capacitor
```

```ts
import { registerCapacitorMachineActivationRuntime } from 'machineai-activation-capacitor';
registerCapacitorMachineActivationRuntime();   // in your entry file
```

The **native plugin still lives in your app** — a Capacitor plugin has to compile
into the APK. The package's JS bridge looks up `MachineActivation`, so your Kotlin
class needs `@CapacitorPlugin(name = "MachineActivation")`. That one piece cannot
be packaged; everything above it can.

### What the Ingredient Analyzer port hit

- **It was pinned to an abandoned iteration** (`MachineAI-codex/activation-sdk`,
  `0.1.0-alpha.0`) that no longer existed as a maintained tree.
- **Its 381-line local adapter had drifted from the contract.** Typechecking
  against the current SDK immediately found a `capabilitySnapshot` missing
  `schemaVersion` and three `this`-bound calls the contract no longer guarantees.
  Neither would have surfaced before a runtime failure on a device. The fix was
  to delete the file and re-export the package.
- **Check `content://` URIs.** Android's picker returns URIs, not paths. Import
  the file into app storage first, then activate against the resolved path —
  probing a `content://` URI as a filesystem path reports "model not found" for a
  model that is right there.

---

## 3. Python, or any language the SDK does not ship for

```bash
machine serve model.gguf --ctx 8192
```

Then either point an existing OpenAI client at `http://127.0.0.1:8177/v1`, or use
the dependency-free client in `clients/python/machine_activation.py`:

```python
from machine_activation import MachineClient

m = MachineClient()
print(m.activation().summary())        # fit, acceleration, what's degraded

for delta in m.chat_stream([{"role": "user", "content": "..."}]):
    print(delta, end="", flush=True)

data = m.chat_json([{"role": "user", "content": "..."}], schema)   # grammar-constrained
```

`chat_json` is the reason to prefer this over prompt-and-hope: your JSON Schema
is compiled to a GBNF grammar and enforced in llama.cpp's sampler, so the model
is *unable* to emit invalid JSON. Small local models fail "please reply with
JSON" constantly; they cannot fail this.

Endpoints:

| Route | Shape |
|---|---|
| `POST /v1/chat/completions` | OpenAI, streaming or not, honors `response_format` |
| `POST /v1/completions` | OpenAI legacy |
| `GET /v1/models` | OpenAI |
| `GET /machine/activation` | **not** OpenAI — the activation contract |
| `GET /health` | liveness + loaded model |

`/machine/activation` is deliberately its own shape. Load time, memory fit,
acceleration and degradation have no place in a schema designed for an API where
the model is always loaded and always fits.

**Tool calling works**, which is what makes an *agent* portable rather than just
a chat box. Send OpenAI `tools`; the model's decision comes back as
`tool_calls` with `finish_reason: "tool_calls"`, you execute it in your own
process, append a `tool` message, and call again. The envelope is
grammar-constrained by the same code `generateText` uses in-process — a 2-4B
local model asked for an unconstrained tool call is exactly where agentic
behavior falls apart, and that guarantee should not be TypeScript-only.

A tool step over HTTP is never streamed: the response is a grammar-constrained
JSON envelope, and streaming its fragments would emit partial JSON no OpenAI
client can assemble into a `tool_calls` delta. **In-process, it does stream** —
`streamText({ tools })` decodes the answer out of the envelope as it arrives (see
§2). The difference is that an in-process loop owns both ends and can hold back
the tool branch; an OpenAI-shaped wire format cannot.

### Your app should start the server, not your user

`machine serve` on its own is a terminal command, and "open a second terminal
and leave it running" is not something you can ship. The Python client supervises
it for you:

```python
from machine_activation import MachineServer

with MachineServer("model.gguf", ctx=8192) as server:
    m = server.client()
```

It finds the CLI (PATH, `$MACHINE_CLI`, or a `node_modules/.bin` above you),
waits for the weights, restarts on an unexpected death, and — the part that is
easy to get wrong — kills the **whole tree** on the way out. `machine serve`
spawns `llama-server` as a grandchild, so killing the child alone strands the
process actually holding several GB of weights.

Two behaviors worth knowing before you design around it: it **attaches** to a
healthy server already on the port instead of loading a second copy (pass
`port=0` if you want a private one), and `--supervised` makes the server exit
when its stdin closes, which is the only cross-platform way a child learns its
parent was killed.

If you are not in Python, the contract is small enough to reimplement: spawn
`machine serve <model> --supervised --port 0`, read one line of JSON from stdout
(`{"event":"ready","url":…}`), and close stdin to stop it.

### What the Agent on Deck port hit

- **The AI surface was 100% Python**, so the SDK was simply unreachable. `machine
  serve` is what made a port possible at all.
- **Cut at the module boundary, not per-call.** `sidecar/local_model.py` mirrors
  `gemini.py`'s verb signatures and return shapes — including its no-key
  degradation shapes — so call sites switch provider without a local-specific
  branch, and cloud stays the fallback.
- **Count the coverage in code, not in prose.** Of 13 call sites, **7 can run
  locally and 6 cannot** — STT, TTS, bidi speech-to-speech, embeddings and search
  grounding need a different class of engine, not a bigger LLM. `local_model.py`
  encodes this as a `COVERAGE` table with an import-time assertion that every
  verb it calls local actually exists. That guard is there because the prose
  version claimed two verbs the module had never implemented. **A port's coverage
  claim is exactly the kind of thing that rots, so make it executable.**
- **Vision is a second axis.** Four of those seven need `--mmproj`. Without a
  projector the same app covers 3 of 13, and it degrades quietly — `""` and
  text-only answers rather than errors. `coverage_report()["local_now"]` is the
  number that describes the machine in front of you.

---

## 4. Things that bite every port

**Read the contract back; do not assume it.**

```ts
const session = await model.getSession();
console.log(session.resolvedContract.compatibility);   // compatible | degraded | incompatible
console.log(session.resolvedContract.warnings);
```

`degraded` is **not** a failure. Unknown memory headroom, CPU-only fallback and
unverified capabilities are advisories. Only `reasons` block activation. An
earlier version of this stack hard-failed on advisories and the result was
hostile to use — hard-fail on a missing file or an unsupported format, warn on
everything else.

**Thinking models emit their answer on a second channel.** Gemma 4, DeepSeek-R1
and Qwen3 stream chain-of-thought as `reasoning_content`, separate from
`content`. An adapter reading only `content` reports a working model as producing
nothing — a live Gemma 4 E4B run measured **0 tokens and an empty sample** for
exactly this reason. `textStream` carries the answer; use `onReasoning` for the
rest, and budget `maxTokens` for both or the model will think until it runs out.

**Local models return partial JSON, not just wrong JSON.** Even with a grammar,
expect missing optional arrays and nested fields. Normalize between the model and
your UI or you will crash on `undefined.length`.

**Throughput excludes prompt evaluation.** The first token costs a full prompt
eval; folding it into tokens/sec makes a short generation look several times
slower than the model decodes. `tokensPerSecond` measures decode only, as
llama.cpp reports it.

**Loading is not a timeout.** A 4 GB model on a machine with little free RAM pages
in from disk and can take minutes. `ensureLlamaServer` treats `503 loading model`
as progress and only counts *silence* against `healthTimeoutMs`.

**Do not fork the adapter for one missing knob.** `extraBody` passes
backend-specific sampler settings (`min_p`, `repeat_penalty`, …) the contract
does not model. Every duplicated copy of this adapter in this workspace started
as a small local need.

**Test without a model.**

```ts
import { stubRuntime } from 'machineai-activation';
createMachine({ runtimes: [stubRuntime({ respond: () => '{"ok":true}' })] });
```

No binary, no download, no network, and it streams like a real adapter. Collecta
proves its whole capture → extract → persist → file pipeline this way in CI.
