# Platform Matrix

> The product promise is: **plug a local model into any app, on any OS, easily.**
> This file is the honest ledger of how far that actually holds. Update it in the
> same commit as any runtime-adapter change.
>
> Last verified: **2026-07-24.**

---

## Where each platform stands

| Platform | Lane | Runtime adapter | Acceleration | Grammar / structured output | Status |
|---|---|---|---|---|---|
| **Windows x64** | Electron | `llamaServerRuntime.ts` (vendored `llama-server.exe`) | CPU (CUDA/Vulkan via `LLAMA_CPP_ASSET`) | ✅ **verified live** | ✅ **Verified on hardware** |
| **macOS arm64** | Electron | same | GPU (Metal, `--n-gpu-layers 999`) | ✅ forwarded | ⚠️ Wired, untested on hardware |
| **macOS x64** | Electron | same | GPU (Metal) | ✅ forwarded | ⚠️ Wired, untested on hardware |
| **Linux x64** | Electron | same | CPU (CUDA/Vulkan via `LLAMA_CPP_ASSET`) | ✅ forwarded | ⚠️ Wired, untested on hardware |
| **iOS** | Expo / RN CLI | `llamaRuntime.ts` (`llama.rn`) | GPU (Metal) — requested, **observed** via `context.gpu` | ✅ forwarded | ⚠️ Wired, untested on hardware |
| **Android** | Expo / RN CLI | `llamaRuntime.ts` (`llama.rn`) | GPU where available — **observed** | ✅ forwarded | ⚠️ Wired, untested on hardware |
| **Android** (alt) | Capacitor | `machineai-activation-capacitor` (LiteRT / MediaPipe `.task`) | Delegate-dependent | ➖ n/a for `.task` | ⚠️ Needs host-app Kotlin plugin |
| **Browser** | Next.js | `webLlmRuntime.ts` (`@mlc-ai/web-llm`) | WebGPU | ❌ not wired (see below) | ⚠️ Wired, untested |
| **Node / desktop CLI** | `node-script` | Consumer-supplied | — | — | ✅ Bring your own runtime |

**"Wired" means the adapter satisfies the `ActivationRuntime` / `ActivationSession`
contract and typechecks against it.** It does not mean anyone has run a model on
that hardware. **"Verified" means a real GGUF was loaded and generated tokens
through the SDK on that platform.**

Windows x64 is now verified (2026-07-24). macOS, Linux, iOS and Android remain
wired-only — that's still the single biggest risk, and no amount of typechecking
substitutes for it.

---

## Windows x64 — what was actually run (2026-07-24)

First real inference in this project. Hardware: Intel Core i7-10510U, 8 cores,
16 GB RAM, Windows 11. Model: `Qwen2.5-0.5B-Instruct-Q4_K_M.gguf` (379 MB,
qwen2, 494M params, 32,768-token context). Runtime: vendored `llama-server.exe`
from `ggml-org/llama.cpp` `releases/latest`, CPU build.

Observed via `machine doctor --run`:

| Measure | Result |
|---|---|
| Model load | 3.7 s |
| Time to first token | 1.05 s |
| Decode throughput | 12.3 tok/s (decode window only, CPU) |
| Grammar-constrained `generateObject` | ✅ returned `{"language":"French","confidence":0.95}` |
| Acceleration reported | `cpu` (matches the vendored CPU build) |

A separate live harness exercised the rest of this session's SDK changes
against the same model, all passing:

- `streamText` delivered 26 incremental deltas (not one blob at the end).
- The tool loop called a grammar-constrained tool and parsed the args.
- **A tool with no `toJsonSchema` still had its envelope constrained** — the
  model called the tool and answered in 2 steps. This is the §5 fix working on
  a 0.5B model, which has no chance of holding that JSON shape unaided.
- `toolChoice: { toolName }` forced the tool even on a chatty prompt.
- `abortSignal` cancelled an in-flight generation in 731 ms with an
  `AbortError`. Before this session that was impossible.

What this does **not** prove: GPU offload (the vendored Windows build is CPU),
larger models, long contexts, or any non-Windows platform.

---

## What changed on 2026-07-24

### The desktop lane was Windows-only

`scripts/fetch-llama-cpp.js` hardcoded a single asset pattern
(`llama-b{N}-bin-win-cpu-x64.zip`) and extracted to `vendor/llama-cpp/win-x64`
using PowerShell's `Expand-Archive`. macOS and Linux weren't degraded — they were
absent.

Now: a `HOST_TARGETS` table maps `process.platform:process.arch` to the right
release asset, vendor slug, and binary name; extraction uses `unzip` (falling back
to `ditto` on macOS) on POSIX; the executable bit is restored after extraction;
and `LLAMA_CPP_ASSET` overrides the pattern so a developer can vendor a CUDA or
Vulkan build instead. `version.json` now records the asset, slug, binary name, and
acceleration mode, so `llamaServerRuntime.ts` resolves the binary from recorded
fact rather than guessing.

### Three of seven adapters didn't satisfy the contract

`ActivationSession` is:

```ts
complete(prompt: string, options?: ActivationCompletionOptions): Promise<…>
completeChat(messages: ActivationChatMessage[], options?: …): Promise<…>
```

The `expo-local-chat`, `rn-cli-local-chat`, and `next-local-chat` adapters all
declared:

```ts
complete: async ({ prompt, system, maxTokens, stream, signal }) => …
```

— destructuring the **first argument** as an object. Every call from
`generateText` / `streamText` passed a string where an object was expected, so
`prompt` came back `undefined`. They also referenced a `stream` option that does
not exist on `ActivationCompletionOptions` (the real callbacks are `onToken` and
`onChunk`).

This is the same defect the roadmap records fixing in the Electron template in
session 13 — the fix was never back-ported to the other three. All three are now
corrected.

### Grammar was dead on mobile

Both mobile adapters hardcoded `structuredJsonOutput: false`, `toolCalling: false`,
and never forwarded `options.grammar`. Grammar-constrained decoding is what makes
`generateObject` and the `generateText` tool loop reliable on 2–4B models — the
SDK's portable JSON-Schema → GBNF emitter existed and was simply not connected on
the platform that needs it most. Both now call the SDK's
`resolveStructuredOutputGrammar(...)`, which also maps `responseFormat: 'json'` to
the standard JSON grammar for llama-family backends.

### GPU offload was disabled on mobile

Both mobile adapters passed zero GPU layers, pinning inference to the CPU. They
now request a full offload and — better — report **observed** acceleration via
`context.gpu` / `context.reasonNoGPU` / `context.devices`, so the activation
contract states what actually happened instead of a hardcoded assumption. When
offload fails, the reason is surfaced as a contract warning.

### `completeChat` discarded conversation history (Electron)

`llamaServerRuntime.completeChat` collapsed the conversation to
`messages[messages.length - 1]` and sent it as a lone user turn. That broke
multi-turn chat and silently broke the tool loop, which works by appending
`assistant` and `tool` messages. It now forwards the full history.

### The `tool` role is now folded into a user turn

`ActivationChatMessage.role` includes `'tool'`, but most local chat templates
(Gemma, Llama 3, ChatML) have no such role, so passing it through makes the
template mis-render the turn. All three llama adapters plus the web adapter now
map `tool` → `user` with a `Tool result:` prefix. This is `sdkgaps.md` item 5,
resolved at the adapter layer.

### Duplicate system prompt

`generateText`'s tool loop bakes the caller's `system` into `messages[0]` **and**
passes it again as `completionOptions.systemPrompt`. Adapters now only prepend
`systemPrompt` when the history contains no system turn. That's a workaround at
the adapter layer — the real fix belongs in `generateText.ts` (`sdkgaps.md` item 4,
still open).

### `schemaVersion` was a number where the contract wants a string

`ACTIVATION_CONTRACT_SCHEMA_VERSION` is `'1.0.0-alpha.1'`. The mobile, web, and
`ipcRuntime` adapters all hardcoded `schemaVersion: 1`. Fixed; the constant is now
imported everywhere.

---

## The guardrail: `npm run typecheck:adapters`

Every defect above shares one root cause, stated plainly in the roadmap:
*"Templates aren't typechecked in CI so the mismatch never surfaced."*

`packages/create-machine-app/tsconfig.adapters.json` now typechecks all seven
runtime adapters against the real SDK contract via a `paths` mapping to
`../../src/index.ts`. External dependencies are satisfied by hand-written stubs in
`packages/create-machine-app/types/` — the same pattern `packages/ui` already uses
for `react-native`:

| Stub | Covers |
|---|---|
| `llama-rn.d.ts` | `initLlama`, `LlamaContext`, completion params incl. `grammar`, `TokenData` |
| `electron.d.ts` | `app.getAppPath/getPath`, plus `process.resourcesPath` |
| `mediapipe-tasks-genai.d.ts` | `FilesetResolver`, `LlmInference` |
| `mlc-web-llm.d.ts` | `CreateMLCEngine`, `MLCEngine` |

It is wired into `npm run check` for the scaffolder workspace, so
`npm run check:all` covers it. It found the `ipcRuntime` `schemaVersion` bug on its
first run.

**Extending a stub is a smell.** It means an adapter is reaching into backend
internals instead of staying on the `ActivationRuntime` contract. Declare only what
the adapter actually uses.

Templates as a whole remain deliberately un-typechecked — they reference deps that
only exist after scaffolding. Only the adapters, which implement a contract the SDK
defines, are covered.

---

## Known gaps

1. **Only Windows has been run on real hardware.** Every other row above is
   "wired and typechecked," not "verified." Highest-value next step: run one GGUF
   on a Mac, one on Linux, one on an iPhone, one on an Android device.
   `machine doctor --run` is now the tool for it — one command, and it reports
   load time, throughput, observed acceleration and whether grammar works.
2. **`--n-gpu-layers 999` is unconditional on macOS.** A model larger than VRAM
   will thrash. There's no memory-fit preflight in the desktop lane yet, even
   though the SDK has `memoryAssessment` in the contract.
3. **Browser lane has no grammar.** WebLLM supports `response_format` and grammar,
   but it's unverified here, so `structuredJsonOutput` stays `false` rather than
   claiming capability the adapter can't back.
4. **Windows/Linux default to CPU builds.** `LLAMA_CPP_ASSET` lets a developer opt
   into CUDA/Vulkan, but there's no auto-detection of an available GPU.
5. **Capacitor lane is Android-only** and still requires the host app to ship the
   Kotlin plugin — that part can't be packaged.
6. ~~**`abortSignal` is ignored by `generateText`.**~~ Fixed 2026-07-24.
   `ActivationCompletionOptions` gained an optional `abortSignal`; the SDK
   forwards it from `generateText` / `streamText` / `generateObject`, calls
   `session.abort()` when it fires, and checks between tool-loop steps.
   `llamaServerRuntime` chains it into its `fetch` controller so cancellation
   is scoped to one request. The mobile, web and IPC adapters still cancel via
   `session.abort()` only — honoring the signal natively there is a small
   follow-up, not a blocker.
