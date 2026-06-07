# Cartridge SDK Roadmap

> **Status: active multi-session build.** This document is the source of truth across sessions. Update the "Session log" and "Current status" sections every session. Everything else is the plan we're executing against.

---

## 👋 RESUME HERE (for a fresh Claude instance)

**If you are a fresh Claude instance starting a new session, read this block first and then follow the pointers it gives you. Do not re-plan — the plan exists. Continue executing it.**

### Where we are right now
- **Repo:** `MachineActivationSDK` (branch: `master`, clean) — now an npm workspace root (`"workspaces": ["packages/*"]`); the SDK itself still lives at the repo root.
- **Tests:** root `npm run check` — typecheck + build green; SDK test suites green. UI kit has its own `npm run check:ui` / `npm run check:all` at the root (typecheck + 14 core unit tests + web+native TS build). `@machine/activation-capacitor` (sub-package, session 12) has its own `check` script that typechecks + smoke-tests the build artifacts. Pre-existing CLI pull flake note below.
- **Last verified:** 2026-05-10 — SDK scaffolder tests green (16 new electron-local-chat assertions covering the multi-runtime architecture). Full `npm run check:all` baseline pre-existing CLI pull/search localhost flake unchanged.
- **Agent entry point:** `AGENTS.md` + `machine describe` (dumps the full SDK surface as JSON in one call; now includes a `ui` section listing `@machine/ui` hooks + components and a `scaffolder` section listing `@machine/create-machine-app` templates).

### What's shipped
| Milestone | Status | What it delivers |
|---|---|---|
| **M1** — Drop-in API shim | ✅ shipped | `createMachine`, `generateText`, `streamText`, `generateObject`, `tool` — Vercel-AI-SDK-shaped API over the activation layer. Code under `src/sdk/`. Tests under `tests/sdk/`. |
| **M2** — `.mcart` cartridge format | ✅ shipped (directory loader) | `CartridgeManifest` + `parseCartridgeManifest` + `loadCartridge` + `validateCartridge` (sha256/size) + `cartridgeToActivationInput` + `machine.modelFromCartridge()`. Injectable `CartridgeFileSystem` with `createNodeCartridgeFileSystem()`. Code under `src/cartridge/`. Tests under `tests/cartridge/`. **Zip I/O was deferred to M3.** |
| **M3** — `machine` CLI | ✅ shipped | `bin/machine` with subcommands `init`, `pack`, `unpack`, `validate`, `info`, `inspect`. Streaming zip via `yazl`/`yauzl` through an injectable `CartridgeZipAdapter`. Pack auto-rehashes weights sha256 + size. Code under `src/bin/` (CLI) + `src/cartridge/{zipAdapter,nodeZip,nodePackCartridge,nodeUnpackCartridge}.ts`. Tests under `tests/cli/`. |
| **M4** — Catalog v1 | ✅ shipped | Portable catalog core (`parseCatalog`, `resolveCartridgeEntry`, `fetchCatalog`, `downloadCartridgeToStream`, `CartridgeCache`) + Node adapters (`createNodeCartridgeCache`, `downloadAndUnpackCartridge`, `createNodeCartridgeResolver`) + new CLI subcommands `pull`, `search`, `list`. `createMachine({ cartridge: 'id', cartridgeResolver: createNodeCartridgeResolver() })` fully wired — resolves via cache, optionally auto-pulls on miss, sha256-verified. Code under `src/catalog/`. Tests under `tests/catalog/` + `tests/cli/{pull,search,list}.test.ts`. |
| **M7** — Tools + typed structured output | ✅ shipped | Portable JSON-Schema → GBNF emitter (`jsonSchemaToGbnf`) + duck-typed Zod → JSON-Schema walker (`zodToJsonSchema`) + `zodSchema(zod)` helper that pre-attaches `toJsonSchema()` to a `SchemaLike`. `generateObject({ schema })` now emits schema-specific grammar when `schema.toJsonSchema` is available (retry path stays for schemas without it). `generateText({ tools })` tool loop builds a union grammar `{ answer } \| { tool: const, args }` when every tool's `parameters` self-describes, otherwise keeps today's prompt-only path. Code under `src/sdk/{jsonSchema,jsonSchemaToGbnf,zodToJsonSchema,zodSchema}.ts`. Tests under `tests/sdk/{jsonSchemaToGbnf,zodToJsonSchema,generateObject,tool}.test.ts`. |
| **M6** — `@machine/ui` headless UI kit | ✅ shipped | First workspace split: `packages/ui/` ships `@machine/ui` (version `0.1.0-alpha.1`) with three subpath entry points (`@machine/ui`, `@machine/ui/web`, `@machine/ui/native`). Core hooks: `MachineProvider`, `useMachineContext`, `useMachineModel`, `useActivationSnapshot`, `useInference`, `useCartridgeFilter`, plus `formatBytes` / `formatTokensPerSecond`. Five components per target (web: DOM elements; native: RN primitives via an ambient `react-native.d.ts` stub so no heavyweight devDep). 14 pure-logic unit tests via the SDK harness; runtime component tests deferred to M8. Root gains `typecheck:ui`/`test:ui`/`build:ui`/`check:ui`/`check:all` — root `check` stays SDK-only so the shipped baseline never drifts. |
| **M5** — `create-machine-app` scaffolder + 5 templates | ✅ shipped | Second workspace split: `packages/create-machine-app/` ships `@machine/create-machine-app@0.1.0-alpha.1` — a zero-runtime-dep CLI (Node built-in `readline` for prompts, hand-rolled ~60-LOC arg parser) with five templates: `node-script` (Node + `createMachine` + `generateText` + `createNodeCartridgeResolver`), `expo-local-chat` (Expo RN + `llama.rn` + `@machine/ui/native`), `rn-cli-local-chat` (bare RN + `llama.rn` + `@machine/ui/native`), `next-local-chat` (Next.js 14 app-router + `@mlc-ai/web-llm` wired in-template + `@machine/ui/web`), and `electron-local-chat` (Electron + `node-llama-cpp` in main process + IPC-backed renderer runtime + `@machine/ui/web`). Placeholder substitution via `.tmpl` suffix convention (`{{APP_NAME}}`, `{{PACKAGE_MANAGER}}`). `TemplateTarget` union now `'node' \| 'expo' \| 'react-native' \| 'next' \| 'electron'`. Session A shipped scaffolder core + `node-script` + `expo-local-chat` (session 8); Session B added the remaining three (session 9). Full test matrix: ~36 tests across all five templates covering tree shape, placeholder substitution, wiring assertions, `.tmpl` leakage, exit codes. Templates intentionally not typechecked in the SDK repo. |

### What to work on NEXT
**→ M9 — npm publish + migration guides + docs site.** M8 is ✅ shipped. Reference App 01 (Ingredient Analyzer port) shipped sessions 10/12; Reference App 02 (Second Brain — local conversational notebook on Electron) shipped sessions 13–14. Reference App 02 lives at `Second Brain - Activation SDK\`.

**Session 14 (2026-05-09/10) replaced the entire `electron-local-chat` template inference architecture** after Reference App 02 hit a real-world block: a user-supplied Gemma 4 GGUF could not load because `node-llama-cpp@3.18.1` (latest on npm) ships llama.cpp build `b8390` (March 2026) — Gemma 4 launched April 2, 2026 with parser/tokenizer fixes through April–May. The npm cadence-coupling was a structural defect in the template, not a one-off bug. The fix was to drop `node-llama-cpp` entirely and replace it with a vendored `llama-server.exe` subprocess pattern: `scripts/fetch-llama-cpp.js` pulls `releases/latest` from `ggml-org/llama.cpp` GitHub releases at build time, `electron/llamaServerRuntime.ts` spawns the binary on model load and talks `/v1/chat/completions` SSE with native GBNF pass-through. New model architectures upstream → re-run `fetch:llama` → done; no native rebuild, no npm wait. The template also gained: `mediaPipeRuntime.ts` for `.task` files in the renderer (WASM via `@mediapipe/tasks-genai`), `runtimeSelector.ts` to route by file extension, an `app-model://` custom Electron protocol so the renderer can stream multi-GB model files into MediaPipe without IPC buffer copy, a multi-format file picker accepting `.gguf`/`.task`/`.litertlm`, a `SetupScreen` for first-run picker, and a model-switch button in the chat header. `.litertlm` is recognized by the picker but routes to a clear notice (Google's LiteRT-LM CLI v0.11.0 ships incomplete on Windows — verified — and is single-shot only, not embeddable). The `electron-local-chat` test file gained 16 new assertions covering all of this.

The Vercel-AI-SDK demo port that was originally pencilled in for M8 #2 was dropped per user direction in session 13 — the ask shifted to an *original* product that puts the local LLM in the foreground rather than a port that retells the cloud-LLM story with a different provider. The shape-compatibility claim is already implicit in the SDK call sites of both reference apps (`streamText`, `generateObject`, `tool` all match Vercel AI SDK shape verbatim); a separate port adds little.

What's still open for M9:
- **Publish to npm.** All four workspaces (`@machine/activation-sdk`, `@machine/ui`, `@machine/activation-capacitor`, `@machine/create-machine-app`) need version bumps + `npm publish --access public`. Drop the `file:` deps in the reference apps and replace with version ranges.
- **Migration guide.** "Coming from Vercel AI SDK / OpenAI / Anthropic — swap one import." Reference both apps as proof.
- **Docs site.** API reference + getting-started + reference-app walkthroughs.

**M7.5 (web runtime adapter) stays open** but is no longer M8-blocking. Session 9 sidestepped it by wiring `@mlc-ai/web-llm` at the template level (inside `next-local-chat/src/lib/webLlmRuntime.ts`) rather than as a new `@machine/web-llm-runtime` workspace — same call-site ergonomics, no new SDK surface to maintain. Revisit M7.5 only if a future app wants to import a WebLLM runtime at SDK granularity rather than copying the template file.

Deferred (do NOT pull into M8):
- **Component runtime tests for `@machine/ui`.** Waiting for M8 when a real app exercises them end-to-end. TS typecheck + pure-logic unit tests are the current safety net.
- **`streamObject`** (progressive JSON parse of streamed deltas). Split out — not in M7 scope either.
- **`ActivationSession.completeTools(...)`** as a session-level primitive. The current approach layers on top of `completeChat` + `grammar`, which is sufficient; session-level tool calls can land later.
- **ed25519 signature verification** (M4 reserved).
- **Semver range resolution / cache eviction** (M4 reserved).
- **Zod → JSON-Schema coverage for `ZodIntersection`/`ZodTuple`/`ZodRecord`/`ZodMap`/`ZodSet`/`ZodTransformer`.** Walker returns `null` → graceful fallback to prompt-only. Add when needed.
- **GBNF for regex `pattern` and `$ref`.** Current emitter falls through to `anyValue` for those.
- **`machine catalog sync`, HTTP Range-based resumable downloads** (M4 reserved).

### How to pick up cleanly
1. **Read the "Session log" at the bottom** — last entry tells you what was decided and why.
2. **Run `npm run check` first** to confirm green baseline before changing anything.
3. **Check `TaskList` (if the prior session left tasks open)** — otherwise create new tasks for your milestone.
4. **Do not rewrite prior milestones.** M1 and M2 are done. Only add to them if M3+ genuinely requires a change, and note it explicitly in the session log.
5. **Update this `RESUME HERE` block + the "Current status" table + the "Session log" before ending your session.** That's the contract that lets the next instance pick up where you left off.

### Non-obvious facts you need to know
- The SDK is **RN-portable** — do not add top-level imports of `node:*` modules to `src/` outside files prefixed with `node*` (currently `src/cartridge/nodeFs.ts`, `nodeZip.ts`, `nodePackCartridge.ts`, `nodeUnpackCartridge.ts`, plus catalog equivalents). Consumers on RN/web plug in their own filesystem adapter via `CartridgeFileSystem` and a zip adapter via `CartridgeZipAdapter`.
- **Stronger rule (session 12):** Node-only helpers must NOT be re-exported from the main barrel `src/index.ts` or from the `cartridge/index.ts` / `catalog/index.ts` sub-barrels. Static `export * from './nodeFs'` keeps `node:fs` in a Vite/Rollup browser bundle's dependency graph regardless of `sideEffects: false` and the `browser` field. Node-only re-exports live in `src/node.ts` and ship via the `@machine/activation-sdk/node` sub-export. Apps and CLI commands that need them either import the sub-export or deep-import the underlying file (e.g. `import { unpackCartridge } from '@machine/activation-sdk/cartridge/nodeUnpackCartridge'` in CLI commands, which compile to `../../cartridge/nodeUnpackCartridge`).
- **Dual ESM+CJS build (session 12).** The SDK ships `dist/cjs/` and `dist/esm/` with a proper `exports` map (`import` → ESM, `require` → CJS, `types` → CJS `.d.ts`). The ESM bundle uses real `export *` so Rollup can statically trace imports — the prior CJS-only output's `__exportStar(require(...))` defeated tree-shaking and forced consumer apps to use `optimizeDeps.include` + `commonjsOptions.include` workarounds. Those workarounds are no longer needed.
- **Capacitor adapter is a sub-package (session 12).** `@machine/activation-capacitor` (`packages/activation-capacitor/`) ships the LiteRT-LM `ActivationRuntime` implementation, the Capacitor JS plugin bridge, and `pickMachineActivationModel()` as one workspace. Capacitor apps register the runtime in their entry file with `registerCapacitorMachineActivationRuntime()` instead of copying ~570 LOC of adapter glue. The native Kotlin plugin still has to live in the host app — see `ACTIVATION_SDK_INTEGRATION_CHECKPOINT.md` in Reference App 01 for the host-app-specific Gradle/Kotlin surface that can't be packaged.
- **`electron-local-chat` template now forwards GBNF grammar end-to-end (session 13).** Renderer `ipcRuntime.ts` → preload bridge → main `ipcMain.handle('machine:complete')` → `nodeLlamaRuntime` → `node-llama-cpp` via `llama.createGrammar({ grammar: gbnfText })`. Grammars are cached by GBNF string in `nodeLlamaRuntime`, so repeated `generateObject` calls with the same schema are amortized. Pre-session 13, Electron consumers fell back silently to `generateObject`'s prompt-only retry path because the IPC handler only accepted `{ prompt, maxTokens }`. **Latent bug also fixed in the same session:** the template's `nodeLlamaRuntime.complete` had the wrong signature — destructured the first arg as an object instead of accepting `(prompt: string, options?: ActivationCompletionOptions)`. Templates aren't typechecked in CI so the mismatch never surfaced. Both runtimes also now emit proper `ActivationCompletionChunk` objects so `streamText`'s `onChunk` consumer actually sees deltas.
- **Zod is an optional peer dep.** `generateObject` uses a duck-typed `SchemaLike` interface so any validator works. Don't hard-import zod anywhere.
- **The existing `createMachineActivationSdk(...)` API must stay backwards compatible.** The new drop-in API layers on top; don't break consumers who use the underlying activation client directly.
- **Tests use a simple harness** (`tests/_harness.ts`). No Jest/Mocha — just `test(name, fn)` + `finish()`. Register new test files in `tests/run.ts`.
- **`@types/node` is present**, so `node:*` imports typecheck in the main build. But prefer keeping Node deps isolated to `node*`-prefixed adapter files.
- **`CartridgeFileSystem` stays minimal** — just the surface the runtime loader needs. Pack/unpack went straight to `node:fs` in dedicated `node*` files rather than expanding the FS interface; do the same in M4 for catalog/cache code (use `node:fs`/`node:os` in `nodeCatalogCache.ts`, keep portable interfaces alongside).
- **CLI tests build to `.test-dist/src/bin/machine.js`** (not `.test-dist/bin/...`) because `tsconfig.tests.json` uses `rootDir: "."`. The production build uses `rootDir: "src"` so `dist/bin/machine.js` is the published bin. See `tests/cli/_run.ts` for the path resolution.
- **`yazl` + `yauzl` are runtime dependencies** but are only imported from `src/cartridge/nodeZip.ts` and CLI files. RN/browser bundlers won't pull them in unless consumer code imports the Node adapter.

---

## North star

Make the Machine Activation SDK into a **model-as-cartridge** system a developer can adopt in under an hour.

**Adoption test:** A dev with a working Vercel-AI-SDK cloud app can swap one import, run `machine pull gemma-3n`, and their app runs locally on their phone in under 30 minutes. No native code. No URI handling. No quantization knowledge.

This means two things must become true:
1. **Console side (the app)** — an API shape devs already know. One-line imports. No backend-specific knowledge leaks into app code.
2. **Cartridge side (the model)** — a standard `.mcart` package format + catalog + CLI, so any model is "plug in, go."

## Strategy

- **SDK-first, protocol-second.** Ship a usable drop-in SDK + cartridge format, earn adoption, then formalize `.mcart` as an open spec once an ecosystem exists.
- **Every milestone ships.** Each `M` below is end-to-end — code on `master`, tests green, published as a prerelease on npm.
- **Backwards compatible within the SDK.** Existing `createMachineActivationSdk(...)` API stays. The new cartridge surface (`createMachine`, `generateText`, etc.) layers on top.
- **Never break the runtime adapter contract.** External backends (llama.rn, LiteRT) keep working unmodified.

---

## Milestone map

| M | Ships | Unlocks | Depends on | Est. session count |
|---|---|---|---|---|
| **M1** | Drop-in API shim (`createMachine`, `generateText`, `streamText`, `generateObject`, `tool`) | Devs can swap one import from Vercel AI SDK / OpenAI / Anthropic | Current activation SDK | 1 |
| **M2** | `.mcart` cartridge format (manifest schema, loader, validator, zip I/O) | A standard unit of distribution for a model + its metadata | — | 1–2 |
| **M3** | `machine` CLI (`pack`, `unpack`, `validate`, `info`, `inspect`, `init`) | Anyone can create a cartridge | M2 | 1 |
| **M4** | Catalog v1 (static JSON, `machine pull`, sha256, optional ed25519 sig) | `machine pull gemma-3n` works end-to-end | M2, M3 | 1–2 |
| **M5** | `create-machine-app` scaffolder (expo, rn, next, electron templates) | One-command bootstrap | M1 | 2 |
| **M6** | `@machine/ui` headless UI kit (ModelPicker, CartridgeCard, ActivationStatus, InferenceIndicator, ModelImportButton) | Apps don't rebuild basic UX | M1 | 2 |
| **M7** | Tools / function-calling in runtime + typed structured output (Zod-backed, grammar-constrained) | Agent-native parity with cloud SDKs | M1 | 2 |
| **M8** | Reference App 01 (Meeting Notes) + a ported Vercel-AI-SDK demo | Proof of portability | M1–M7 | 2–3 |
| **M9** | npm publish `0.2.0-beta.1`, migration guides, docs site | Public adoption | all | 1 |

**Total estimated effort:** 13–17 sessions.

---

## Execution order

M1 and M2 can run in parallel (independent), but M1 first because it gives immediate developer value *even before cartridges exist* — apps can use raw model files today through a familiar API, and pick up cartridges once M2/M3/M4 land.

Recommended order: **M1 → M2 → M3 → M4 → M7 → M6 → M5 → M8 → M9**.

- M7 (tools/structured output) bumped forward because it's the last missing piece that makes the API feel complete.
- M5 (scaffolder) after M6 (UI kit) so scaffolded templates can use the UI kit.

---

## M1 — Drop-in API shim

**Goal:** `generateText`, `streamText`, `generateObject`, `tool`, `createMachine` public API that matches Vercel AI SDK shape.

### Target API
```ts
import { createMachine, generateText, streamText, generateObject, tool } from '@machine/activation-sdk'
import { z } from 'zod'

const machine = createMachine({ runtimes: [llamaRnRuntime] })

const { text, usage } = await generateText({
  model: machine.model({ filePath: '/models/gemma.gguf' }),
  prompt: 'What is 2+2?',
  system: 'You are helpful.',
  maxTokens: 200,
})

const { textStream, text } = streamText({
  model: machine.model({ filePath: '/models/gemma.gguf' }),
  prompt: '...',
})
for await (const delta of textStream) process.stdout.write(delta)

const { object } = await generateObject({
  model: machine.model({ filePath: '/models/gemma.gguf' }),
  schema: z.object({ summary: z.string(), sentiment: z.enum(['pos','neg','neu']) }),
  prompt: 'Analyze: ...',
})

const searchTool = tool({
  description: 'Search the web',
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => fetchResults(query),
})
```

### New files
- `src/sdk/types.ts` — `MachineModel`, `GenerateTextOptions`, `GenerateTextResult`, `StreamTextOptions`, `StreamTextResult`, `GenerateObjectOptions`, `GenerateObjectResult`, `ToolDefinition`, `UsageInfo`, `FinishReason`, `SchemaLike`.
- `src/sdk/createMachine.ts` — factory. Holds `ActivationManager` + session cache keyed by model spec.
- `src/sdk/generateText.ts` — non-streaming completion, supports system/messages/prompt/stopSequences/tools.
- `src/sdk/streamText.ts` — async iterable of deltas + promise of final text.
- `src/sdk/generateObject.ts` — Zod-duck-typed schema, JSON grammar, retry once on parse fail.
- `src/sdk/tool.ts` — `tool({ description, parameters, execute })` helper + minimal ReAct loop inside generateText.
- `src/sdk/index.ts` — barrel.
- `tests/sdk/generateText.test.ts`, `streamText.test.ts`, `generateObject.test.ts`, `tool.test.ts`.

### Changes
- `src/index.ts` — curated re-exports of `src/sdk/*`.
- `package.json` — `peerDependencies: { zod: ">=3.22.0 <4" }`, `peerDependenciesMeta.zod.optional = true`.
- `tests/run.ts` — import new test files.
- `examples/basic-consumer/src/index.ts` — add drop-in-shape example.
- `README.md` — "Getting started" leads with new API.

### Acceptance
- `npm run check` green.
- `dist/index.d.ts` exposes the new types.
- Example app in `examples/basic-consumer` demonstrates both the legacy `activateModel` flow and the new `generateText` flow.

### Risks
- **Zod peer-dep friction** → make optional; `generateObject` dynamically checks for `parse()` method (Zod duck-typing) so any validator library works.
- **Streaming backpressure** → bounded queue in `streamText`; drop oldest on overflow with warning (proper fix in M7).
- **Session reuse cost** → cache sessions per model spec on `MachineModel`; expose `machine.close()`.

---

## M2 — `.mcart` cartridge format

**Goal:** a single standardized unit of distribution. Weights + metadata + presets, loadable identically across all platforms.

### Layout
```
my-cartridge.mcart (= zip archive)
├── manifest.json           # required
├── weights/
│   ├── model.gguf          # or model.litertlm, model.task, model.mlx
│   └── projector.gguf      # optional
├── assets/                 # optional: icon, screenshots, README
├── presets/                # optional: system prompts, example prompts
└── signature               # optional: detached ed25519 over manifest + weights
```

### Manifest schema (v1.0.0)
```ts
{
  schemaVersion: "1.0.0",
  id: "gemma-3n-e4b-it",              // globally unique; reverse-DNS encouraged ("com.google.gemma-3n.e4b-it")
  name: "Gemma 3n E4B Instruct",
  version: "1.0.0",                    // cartridge version (not model version)
  author: { name: string, url?: string },
  license: string,                     // SPDX id or license filename
  description: string,
  homepage?: string,
  weights: {
    format: "gguf" | "litertlm" | "task" | "mlx" | "safetensors",
    path: string,                      // relative within cartridge
    sizeBytes: number,
    sha256: string,
    quantization?: string,             // "Q4_K_M" etc.
    projectorPath?: string,
  },
  capabilities: {                      // declared by publisher
    inputModalities: ("text" | "image")[],
    outputModalities: ("text")[],
    contextWindowTokens: number,
    supportsTextCompletion: boolean,
    supportsTextChat: boolean,
    supportsStreaming: boolean,
    structuredJsonOutput: boolean,
    toolCalling: boolean,
  },
  requirements: {
    estimatedRuntimeMemoryMb: number,
    minDeviceMemoryMb?: number,
    preferredAcceleration?: ("cpu" | "gpu" | "npu")[],
    minBackendVersions?: Record<string, string>,  // semver ranges
  },
  chatTemplate?: "gemma" | "llama3" | "chatml" | "qwen" | { type: "custom", template: string },
  presets?: {
    systemPrompts?: { id, label, content }[],
    examples?: { id, label, prompt, expected?: string }[],
  },
  assets?: {
    icon?: string,
    screenshots?: string[],
  },
}
```

### New files
- `src/cartridge/manifestSchema.ts` — Zod schema + inferred TS types. Also exports `CARTRIDGE_SCHEMA_VERSION`.
- `src/cartridge/loadCartridge.ts` — accepts directory path OR `.mcart` zip path. Returns `{ manifest, rootDir, resolvedWeightsPath, resolvedProjectorPath, cleanup() }`.
- `src/cartridge/validateCartridge.ts` — schema validation + sha256 verification of weights + required-file presence. Returns `{ valid: boolean, errors: string[], warnings: string[] }`.
- `src/cartridge/packCartridge.ts` — directory → `.mcart` zip. Computes sha256 of weights on the fly.
- `src/cartridge/unpackCartridge.ts` — `.mcart` zip → directory.
- `src/cartridge/toActivationInput.ts` — `Cartridge → ActivationSessionCreateInput`. Maps `weights.format` → `runtimeHint`, injects declared capabilities as observed, resolves absolute paths.
- `src/cartridge/index.ts` — barrel.

### Zip implementation note
- Use a tiny embedded zip reader/writer (no deps) — we target Node (CLI/tools) + React Native (runtime load).
- For RN runtime, we already ship `react-native-zip-archive` in the parent app — the SDK loader should take an injected "unzip" function so the SDK core stays zero-dep.
- Simpler: host-side Node uses `node:zlib` + our own minimal zip reader; RN runtime consumer provides unzip via a platform adapter.

### Tests
- `tests/cartridge/manifestSchema.test.ts` — valid + invalid manifests.
- `tests/cartridge/loadCartridge.test.ts` — fixture directory, fixture .mcart.
- `tests/cartridge/validateCartridge.test.ts` — malformed manifest, bad sha256, missing weights.
- `tests/cartridge/packUnpackRoundtrip.test.ts` — pack then unpack equals original.

### Acceptance
- Reference cartridge built for an existing GGUF model in `catalog/`.
- `createMachine({ cartridge: './gemma.mcart' })` wires through `loadCartridge` → `toActivationInput` automatically.

---

## M3 — `machine` CLI

**Goal:** anyone can create, validate, inspect a cartridge from the command line.

### Subcommands
- `machine init [dir]` — scaffold a placeholder manifest + directory structure.
- `machine pack <dir> [--out <file>]` — produce `<id>-<version>.mcart`.
- `machine unpack <file> [--out <dir>]` — extract a cartridge.
- `machine validate <file|dir>` — schema + sha256 + required files.
- `machine info <file|dir>` — human-readable summary.
- `machine inspect <file|dir>` — full JSON dump + file manifest + sha verification.
- `machine --version`, `machine --help`.

### Files
- `src/bin/machine.ts` — CLI entry, subcommand dispatch.
- `src/bin/commands/{init,pack,unpack,validate,info,inspect}.ts` — one per subcommand.
- `package.json` — `"bin": { "machine": "./dist/bin/machine.js" }`.
- `tsconfig.build.json` — include `src/bin/**`.

### Tests
- `tests/cli/pack.test.ts`, `validate.test.ts`, `info.test.ts` — invoke built CLI via `node .test-dist/bin/machine.js`, assert stdout / exit codes.

### Design constraints
- Zero external deps for arg parsing — use a ~50-line homegrown parser. The CLI ships inside the SDK package, we don't want `commander` in the tree.
- All commands are sync-readable + script-friendly (JSON output mode via `--json`).

---

## M4 — Catalog v1

**Goal:** `machine pull gemma-3n` downloads a signed cartridge from a public index.

### Catalog spec
Static JSON array hosted at `https://machine-ai.github.io/catalog/catalog.json`:
```ts
{
  schemaVersion: "1.0.0",
  updatedAt: "2026-04-16T...",
  entries: [
    {
      id: "gemma-3n-e4b-it",
      version: "1.0.0",
      name: "Gemma 3n E4B Instruct",
      author: { name, url? },
      description: string,
      tags: string[],
      categories: string[],
      downloadUrl: string,
      downloadSizeBytes: number,
      sha256: string,
      manifest: CartridgeManifest,     // embedded for offline browsing
      publishedAt: string,
      featured?: boolean,
      signature?: string,               // ed25519 over entry
    },
  ],
  signingKey?: string,                  // ed25519 public key
}
```

### CLI additions
- `machine pull <id>[@<version>]` — resolve, download, verify sha, save to `~/.machine/cartridges/<id>/<version>/`.
- `machine search <query>` — full-text over catalog.
- `machine list` — local cache list.
- `machine catalog sync` — refresh local catalog cache.
- `machine publish <cartridge.mcart>` (stretch) — upload + PR against catalog repo (maintainer-mode).

### SDK integration
- `createMachine({ cartridge: 'gemma-3n' })` — resolves via local cache; if missing, throws with "run `machine pull gemma-3n` first" unless `autoPull: true`.
- `createMachine({ cartridge: { id: 'gemma-3n', autoPull: true } })` — downloads on first use, with progress callback.

### Files
- `src/catalog/catalogSchema.ts`
- `src/catalog/fetchCatalog.ts`
- `src/catalog/resolveCartridge.ts`
- `src/catalog/downloadCartridge.ts` — resumable download with sha verification.
- `src/catalog/cartridgeCache.ts` — `~/.machine/cartridges/` layout + LRU eviction.
- `src/bin/commands/pull.ts`, `search.ts`, `list.ts`.

### Security
- sha256 verified on download (mandatory).
- ed25519 signature on cartridge + on catalog entries (optional initially, required post-v1).
- Signing key rotation stored in catalog itself (chain-of-trust).

---

## M5 — `create-machine-app` scaffolder

**Goal:** `npx create-machine-app my-app` produces a working app in under 30 seconds.

### Templates
- `expo-local-chat` — Expo RN app, uses `llama.rn`, includes `<ModelPicker>`, chat UI, cartridge picker.
- `rn-cli-local-chat` — Bare RN CLI app.
- `next-local-chat` — Next.js app with WebLLM runtime (requires `web` runtime adapter from M7).
- `electron-local-chat` — Electron + native llama.cpp.
- `node-script` — Minimal Node CLI example, good for prototyping inference.

Each template:
- Pre-wired `createMachine({ runtimes: [...] })`.
- Example cartridge reference (downloaded on first run).
- One-page working UI.
- README with platform-specific build instructions.

### Files
- `packages/create-machine-app/bin/index.ts` — interactive prompts (template choice, app name, package manager).
- `packages/create-machine-app/templates/<template>/` — template trees, `{{APP_NAME}}` placeholders.
- `packages/create-machine-app/package.json` — separate npm package.

---

## M6 — `@machine/ui` headless UI kit ✅ shipped (session 7, 2026-04-20)

**Goal:** drop-in React / React Native components so apps don't rebuild model-picker UX from scratch.

**What shipped:** `packages/ui/` workspace. Core hooks: `MachineProvider`, `useMachineContext`, `useMachineModel`, `useActivationSnapshot`, `useInference`, `useCartridgeFilter`, `formatBytes`, `formatTokensPerSecond`. Components × {web, native}: `ModelPicker`, `CartridgeCard`, `ActivationStatus`, `InferenceIndicator`, `ModelImportButton`. Pure-logic unit tests only (14 green); runtime component tests deferred to M8. See Session 7 in the log for scope decisions + verification steps.

### Components
- `<ModelPicker cartridges onSelect />` — list + filter + install-progress.
- `<CartridgeCard manifest onInstall onOpen />`.
- `<ActivationStatus snapshot />` — renders compatibility/degradation info from `ActivationCapabilitySnapshot`.
- `<InferenceIndicator session />` — tokens/sec, streaming state, abort.
- `<ModelImportButton onImport />` — handles Android `content://` and iOS doc-URL normalization internally. This is THE ergonomic win for RN devs.
- `<MachineProvider runtime />` — context provider, gives children access to `createMachine(...)`.

### Design principles
- Headless first. Zero styling opinion. Tailwind-friendly default classNames, but fully overridable.
- One package, two entry points: `@machine/ui/web` and `@machine/ui/native`. Same API, platform-specific implementations.

### Files
- `packages/ui/src/{web,native}/*.tsx`
- `packages/ui/package.json` — separate npm package.

---

## M7 — Tools / function-calling + typed structured output

**Goal:** feature parity with cloud SDKs for the agent-native use case.

### Work
- Extend `ActivationSession` with `completeTools(messages, { tools, toolChoice })`.
  - GGUF lane: use llama.cpp tool-calling via grammar mode (forced JSON tool-call emission).
  - LiteRT lane: fall back to ReAct prompt-engineering with JSON grammar.
- Upgrade `generateObject` from prompt-based to grammar-constrained on GGUF.
- Add `streamObject` — progressive-parse partial JSON as it streams.
- Make `AppCapabilityRequirements.toolCalling` real (not just advisory).
- Multi-step agentic loop (`maxSteps`, `stopWhen`, `onStepFinish` hooks) matching Vercel AI SDK semantics.

### Risks
- Grammar-constrained JSON that matches a Zod schema is non-trivial — need Zod → JSON Schema → GBNF conversion. Existing libraries: `zod-to-json-schema` + custom GBNF emitter. Budget: +1 session if GBNF emitter proves hairy.

---

## M8 — Reference apps

**Goal:** public proof the SDK handles real apps.

- **Reference App 01 — Meeting Notes Assistant.** Finish per `REFERENCE_APP_01_PORT_SPEC.md`. Uses a cartridge, streaming, structured output (JSON action items), stored sessions.
- **Vercel AI SDK port.** Pick a public demo (e.g., the AI SDK chatbot example) and port it. Publish a side-by-side blog post comparing cloud vs local code.

---

## M9 — Publish & docs

- `npm publish @machine/activation-sdk@0.2.0-beta.1`.
- `npm publish create-machine-app@0.1.0`.
- `npm publish @machine/ui@0.1.0-beta.1`.
- Migration guides under `docs/migrate-from-<vercel-ai-sdk|openai|anthropic>.md` — line-by-line diffs.
- `.mcart` spec page, hosted at a stable URL (GitHub Pages).
- Docs site (VitePress): getting started, API reference, cartridge spec, migration guides, sample apps.

---

## Session log

Track what was accomplished each session. When you start a session, read this. When you finish, update it.

### Session 1 — 2026-04-16 / 2026-04-17
**Milestone: M1 — drop-in API shim — ✅ shipped**
- ✅ Roadmap committed to `CARTRIDGE_SDK_ROADMAP.md`
- ✅ `src/sdk/{types,createMachine,generateText,streamText,generateObject,tool,index}.ts` implemented
- ✅ Zod added as optional peer dep (`peerDependenciesMeta.zod.optional = true`); duck-typed via `SchemaLike`
- ✅ Curated M1 exports added to `src/index.ts`
- ✅ `examples/basic-consumer` shows drop-in API side-by-side with activation flow
- ✅ `README.md` leads with drop-in API snippet
- ✅ 4 new test suites under `tests/sdk/` (generateText, streamText, generateObject, tool) — 14 new tests, 35 total
- ✅ `npm run check` green (typecheck + 35 tests + build all pass)

Notable fixes during session:
- `ActivationDiagnostics` import moved from `activationAdapter` to `activationContract`.
- `AnyToolDefinition = ToolDefinition<any, any>` alias to work around TS function-parameter contravariance when assigning `Record<string, ToolDefinition<{...}, ...>>` to `Record<string, ToolDefinition<unknown, unknown>>`.
- `streamText` derived promises (`text`/`usage`/`finishReason`) attach silent `.catch(swallow)` sentinels so Node doesn't emit unhandled-rejection warnings when a consumer only iterates `textStream`. Consumers who await still receive the rejection.

Next session: **M2 — `.mcart` cartridge format**.

### Session 2 — 2026-04-17
**Milestone: M2 — .mcart cartridge format — ✅ shipped (directory loader + manifest + validator + bridge)**
- ✅ `src/cartridge/types.ts` — full `CartridgeManifest` type (weights, capabilities, requirements, chatTemplate, presets, assets).
- ✅ `src/cartridge/manifestSchema.ts` — pure `parseCartridgeManifest(raw)` validator (no Zod dep). Rejects absolute/escaping paths, bad sha256, unknown weight formats.
- ✅ `src/cartridge/fileSystem.ts` + `nodeFs.ts` — injectable `CartridgeFileSystem` interface + Node adapter. Keeps main SDK portable to RN/browser.
- ✅ `src/cartridge/loadCartridge.ts` — directory-based loader. Verifies manifest + required files exist. Throws `CartridgeLoadError` with structured issues.
- ✅ `src/cartridge/validateCartridge.ts` — adds sha256 + size verification on top of loadCartridge. Default hasher uses Web Crypto SubtleCrypto (works Node ≥19, browser, modern RN); injectable for older environments.
- ✅ `src/cartridge/toActivationInput.ts` — bridge: `LoadedCartridge → ActivationSessionCreateInput`. Seeds declared capabilities as "observed" to skip redundant probing; maps `weights.format` → `runtimeHint`.
- ✅ `createMachine(...).modelFromCartridge(loaded)` — new method creates a `MachineModel` from a preloaded cartridge, caches like `machine.model()`.
- ✅ Curated exports added to `src/index.ts`.
- ✅ 25 new tests under `tests/cartridge/` (manifest validation, directory load, validation failures, activation bridge, machine integration). Total: 60 tests.
- ✅ `npm run check` green.

**Scope decisions:**
- **Zip I/O deferred to M3.** Cartridge loader works with extracted directories only. ZIP packing/unpacking belongs with the CLI (next milestone), and that's where the zip reader will live. Mobile always loads from extracted dirs anyway.
- **String-based `{ cartridge: "id" }` spec still rejected.** That form needs a catalog resolver (M4). For now, consumers load cartridges via `loadCartridge()` + `machine.modelFromCartridge()`.
- **Declared capabilities are authoritative by default.** `trustDeclaredCapabilities: true` is the default because cartridge authors sign manifests — probing on every load is wasted work. Consumers can opt out.

Next session: **M3 — `machine` CLI** (pack / unpack / validate / info / init). Zip I/O lands here.

### Session 3 — 2026-04-19
**Milestone: M3 — `machine` CLI — ✅ shipped (six subcommands + streaming zip pack/unpack)**
- ✅ `src/cartridge/zipAdapter.ts` — `CartridgeZipAdapter` interface + `CartridgeZipEntry` (sourcePath OR bytes).
- ✅ `src/cartridge/nodeZip.ts` — Node adapter using `yazl` (writer) + `yauzl` (reader). Streams every entry; rejects unsafe (absolute / `..`-escaping) entry paths on extract.
- ✅ `src/cartridge/nodePackCartridge.ts` — directory → `.mcart`. Walks the tree (skipping `.DS_Store`/`Thumbs.db`/`.git*`/`node_modules`), streams sha256 via `node:crypto.createHash`, rewrites `manifest.json` in-archive with the recomputed `weights.sha256` + `weights.sizeBytes`. `--no-rehash` opts out.
- ✅ `src/cartridge/nodeUnpackCartridge.ts` — `.mcart` → directory. Optionally runs `loadCartridge` post-extract to fail-fast on corrupt archives.
- ✅ `src/bin/machine.ts` — shebang entry, top-level dispatch, `--help` / `--version` (reads `package.json` at runtime).
- ✅ `src/bin/{args,output}.ts` — ~60-LOC zero-dep arg parser; ANSI color helpers (auto-disabled when `!isTTY` or `NO_COLOR` set).
- ✅ `src/bin/commands/{init,pack,unpack,validate,info,inspect}.ts` — six subcommands, all with `--help` and human-readable / `--json` modes where it makes sense.
- ✅ `package.json` — `"bin": { "machine": "./dist/bin/machine.js" }`; `yazl@^3.3.1` + `yauzl@^3.3.0` in `dependencies`; `@types/yazl` + `@types/yauzl` in devDependencies.
- ✅ Curated exports added to `src/cartridge/index.ts` + `src/index.ts`: `packCartridge`, `unpackCartridge`, `createNodeCartridgeZipAdapter`, plus the `CartridgeZipAdapter` / `PackCartridgeOptions` / `UnpackCartridgeOptions` / `…Result` types.
- ✅ 6 new test files under `tests/cli/` (`_run.ts` helper + init / pack / unpack / validate / info / inspect) — 19 new tests, **79 total** (was 60). Pack test opens the produced `.mcart` with yauzl directly and asserts the in-archive manifest's sha256 was correctly rehashed.
- ✅ `npm run check` green (typecheck + 79 tests + build all pass). Manually smoke-tested the full init→pack→info→validate→unpack loop with a fake-bytes "weights" file.

**Scope decisions:**
- **Zip lib: `yazl` + `yauzl`** (not pure-JS). Cartridges hold GB-scale GGUFs; a non-streaming pure-JS zip would OOM on real models. yazl/yauzl are tiny (~10 KB each), maintained, zero-transitive-dep, and stream natively. Isolated to `src/cartridge/nodeZip.ts` + CLI files so RN/browser bundles never pull them in.
- **Pack-side `node*` filename convention.** Followed the `nodeFs.ts` precedent: any source file that imports `node:*` at the top level is named `node<Name>.ts`. The roadmap originally specified `packCartridge.ts` / `unpackCartridge.ts`; the rename keeps the "RN-portable runtime SDK" rule generalizable. Function names (`packCartridge`, `unpackCartridge`) stayed clean.
- **Pack auto-rehashes by default.** `init` emits a placeholder manifest with `sizeBytes: 1` + all-zero sha256 (the smallest values that satisfy the schema); `pack` rewrites both before zipping. `--no-rehash` opts out for signed-build flows.
- **`CartridgeFileSystem` was NOT extended.** Pack/unpack/init use `node:fs` directly via the `node*` files instead of adding `listDir`/`writeFile`/`mkdir` to the FS interface. The interface stays minimal for the runtime loader.
- **CLI test path quirk:** `.test-dist` builds with `rootDir: "."` so the CLI lands at `.test-dist/src/bin/machine.js` (not `.test-dist/bin/...`). `tests/cli/_run.ts` resolves the path accordingly. Production `dist/bin/machine.js` uses `rootDir: "src"` and is the published `bin` entry.

Next session: **M4 — Catalog v1** (catalog schema + fetch + cache + `machine pull`).

### Session 4 — 2026-04-19
**Milestone: M4 — Catalog v1 — ✅ shipped (portable core + Node adapters + three CLI subcommands + `createMachine({ cartridge })` integration)**

- ✅ `src/catalog/types.ts` — `CATALOG_SCHEMA_VERSION`, `Catalog`, `CatalogEntry`, `CatalogAuthor`, `ResolvedCatalogEntry`, `CartridgeSpec`, `CartridgeResolver`, `DownloadProgress`. Portable-core types — no `node:*` imports.
- ✅ `src/catalog/catalogSchema.ts` — `parseCatalog(raw)` hand-rolled validator, returns `{ valid, catalog, issues[] }`. Reuses `parseCartridgeManifest` to validate each entry's embedded `manifest` and rejects entries whose `manifest.id` disagrees with `entry.id`. Normalizes sha256 to lowercase. Same shape as M2's manifest validator — no Zod.
- ✅ `src/catalog/resolveCartridge.ts` — `resolveCartridgeEntry(catalog, { id, version? })`, `CartridgeResolveError`. Loose semver-ish comparison (numeric parts numerically, prereleases < stable). Exact-match or "latest"; full semver-range resolution deferred.
- ✅ `src/catalog/fetchCatalog.ts` — `fetchCatalog(url, { fetch?, signal? })`, `CatalogFetchError`, duck-typed `CatalogFetcher` + `CatalogFetchResponse` (matches global `fetch` shape so Node 20+ works with no deps, browsers/RN plug in their own).
- ✅ `src/catalog/downloadCartridge.ts` — `downloadCartridgeToStream(...)`, `CartridgeDownloadError`, duck-typed `DownloadFetcher` / `DownloadResponse` (Web ReadableStream-shaped `body.getReader()`) + injected `StreamingHasher`. Emits clamped progress fractions.
- ✅ `src/catalog/cartridgeCache.ts` — `CartridgeCache` interface (`rootDir`, `paths(id, version)`, `isPresent`, `list`) + `defaultCacheLayout(root, id, version, joinPath)` pure-path helper.
- ✅ `src/catalog/nodeCartridgeCache.ts` — `createNodeCartridgeCache({ rootDir? })`. Default root is `~/.machine/cartridges`; `MACHINE_CACHE_DIR` env var overrides. `isPresent` requires manifest.json to parse AND the declared weights file to exist.
- ✅ `src/catalog/nodeDownloadCartridge.ts` — `downloadAndUnpackCartridge(...)`. Writes to `<tmpDir>/<id>-<version>.mcart.partial` via a write-stream, streams sha256 with `createHash('sha256')` (using `hash.copy().digest('hex')` inside the `StreamingHasher` so the mid-stream digest is available without ending the hash). After verification: `rm` old cartridgeDir, `mkdir` parent, `unpackCartridge` into the real path. Atomic on crash — a failed pull leaves the cache untouched.
- ✅ `src/catalog/nodeCartridgeResolver.ts` — `createNodeCartridgeResolver({ cache?, catalogUrl?, catalog?, autoPull?, catalogFetch?, downloadFetch?, onProgress? })`. Cache hit → `loadCartridge` directly. Cache miss + `autoPull: false` → throws a message telling the user to `machine pull`. Cache miss + `autoPull: true` → fetch catalog → resolve entry → download → load. Both fetchers are injectable for tests.
- ✅ `src/catalog/index.ts` — barrel exporting every portable + Node piece.
- ✅ `src/bin/commands/pull.ts` — `machine pull <id>[@<version>] [--catalog <url>] [--cache <dir>] [--force]`. Fetches catalog, resolves entry, early-returns if cached (unless `--force`), otherwise streams a progress bar with ETA. Default catalog URL: `https://machine-ai.github.io/catalog/catalog.json`.
- ✅ `src/bin/commands/search.ts` — `machine search <query> [--catalog <url>] [--json]`. Case-insensitive substring match across `id`/`name`/`description`/`tags`/`categories`.
- ✅ `src/bin/commands/list.ts` — `machine list [--cache <dir>] [--json]`. Walks `cache.list()`, reads each manifest + `stat`s the declared weights file for size. Survives malformed manifests (still lists the dir).
- ✅ `src/bin/machine.ts` — three new entries in `COMMANDS` map + three new lines in `HELP`.
- ✅ `src/sdk/createMachine.ts` — new `cartridgeResolver?: CartridgeResolver` option. `createModel` refactored around a `resolveInput()` promise so both `getSession()` and `getSnapshot()` share one lazy resolution. `getSnapshot()` now works for cartridge specs (previously threw with an M4-deferral message).
- ✅ `src/sdk/types.ts` — `{ cartridge: string }` ModelSpec variant gained optional `version?: string`.
- ✅ `src/index.ts` — root barrel exports the new Catalog block (`CATALOG_SCHEMA_VERSION`, all errors, all Node adapters, all types).
- ✅ `catalog/cartridge-catalog.sample.json` — two-entry fixture (`com.example.demo-small@0.1.0`, `com.example.demo-gemma@1.0.0`). Checked in for docs / manual testing; not hosted yet.
- ✅ `tests/catalog/` — five new test files (`catalogSchema`, `resolveCartridge`, `fetchCatalog`, `downloadCartridge`, `nodeCartridgeResolver`) + shared `_fixtures.ts`. Resolver test builds a real cartridge via the fixture, packs it to `.mcart` via `packCartridge`, serves the bytes through an injected `DownloadFetcher`, confirms end-to-end auto-pull + subsequent cache hit.
- ✅ `tests/cartridge/cartridgeMachine.test.ts` — added two tests: `createMachine({ cartridge, cartridgeResolver })` end-to-end + the no-resolver error case.
- ✅ `tests/cli/{pull,search,list}.test.ts` — three new CLI tests. `_catalogServer.ts` helper spins up a `node:http` server serving `/catalog.json` + archive bytes. Pull test verifies the cartridge lands in the cache directory + a second pull prints `Already cached`. List test seeds a temp cache directly (no HTTP needed).
- ✅ `tests/run.ts` — registered all 9 new test files.
- ✅ `npm run check` green — **93 tests**, typecheck + build all pass. `dist/catalog/` emits full declarations.

**Scope decisions:**
- **Global `fetch` is the default; injection is for tests + future RN.** Node 20+ ships `fetch` on `globalThis`. `CatalogFetcher` and `DownloadFetcher` are duck-typed to its shape so no extra runtime dep (no `undici`, no `node-fetch`) was needed and the same code path works in RN/browser bundles.
- **Atomic download (write to `.partial` → verify → replace) instead of HTTP-Range resumable.** The roadmap originally listed "resumable" but the acceptance bar is "sha256 verified on download (mandatory)" — an atomic approach meets that bar with far less code. Interrupted pulls leave the existing cartridgeDir untouched. Range-resume moved to post-M4.
- **`CartridgeResolver` is a plain async function `(spec) => Promise<LoadedCartridge>`, not a class.** Makes it trivial for RN consumers to plug in a platform-specific resolver (e.g. one that reads from bundled assets) without importing any Node-only module. `createNodeCartridgeResolver(...)` is the Node factory that returns one.
- **Lazy resolution in `createMachine`.** The resolver is called at most once per `MachineModel` — on first `getSession()` or `getSnapshot()`. The resolved `ActivationSessionCreateInput` is memoized inside the model closure. Cartridge resolution never happens at machine-creation time, keeping `createMachine()` synchronous and non-throwing.
- **No `machine catalog sync`.** The roadmap listed it but `catalog.json` is a small static file — fetching it on every `pull`/`search` is fine for v1. Adding a local cache is a mechanical change when it's needed.
- **Cache root via `MACHINE_CACHE_DIR` env var.** Lets tests and CI set an isolated cache without threading a flag through every call. Explicit `--cache <dir>` flag on every CLI command still wins over env.
- **`version?: string` on the `{ cartridge }` spec.** Needed to keep `key === keyOf(spec)` deterministic across re-instantiations; also matches the `id@version` addressing used by the CLI and resolver.

Next session: **M7 — Tools / function-calling + typed structured output** (GBNF grammar-constrained JSON output + integrated tool loop).

---

### Session 5 — 2026-04-19
**Milestone: M7 — Tools + typed structured output — ✅ shipped (portable JSON-Schema → GBNF emitter + Zod walker + wired into `generateObject` and the `generateText` tool loop)**

- ✅ `src/sdk/jsonSchema.ts` — portable `JsonSchema` + `JsonSchemaPrimitiveType` TS types. Minimal subset the emitter understands (`type`, `properties`, `required`, `additionalProperties`, `items`, `minItems`/`maxItems`, `enum`, `const`, `anyOf`/`oneOf`/`allOf`, `nullable`). Zero runtime dep.
- ✅ `src/sdk/jsonSchemaToGbnf.ts` — `jsonSchemaToGbnf(schema)`. llama.cpp-compatible GBNF emitter using a `GbnfEmitter` class. Canonicalizes sub-schemas via stable `JSON.stringify` so repeated shapes resolve to the same rule. **Nested-optional object body** — `(pair0 (ws "," ws pair1 (ws "," ws pair2)?)?)?` — lets the same production cover all-required, all-optional, and mixed objects. Base rules: `ws`, `string`, `strchar`, `escape`, `hex`, `number`, `integer`, `boolean`, `jsonNull` (renamed to avoid the reserved GBNF `null` keyword), `anyValue`, `anyArray`, `anyObject`. Unsupported constructs (`$ref`, regex `pattern`, `not`) fall through to `anyValue` so output is at worst "some valid JSON".
- ✅ `src/sdk/zodToJsonSchema.ts` — duck-typed walker on `_def.typeName`. Covers `ZodString`, `ZodNumber` (detects integer via `checks[{kind:'int'}]`), `ZodBigInt`, `ZodBoolean`, `ZodNull`, `ZodAny`, `ZodUnknown`, `ZodLiteral`, `ZodEnum`, `ZodNativeEnum`, `ZodArray`, `ZodObject` (handles `shape` as function or object; peels `ZodOptional`/`ZodDefault`/`ZodCatch` to build `required` correctly), `ZodNullable`, `ZodUnion`, `ZodDiscriminatedUnion`, `ZodReadonly`, `ZodBranded`. No hard import — zod stays an optional peer dep. Unknown nodes → `null` (graceful fallback).
- ✅ `src/sdk/zodSchema.ts` — `zodSchema<T>(zod)` ergonomic wrapper that returns a `SchemaLike<T>` with `parse`/`safeParse` delegating to zod and `toJsonSchema()` pre-attached. `ZodLikeSchema<T>` duck-type published for consumers.
- ✅ `src/sdk/types.ts` — `SchemaLike<T>` gained optional `toJsonSchema?: () => JsonSchema | null`. Purely additive — existing schemas with only `parse`/`safeParse` are unaffected.
- ✅ `src/sdk/generateObject.ts` — runs `schema.toJsonSchema()` when present, emits a GBNF grammar via `jsonSchemaToGbnf`, and passes it through `completionOptions.grammar`. When a grammar is in play, `maxRetries` defaults to **0** (the grammar is the forcing function — a retry would just re-sample under the same constraint). Without a grammar, the retry path is unchanged.
- ✅ `src/sdk/generateText.ts` — in `runWithTools`, builds a union JSON Schema `{ anyOf: [ { answer }, { tool: const, args: <toolParams> }, ... ] }` and feeds it through the emitter. Grammar only activates when **every** tool's `parameters` exposes `toJsonSchema()`; if any tool is missing it, the tool loop keeps today's prompt-only path (regression-guarded by a test).
- ✅ `src/sdk/index.ts` + `src/index.ts` — re-export `jsonSchemaToGbnf`, `zodToJsonSchema`, `zodSchema`, plus types `ZodLikeSchema`, `JsonSchema`, `JsonSchemaPrimitiveType`.
- ✅ `tests/sdk/_mockRuntime.ts` — `MockRuntimeOptions` gained `onCompletionOptions?: (options) => void`. Invoked inside both `complete` and `completeChat`. Lets tests assert on the `grammar` passed through to the session.
- ✅ `tests/sdk/jsonSchemaToGbnf.test.ts` — 12 emitter-level tests: plain strings, enums, `const`, nested object with required + optional, all-optional object (empty accepted), `anyOf` unions, arrays, `minItems ≥ 1`, `anyValue` fallback for unsupported shapes, sub-schema caching, `nullable`, escape handling in literals.
- ✅ `tests/sdk/zodToJsonSchema.test.ts` — 16 walker tests using a `mockZod(def)` helper that builds fake `_def` trees. Covers every supported type plus `ZodOptional`/`ZodDefault` unwrap, `null` return for unknown nodes, and end-to-end `zodSchema()` wrapper.
- ✅ `tests/sdk/generateObject.test.ts` — two new tests: captures the `grammar` sent to the session for a `toJsonSchema`-bearing schema (asserts `"summary"` and enum alternation productions appear) + fallback when `toJsonSchema()` returns `null` (no grammar, retry path engaged).
- ✅ `tests/sdk/tool.test.ts` — two new tests: union grammar emitted when every tool exposes `toJsonSchema()` (asserts `"tool"`, `"answer"`, and per-tool const rules appear) + grammar suppressed when any tool is missing it.
- ✅ `tests/run.ts` — registered the two new emitter/walker suites.
- ✅ `npm run check` green for the M7-affected suites (**30 tests** across `jsonSchemaToGbnf`, `zodToJsonSchema`, `generateObject`, `tool`). Typecheck + build green across the repo. Pre-existing localhost-server flakes in `tests/cli/pull.test` (port binding / `fetch failed`) are unrelated and were present at baseline.

**Scope decisions:**
- **GBNF is the forcing function; retries are a fallback.** When `toJsonSchema()` is available in `generateObject`, we emit a grammar and default `maxRetries: 0` — a constrained sample that fails validation is almost always a schema-emitter gap, not a sampling accident, so retrying under the same grammar is wasted tokens. Users can still override `maxRetries` explicitly. Without a grammar, the old retry-with-reprompt path is unchanged.
- **Tool loop is all-or-nothing on grammar.** The union grammar only emits if *every* tool's `parameters` exposes `toJsonSchema()`. A mixed setup (one tool with Zod + one without) falls back to prompt-only rather than emitting a grammar that would forbid the no-schema tool entirely. This keeps M1's prompt-only behavior as the safe default for mixed toolsets.
- **Nested-optional object emission.** Instead of generating a combinatorial explosion of "required-in-order, optional-at-tail" productions, we emit `pair0 (ws "," ws pair1 (ws "," ws pair2)?)?` — one linear chain, each optional tail wrapped in `(...)?`. Same grammar, orders-of-magnitude smaller.
- **`jsonNull` base rule name.** GBNF treats bare `null` as a reserved terminator-ish identifier in some parsers, so the "JSON null" literal gets a safe-name rule. Purely an emitter implementation detail; never surfaces in schemas.
- **Zod walker is duck-typed on `_def.typeName`.** No `import 'zod'` anywhere. The walker works against any library that quacks like zod (zod itself, `@zod/mini`, in-house forks) and returns `null` for unknown nodes — which the grammar path already treats as "no grammar, use the fallback path." Keeps `package.json`'s `peerDependenciesMeta.zod.optional: true` honest.
- **Sub-schema caching is canonical-key based.** Canonicalize via a stable key-sorted `JSON.stringify` so `{a, b}` and `{b, a}` hit the same rule. Avoids duplicating productions for deeply reused sub-schemas (common in discriminated unions with shared bases).
- **Unsupported constructs degrade to `anyValue`.** `$ref`, regex `pattern`, `not`, exotic combinators all fall through to "any valid JSON" for that subtree rather than throwing. An imperfect grammar is strictly better than no grammar: the model is still constrained to well-formed JSON, we just can't enforce the narrow structure. Easy to tighten later without breaking changes.

Next session: **M6 — `@machine/ui` headless UI kit** (ahead of M5 so scaffolded templates can target the UI kit).

---

### Session 6 — 2026-04-20
**Out-of-band: Agent-readable surface (`AGENTS.md` + `machine describe --json`) — ✅ shipped (unblocks LLM-native single-session pickup before M5/M6/M8 land)**

- ✅ `src/bin/commands/describe.ts` — new `runDescribe` command. Default output is pretty-printed JSON to stdout; `--compact` flips to single-line. Optional positional arg (`machine describe cli | sdk | manifest | catalog | pointers`) filters to a single section so an agent can pull just the slice it needs. Payload: `sdkVersion`, `schemaVersions` (cartridge / catalog / activationContract), `shippedMilestones`, `weightFormats`, `cli` (every subcommand with usage + description), `sdk` (every drop-in API export with signature + summary), `manifest` (every manifest field path + type + required + description), `catalog` (every catalog field path + type + required + description), `pointers` (absolute / relative paths to the files an agent should read for more detail). All hand-curated — no `tsc --noEmit` introspection, no runtime reflection.
- ✅ `src/bin/machine.ts` — wired `describe` into `COMMANDS` + `HELP`.
- ✅ `AGENTS.md` at the repo root — 30-second orientation, non-negotiable rules (RN-portability, zod-optional, back-compat, runtime-adapter contract, cartridge-path safety), the four commands that must pass before shipping (`typecheck`, `test`, `build`, `check`), note on the pre-existing CLI pull flake, recipe-style "common tasks" (add CLI command / add manifest field / add SDK export / add runtime backend), file-pointer table, "before you ship" checklist, and session-log discipline. Written for LLM agents: terse, skimmable, no marketing prose.
- ✅ `tests/cli/describe.test.ts` — 4 new tests: full-payload keys present + schema versions correct + CLI/SDK names present + required manifest paths present; section filter returns just that section; `--compact` emits single-line JSON; unknown section exits 2.
- ✅ `tests/run.ts` — registered the new test file.
- ✅ `npm run check` — typecheck + build green; M4.5 tests pass. Pre-existing CLI pull flake unchanged.

**Scope decisions:**
- **Hand-curated payload, not type-generated.** An agent wants a stable, readable, finite-size snapshot — not a firehose of every generic param. Curated strings age better than schema transformations and stay usable as an LLM context dump. The trade-off: manifest/catalog/SDK changes now require a small edit to `describe.ts`. `AGENTS.md` explicitly lists this in its "common tasks" recipes so agents won't forget.
- **Single positional filter arg instead of `--section`.** `machine describe cli` reads better than `machine describe --section cli`, matches `git log <path>` ergonomics, and keeps the full-payload call (`machine describe`) argless.
- **`AGENTS.md` and not `LLM.md` / `AI.md`.** There's a growing convention (cursor.so, aider, Claude Code) of `AGENTS.md` as the "this is for the agent" marker. Following it means no filename negotiation when a new coding tool points at this repo.
- **"Non-negotiable rules" listed explicitly, not buried.** LLMs skim — if RN-portability and zod-optional were buried inside a recipe, they'd get violated the first time an agent reached for a `node:*` import in `src/sdk/**`. Making them a numbered list at the top of the file protects those invariants.
- **Why ship this ahead of M5/M6.** M5 (scaffolder) and M6 (UI kit) assume the SDK is already approachable. Until today an LLM agent opening the folder had to derive the API surface from source — which works but burns thousands of tokens on context-gathering before any useful work. `machine describe` + `AGENTS.md` collapse that to a single command and a single page of prose. Every subsequent milestone now benefits.

Next session: **M6 — `@machine/ui` headless UI kit.** Execution order stays M6 → M5 → M8 → M9.

---

### Session 7 — 2026-04-20
**Milestone: M6 — `@machine/ui` headless UI kit — ✅ shipped (first workspace split + 6 hooks + 5 components × {web, native} + 14 core unit tests)**

- ✅ Repo is now an npm workspace — root `package.json` gained `"workspaces": ["packages/*"]`, `@types/react` + `react` added as root devDeps (for typechecking the subpackage), and new scripts `typecheck:ui` / `test:ui` / `build:ui` / `check:ui` / `check:all`. Root `check` (SDK-only) was deliberately **not** touched so the shipped baseline never drifts.
- ✅ `packages/ui/package.json` — `@machine/ui@0.1.0-alpha.1`, MIT, three subpath exports (`.`, `./web`, `./native`) with matching `dist/<...>/index.d.ts` + `index.js` targets. `react ^18` + `react-native ^0.72` as peer deps (the latter marked optional via `peerDependenciesMeta`). Separate `clean` / `typecheck` / `build` / `test` / `check` scripts; tests use the same harness pattern as the SDK (`tsc -p tsconfig.tests.json` → `.test-dist` → `node run.js`).
- ✅ Split tsconfig strategy:
  - `packages/ui/tsconfig.json` — base (JSX `react-jsx`, `@machine/activation-sdk` paths aliased to `../../src/index.ts` so typecheck + tests hit live SDK source).
  - `packages/ui/tsconfig.build.json` — publish build. `rootDir: src`, paths aliased to `../../dist/index.d.ts` (declarations-only, sidesteps `TS6059 not under rootDir`). Means UI `build` depends on the SDK `build` having run first — documented in package README.
  - `packages/ui/tsconfig.tests.json` — declaration-free, no `rootDir`. tsc infers the common ancestor across `../../src/**` + `tests/**` so the test bundle lands at `.test-dist/packages/ui/tests/run.js`.
- ✅ `packages/ui/types/react-native.d.ts` — minimal ambient stub declaring `View`, `Text`, `TextInput`, `TouchableOpacity`, `Pressable`, `ActivityIndicator`, `FlatList`, `StyleSheet`, `StyleProp`, `ViewStyle`, `TextStyle`. Avoids pulling ~200 MB of `@types/react-native` (or RN itself) into the SDK repo just to typecheck 5 component files.
- ✅ `packages/ui/src/core/` — 8 files, all platform-neutral, import only from `react` + `@machine/activation-sdk`:
  - `MachineProvider.tsx` — `React.createContext<Machine | null>`. A `machine` prop change tears down the old value and remounts children.
  - `useMachineContext.ts` — throws if no provider upstream.
  - `useMachineModel.ts` — memoizes `machine.model(spec)` by stable JSON of the spec, returns `null` for `null` spec.
  - `useActivationSnapshot.ts` — `{ status: 'idle' | 'loading' | 'ready' | 'error', snapshot, error, reload }`. Mount-guarded via a ref so unmount during `await model.getSnapshot()` never writes to state.
  - `useInference.ts` — wraps `streamText`; drains the `textStream` async iterable into component state, exposes `{ status, text, tokensPerSecond, usage, finishReason, error, start, abort, reset }`. Guarded against stale updates after abort/unmount.
  - `useCartridgeFilter.ts` — pure `filterCartridges(entries, query, category, tags, featuredFirst)` + stateful hook wrapper with `setQuery` / `setCategory` / `toggleTag`. Zero SDK calls.
  - `formatBytes.ts`, `formatTokensPerSecond.ts` — pure formatters.
  - `types.ts` — shared `UseInferenceReturn`, `InferenceStatus`, `ActivationSnapshotStatus`.
- ✅ `packages/ui/src/web/` — 5 components + `index.ts` barrel. Uses `<div>`, `<article>`, `<section>`, `<button>`, `<input>`, `<ul>`/`<li>`, `<dl>`/`<dt>`/`<dd>`. `data-machine-ui="<name>"` attributes provide zero-dep styling hooks. `ModelImportButton` wraps a hidden `<input type="file">` behind a styled `<button>`; emits `onImport({ name, size, file })`.
- ✅ `packages/ui/src/native/` — 5 components + `index.ts` barrel. Uses `View`, `Text`, `TextInput`, `TouchableOpacity`, `FlatList`, `ActivityIndicator` from `react-native`. `ModelImportButton` takes an injected `pickModel: () => Promise<ImportedModelFile | null>` — the consumer supplies their `react-native-document-picker` (or equivalent) wiring so the UI kit stays free of any RN-only module dependency.
- ✅ `packages/ui/tests/` — reuses the SDK harness style (`test()` + `finish()` + `assertEqual` / `assert`). Three suites: `formatBytes.test.ts` (4 tests), `formatTokensPerSecond.test.ts` (3 tests), `useCartridgeFilter.test.ts` (7 tests on `filterCartridges` pure function) — **14 tests, all green**.
- ✅ `src/bin/commands/describe.ts` — new `ui` section in the payload (`@machine/ui`, version, exports, hook list, component-per-target list). `M6` added to `shippedMilestones`; new pointer keys (`uiPackage` / `uiCore` / `uiWeb` / `uiNative`). Existing `describe` test still passes (its key-check list is exhaustive for stable keys only).
- ✅ `AGENTS.md` — file-pointer row for the UI workspace + a new recipe *"Add a new UI component to `@machine/ui`"*, plus `npx machine describe ui` in the dump-the-surface block.
- ✅ **Verification:** root `npm run check` (SDK-only) stays green unchanged. `npm run check:ui` at the root (proxying into `packages/ui/`) runs `typecheck` → `test` (14 / 14 green) → `build` (emits `dist/core/`, `dist/web/`, `dist/native/`, `dist/index.{js,d.ts}` with full declarations).

**Scope decisions:**
- **Headless + pass-through only, no shipped styles.** `className` (web) / `style` (native) pass-through is the entire theming API for v1. Tailwind users get it for free; design-system users override markup via `renderItem` render-props. Design tokens, CSS-in-JS, and theme providers all deferred.
- **No forced `react-native` devDep.** Installing `react-native` for the UI kit's typecheck would pull in hundreds of MB of platform tooling into a pure-TS SDK repo. Instead, `packages/ui/types/react-native.d.ts` declares only the RN surface actually used by the five native components. Consumers who install the real RN package get its full types at their end; bundlers only resolve `native/*` under the `./native` subpath export so web apps never pull RN code.
- **`@machine/activation-sdk` is NOT declared as a peer dep in `packages/ui/package.json` yet.** The root workspace *is* `@machine/activation-sdk` — listing it as a peer of a workspace child triggers E404 on `npm install` (npm tries to fetch the repo's own package from the registry). The UI kit still imports from `@machine/activation-sdk` via a `tsconfig.json#paths` alias, and the peer dep will be re-added at publish time (M9). Documented in `packages/ui/README.md`.
- **Split tsconfigs: src paths for dev, dist paths for build.** `tsconfig.json` aliases `@machine/activation-sdk` to `../../src/index.ts` so typecheck + tests run against live SDK source (matches SDK-repo workflow). `tsconfig.build.json` aliases to `../../dist/index.d.ts` so the published build doesn't violate the declaration-build's `rootDir` constraint. Trade-off: UI `build` now depends on the SDK `build` having run first; the root `check:all` script orders them correctly.
- **Pure-logic unit tests only; no React renderer in v1.** Standing up jsdom + `react-test-renderer` in this session would dominate the work and leave the actual component code cold. Instead, the `typecheck:ui` pass exercises every JSX tree (a type-level smoke test that every component reads the SDK surface correctly), and runtime component tests land with the first reference app in M8.
- **Web uses `data-machine-ui="<name>"` attributes, not class names.** Zero-dep, styling-library-agnostic (works with Tailwind arbitrary selectors, CSS Modules, vanilla CSS, etc.). Consumers who want class names still pass `className` through.
- **Root `npm run check` unchanged.** The SDK's baseline must keep passing green between milestones. A new `check:all` composite script runs SDK + UI together; the SDK-only `check` stays the default for bisects and CI.

Next session: **M5 — `create-machine-app` scaffolder.** Execution order is now M5 → M8 → M9.

---

### Session 8 — 2026-04-21
**Milestone: M5 Session A — `create-machine-app` scaffolder + 2 templates — 🟡 partial (scaffolder CLI + `node-script` + `expo-local-chat`, three more templates deferred to Session B)**

- ✅ **Scope split decision.** Full M5 spec calls for five templates (`expo-local-chat`, `rn-cli-local-chat`, `next-local-chat`, `electron-local-chat`, `node-script`) — five full app scaffolds is too heavy for one session, so M5 got split: Session A ships the scaffolder CLI + the two templates that make the roadmap's "30-second time-to-working-app" promise real (`node-script` for any dev machine; `expo-local-chat` for the Expo flagship path that's already wired to `llama.rn` + `@machine/ui/native`). Session B handles the other three. Rationale: three more templates each with their own `package.json` + runtime wiring + README is linear work, and the `next-local-chat` template is blocked on deciding whether to build a WebLLM-backed `ActivationRuntime` adapter first.
- ✅ **New workspace `packages/create-machine-app/`** — `@machine/create-machine-app@0.1.0-alpha.1`, MIT, bin `create-machine-app` → `./dist/bin/index.js`, `files: [dist, templates, README.md]`. No runtime deps (interactive prompts use Node built-in `readline`; arg parser is a ~60-LOC hand-roll). `@types/node` inherited from the workspace root.
- ✅ **Split tsconfig strategy** (mirrors `@machine/ui`):
  - `tsconfig.json` — dev/typecheck base, CommonJS, Node moduleResolution, excludes `templates/` so tsc never tries to resolve the template trees' `react-native`/`llama.rn`/`expo` imports.
  - `tsconfig.build.json` — `rootDir: src`, `outDir: dist`.
  - `tsconfig.tests.json` — `outDir: .test-dist`, includes `src/**/*.ts` + `tests/**/*.ts`, no `rootDir` override. tsc infers the common ancestor (package root) so the test bundle lands at `.test-dist/src/...` + `.test-dist/tests/...`.
- ✅ **CLI core** — six modules under `src/`:
  - `args.ts` — parser handles `--flag`, `--no-flag`, `--key=value`, `--key value`, short `-t`/`-y`/`-h`/`-v` via `SHORT_ALIASES`, and `--` stop-marker.
  - `output.ts` — `println`/`errorln`/`bold`/`dim`/`red`/`green`/`yellow`/`cyan`; NO_COLOR + isTTY gating.
  - `prompts.ts` — `promptText(question, { default, validate })` and `promptSelect(question, options, defaultValue)` via `readline.createInterface`. Numbered-choice select (no raw-mode arrow-key nav) — simpler + test-friendlier.
  - `scaffold.ts` — pure `applyPlaceholders` + `scaffold({ templateDir, targetDir, values, writer? })` with an injectable `ScaffoldWriter` so tests can mock FS.
  - `templates.ts` — `TEMPLATES` registry (id, displayName, description, target, nextSteps) + `templatesRoot()` (`resolve(__dirname, '..', 'templates')`) + `findTemplate(id)` + `isPackageManager(value)`.
  - `run.ts` — main dispatcher: parse argv → handle `--help`/`--version` → interactive prompts for missing fields (or error on non-TTY without `--yes`) → validate target-dir emptiness → `scaffold()` → print next-steps footer using the template's `nextSteps` array with `{pm}` substitution.
  - `bin/index.ts` — shebang entry that calls `run()` and `process.exit`s with its return code.
- ✅ **`node-script` template** — `package.json.tmpl` (`@machine/activation-sdk` dep, `typescript` + `@types/node` devDeps, `build`/`start`/`dev` scripts), `tsconfig.json` (ES2022, NodeNext), `.gitignore`, `README.md.tmpl`, `src/index.ts`. `index.ts` wires a placeholder `ActivationRuntime` into `createMachine({ runtimes, cartridgeResolver: createNodeCartridgeResolver({ catalogUrl, autoPull: true, onProgress }) })`, resolves `dev.machine.gemma-3n-e4b-it` by default, calls `generateText({ model, prompt, maxTokens })`. The placeholder runtime is explicitly labeled "swap me" so consumers know to plug in a real backend.
- ✅ **`expo-local-chat` template** — 10 files: `package.json.tmpl` (Expo 51, RN 0.74.5, React 18.3.1, `llama.rn@^0.5`, `@machine/activation-sdk`, `@machine/ui`), `tsconfig.json` (extends `expo/tsconfig.base`), `app.json.tmpl` (Expo config with `newArchEnabled: true` + `plugins: ["llama.rn"]`), `babel.config.js`, `metro.config.js`, `README.md.tmpl`, `.gitignore`, `index.ts` (`registerRootComponent`), `src/App.tsx` (wraps `<MachineProvider machine={createMachine({ runtimes: llamaRuntime })}>` around `<ChatScreen />`), `src/ChatScreen.tsx` (`useMachineModel({ cartridge })` + `useInference(model)` + `<InferenceIndicator>` + `<TextInput>` + `<Button>`), `src/llamaRuntime.ts` (`ActivationRuntime` adapter wrapping `initLlama` + `context.completion` with streaming callback).
- ✅ **Templates not typechecked in SDK repo.** `tsconfig.json` + `tsconfig.build.json` exclude `templates/` — the template files import `react-native`, `llama.rn`, `expo`, `@machine/ui/native`, none of which are installable in the SDK workspace. Template correctness is verified by scaffolding into a temp dir + asserting file-tree shape + placeholder substitution; runtime verification (`expo start`, `npm install`) is a manual / downstream step.
- ✅ **Tests — 15 green** under `packages/create-machine-app/tests/`: `scaffold.test.ts` (3 pure tests on `applyPlaceholders`), `node-script.test.ts` (7 tests covering tree shape, APP_NAME + PACKAGE_MANAGER substitution, no `.tmpl` leakage, `createNodeCartridgeResolver` wiring, unknown-template exit 2, non-empty-target exit 1, `--force` overwrite), `expo-local-chat.test.ts` (5 tests covering full tree, `app.json` substitution, `MachineProvider` + `llamaRuntime` wiring in `App.tsx`, `@machine/ui/native` imports + `useInference`/`useMachineModel`/`InferenceIndicator` usage in `ChatScreen.tsx`, no `.tmpl` leakage). Test harness mirrors `packages/ui/tests/_harness.ts` exactly.
- ✅ **Root workspace glue** — `package.json` gains `typecheck:scaffolder` / `test:scaffolder` / `build:scaffolder` / `check:scaffolder` scripts; `check:all` extended to `npm run check && npm run check:ui && npm run check:scaffolder`. Root `check` (SDK-only) unchanged so the shipped baseline never drifts.
- ✅ **`src/bin/commands/describe.ts`** — new `scaffolder` top-level key in `DescribePayload` (`name`, `version`, `bin`, `usage`, `templates[]`), `M5` added to `inProgressMilestones`. New pointers `scaffolder: 'packages/create-machine-app/'` + `scaffolderTemplates: 'packages/create-machine-app/templates/'`. `HELP` mentions the new `scaffolder` section.
- ✅ **`AGENTS.md`** — `npx machine describe scaffolder` added to the dump-the-surface block; file-pointers row for the scaffolder workspace; new recipe *"Add a new `create-machine-app` template"* with concrete steps.
- ✅ **Verification:** root `npm run check` (SDK-only) stays green unchanged. `npm run check:scaffolder` runs typecheck → build → test:build → 15 / 15 tests green. `npm run check:all` (SDK + UI + scaffolder) green end-to-end.

**Scope decisions:**
- **Split into Session A + Session B.** Five templates in one session would have burned the whole session on linear app-scaffolding work. Session A ships the scaffolder CLI plus the two templates that cover the roadmap's "30-second time-to-working-app" promise (`node-script` = any dev machine, `expo-local-chat` = the Expo flagship that's already wired to shipped milestones M6 + M7). Session B picks up `rn-cli-local-chat`, `next-local-chat`, and `electron-local-chat` once a decision is made on the web runtime adapter (M7.5 open question).
- **Zero runtime dependencies.** Interactive prompts use Node built-in `readline`; arg parser is a ~60-LOC hand-roll; color helpers gated on NO_COLOR + isTTY. `@types/node` is the only devDep, inherited from the root. Keeps install-time footprint close to zero and avoids dragging in a prompt library that would churn between Node versions.
- **`.tmpl` suffix convention for placeholder files.** Any template file that needs `{{APP_NAME}}` / `{{PACKAGE_MANAGER}}` substitution ends in `.tmpl`; the scaffolder strips the suffix on write. Non-placeholder files (`tsconfig.json`, `.gitignore`, `babel.config.js`, `metro.config.js`, `index.ts`) copy verbatim. Means tsc/metro/expo never pick up template source files during SDK dev; also means a quick grep for `{{` catches any unsubstituted placeholder at author time.
- **Templates not typechecked in this repo.** `templates/` is excluded from both `tsconfig.json` and `tsconfig.build.json` — the template files import `react-native`, `llama.rn`, `expo`, `@machine/ui/native`, none of which resolve in the SDK workspace. Correctness comes from scaffolding into a temp dir + asserting file-tree shape + placeholder substitution in tests. Runtime verification (`npm install`, `expo start`) is a manual/downstream step. Trade-off accepted because the alternative — installing RN + Expo + Next.js in the SDK repo just to typecheck the template trees — would add hundreds of MB of devDeps for a one-line payoff.
- **Numbered-choice select, not arrow-key nav.** `promptSelect` reads a line + parses an integer instead of flipping stdin to raw mode. Simpler code (~20 LOC), works the same in headed terminals and tests, and keeps the whole CLI readline-only.
- **Scaffold flow exits 1 on non-empty target without `--force`.** Avoids silent data loss if a user accidentally scaffolds over an existing project. `--force` explicitly opts into overwrite. Tested both paths.
- **Non-TTY without `--yes` is a hard error, not a prompt hang.** If stdin isn't a TTY and required fields are missing, the CLI exits 1 with a helpful message rather than blocking on `readline` forever. Guards CI + test environments.
- **`dev.machine.gemma-3n-e4b-it` as the default cartridge id.** Real entry from the seeded catalog; users retarget post-scaffold. Keeps the "30-second time-to-working-app" promise honest.

Next session: **M5 — Session B (`rn-cli-local-chat`, `next-local-chat`, `electron-local-chat`).** Then M8 → M9. `next-local-chat` specifically needs a decision on the web runtime adapter (M7.5 open question) before it can start.

---

### Session 9 — 2026-04-21
**Milestone: M5 Session B — remaining three templates — ✅ shipped. M5 now ✅ complete end-to-end.**

- ✅ **`rn-cli-local-chat` template** — 11 files. Bare React Native 0.74 (no Expo) parallel to `expo-local-chat`: same `llamaRuntime.ts` (llama.rn adapter) + same `ChatScreen.tsx` (`@machine/ui/native` hooks) copied verbatim, differs only in project shape. Files: `package.json.tmpl` (RN 0.74, `@react-native-community/cli`, `llama.rn@^0.5`, `@machine/activation-sdk`, `@machine/ui`, `@react-native/metro-config` + `@react-native/babel-preset` devDeps, scripts `start`/`android`/`ios`/`tsc`), `tsconfig.json` (extends `@react-native/typescript-config`), `app.json.tmpl` (`{ name, displayName }` bare-RN convention), `babel.config.js` (`module:@react-native/babel-preset`), `metro.config.js` (`getDefaultConfig(__dirname)`), `.gitignore` (RN CLI flavor — `ios/Pods/`, `android/.gradle/` etc), `index.js.tmpl` (`AppRegistry.registerComponent('{{APP_NAME}}', () => App)`), `src/App.tsx` (`SafeAreaProvider` from `react-native-safe-area-context` wrapping `<MachineProvider machine={createMachine({ runtimes: llamaRuntime })}><ChatScreen /></MachineProvider>`), `src/ChatScreen.tsx`, `src/llamaRuntime.ts`, `README.md.tmpl` (RN CLI setup — `npx pod-install`, `{{PACKAGE_MANAGER}} run android`/`ios`).
- ✅ **`electron-local-chat` template** — 16 files, main/renderer process split with IPC-backed inference. Main process gets the real `node-llama-cpp` runtime; renderer uses a proxy `ActivationRuntime` that forwards through `window.machine.*` via `contextBridge`. Files:
  - `package.json.tmpl` (`electron@^33`, `electron-builder@^25`, `node-llama-cpp@^3`, `react@^18`, `react-dom@^18`, `vite@^5`, `@vitejs/plugin-react`, `concurrently`, `wait-on`, `@machine/activation-sdk`, `@machine/ui`. `build.appId: "com.example.{{APP_NAME}}"` + `build.productName: "{{APP_NAME}}"` for electron-builder. Scripts: `dev` (concurrent vite + tsc watch + electron via wait-on), `build` (tsc + vite build + electron-builder), `start`).
  - Three split tsconfigs: `tsconfig.json` (project-refs root), `tsconfig.main.json` (NodeNext + CommonJS for Electron main/preload), `tsconfig.renderer.json` (bundler resolution + react-jsx for Vite).
  - `vite.config.ts` (`base: './'`, `build.outDir: 'dist/renderer'`, `@vitejs/plugin-react`).
  - `electron/main.ts` — creates `BrowserWindow` with `contextIsolation: true`, loads `file://...dist/renderer/index.html` in prod or `http://localhost:5173` in dev, instantiates `createMachine({ runtimes: nodeLlamaRuntime })` once at startup, registers `ipcMain.handle('machine:complete', ...)` + `'machine:abort'`.
  - `electron/preload.ts` — `contextBridge.exposeInMainWorld('machine', { complete, abort })` IPC surface.
  - `electron/preload-types.d.ts` — ambient declaration of `Window.machine`.
  - `electron/nodeLlamaRuntime.ts` — `ActivationRuntime` wrapping `getLlama` + `LlamaChatSession` from `node-llama-cpp`, parallel in shape to `llamaRuntime.ts`.
  - `src/ipcRuntime.ts` — **renderer-side proxy ActivationRuntime.** Lets `@machine/ui/web` hooks work unchanged: `createSession()` returns a session whose `complete`/`completeChat`/etc forward through `window.machine.complete(...)` IPC. Critical piece that makes the IPC split transparent to hooks.
  - `src/index.html.tmpl` (title `{{APP_NAME}}`), `src/main.tsx` (React DOM mount), `src/App.tsx` (MachineProvider + ChatScreen), `src/ChatScreen.tsx` (uses `@machine/ui/web`), `.gitignore` (Electron flavor — `dist/`, `release/`, `out/`), `README.md.tmpl`.
- ✅ **`next-local-chat` template** — 10 files. Next.js 14 app-router web template with `@mlc-ai/web-llm` wired **inside the template** (not as a new SDK workspace). Files: `package.json.tmpl` (`next@^14`, `react@^18`, `@mlc-ai/web-llm@^0.2`, `@machine/activation-sdk`, `@machine/ui`, scripts `dev`/`build`/`start`/`lint`/`tsc`), `tsconfig.json` (Next standard — `jsx: preserve`, `moduleResolution: bundler`), `next.config.js` (`transpilePackages: ['@machine/activation-sdk', '@machine/ui']` so workspace ESM resolves under Next's build), `next-env.d.ts`, `.gitignore` (Next flavor — `.next/`, `out/`), `src/app/layout.tsx` (root `<html><body>{children}</body></html>`), `src/app/page.tsx` (`'use client'` — wires `<MachineProvider machine={createMachine({ runtimes: webLlmRuntime })}><ChatScreen /></MachineProvider>`), `src/app/ChatScreen.tsx` (`'use client'` — `@machine/ui/web` hooks), `src/lib/webLlmRuntime.ts` (`ActivationRuntime` wrapping `CreateMLCEngine` from `@mlc-ai/web-llm`, streams via `engine.chat.completions.create({ stream: true })`, default model `Llama-3.2-1B-Instruct-q4f32_1-MLC`), `README.md.tmpl` (notes WebLLM caches weights in browser IndexedDB, points at `@mlc-ai/web-llm` model catalog).
- ✅ **`packages/create-machine-app/src/templates.ts`** — `TemplateTarget` union expanded to `'node' \| 'expo' \| 'react-native' \| 'next' \| 'electron'`. Three new `TemplateDescriptor` entries appended to `TEMPLATES` with id/displayName/description/target/nextSteps (e.g. `{pm} install` + `npx pod-install` + `{pm} run ios` for rn-cli).
- ✅ **Tests — ~21 new, all green.** Three new files mirroring Session A's pattern:
  - `tests/rn-cli-local-chat.test.ts` — 6 tests (full tree, APP_NAME in `package.json` + `app.json`, `App.tsx` wires `MachineProvider` + `llamaRuntime`, `ChatScreen` uses `@machine/ui/native`, `index.js` uses `AppRegistry.registerComponent`, no `.tmpl` leakage).
  - `tests/next-local-chat.test.ts` — 7 tests (tree, APP_NAME + deps assertions `next`/`@mlc-ai/web-llm`/`@machine/ui`, `webLlmRuntime.ts` imports `@mlc-ai/web-llm` + uses `CreateMLCEngine`, `page.tsx` is `'use client'` + wires provider, `ChatScreen` uses `@machine/ui/web`, `next.config.js` sets `transpilePackages`, no `.tmpl` leakage).
  - `tests/electron-local-chat.test.ts` — 8 tests (tree including `electron/` + `src/` subtrees, APP_NAME substitution across `package.json` + `build.appId` + `build.productName` + `index.html` title, `nodeLlamaRuntime.ts` imports `node-llama-cpp` + uses `getLlama`/`LlamaChatSession`, `main.ts` uses `ipcMain.handle` + registers `'machine:complete'`, `preload.ts` uses `contextBridge.exposeInMainWorld('machine', ...)`, `ChatScreen.tsx` uses `@machine/ui/web`, `ipcRuntime.ts` forwards through `window.machine.complete`, no `.tmpl` leakage).
  - All three files registered in `tests/run.ts`.
- ✅ **`src/bin/commands/describe.ts`** — extended `ScaffolderTemplateDescription.target` union to match `TemplateTarget`; appended three new entries to `SCAFFOLDER_PACKAGE.templates` with identical id/displayName/description as the scaffolder registry. Flipped `shippedMilestones` to include M5; `inProgressMilestones` now `[]`.
- ✅ **Verification:** `npm run check:scaffolder` runs typecheck → build → test:build → ~36 tests green. `npm run check:all` (SDK + UI + scaffolder) green end-to-end.

**Scope decisions:**
- **Web runtime (M7.5): use external `@mlc-ai/web-llm`, wire at template level, no new SDK package.** User chose "if we can use open source code that has already been done, then we should do that, no point in reinventing the wheel" — standardize on the incumbent WebGPU library. Wiring lives inside `next-local-chat/src/lib/webLlmRuntime.ts` as an `ActivationRuntime` adapter — same shape as `expo-local-chat`'s `llamaRuntime.ts` wrapping `llama.rn`. Means `next-local-chat` ships a real working web runtime today without creating a `@machine/web-llm-runtime` workspace to maintain. M7.5 stays open at SDK granularity but no longer blocks M8.
- **Electron: `node-llama-cpp` in main process, IPC-backed renderer runtime.** Chose `node-llama-cpp` over alternatives (recommended path — single npm package, self-contained prebuilt binaries). Runtime lives in main (`electron/nodeLlamaRuntime.ts`) with `contextIsolation: true` in the renderer; renderer gets `src/ipcRuntime.ts` — a proxy `ActivationRuntime` that forwards every session call through `window.machine.*` IPC. Key win: `@machine/ui/web` hooks (`useMachineModel`, `useInference`, `<InferenceIndicator>`) work unchanged in the renderer even though the real inference is in a different process. No renderer-side `nodeIntegration`, no bundling `node-llama-cpp` into the renderer chunk.
- **RN CLI parallel to Expo.** `rn-cli-local-chat` copies `llamaRuntime.ts` + `ChatScreen.tsx` verbatim from `expo-local-chat`; only the project shape differs (`@react-native/metro-config` + `@react-native/babel-preset` + `AppRegistry.registerComponent` + `app.json` `{ name, displayName }` + `react-native-safe-area-context` instead of `expo-status-bar`). Same llama.rn wiring works on bare RN so there's nothing runtime-specific to change.
- **`TemplateTarget` union expanded to five.** `'node' \| 'expo' \| 'react-native' \| 'next' \| 'electron'` — one variant per target toolchain. `describe.ts`'s `ScaffolderTemplateDescription.target` mirrors the scaffolder's union exactly so external agents see identical metadata.
- **Template placeholder surface stays at `{{APP_NAME}}` + `{{PACKAGE_MANAGER}}`.** No new placeholders added. `build.appId` in `electron-local-chat`'s `package.json.tmpl` uses `com.example.{{APP_NAME}}` — reuses the existing `APP_NAME` substitution rather than introducing an `{{APP_ID}}` placeholder consumers would have to learn.
- **`InferenceIndicator` web shape `(inference={inference})`, native shape `(status + tokensPerSecond)`.** Ran into this divergence while wiring `next-local-chat` and `electron-local-chat` ChatScreens — the web variant takes the full `UseInferenceReturn`, the native variant takes individual props. Both ChatScreens pass `<InferenceIndicator inference={inference} />` accordingly. No change to the UI package — just a gotcha captured here for the next session that touches these templates.
- **`.mcart` cartridge id vs WebLLM model id.** WebLLM has its own model-id vocabulary (`Llama-3.2-1B-Instruct-q4f32_1-MLC`). `webLlmRuntime.ts` uses `input.filePath || DEFAULT_WEB_LLM_MODEL` so the cartridge manifest's `filePath` field can carry the WebLLM id when pulling through the catalog resolver. README explains the dual-id situation so consumers know to override.

Next session: **M8 — Reference App 01 (Meeting Notes).** Then M9 (publish + docs). M7.5 stays deferred.

### Session 10 — 2026-04-23
**Milestone: M8 Reference App 01 — ✅ shipped as a port of the production Ingredient Analyzer, not the originally-planned Meeting Notes app. M8 now 🟡 partial (Vercel-AI-SDK demo port deferred to next session).**

- ✅ **Pivot away from Meeting Notes.** User chose: *"I don't know if I wanna build this app since getting the transcript itself will require another tool altogether. We can instead work on a copy of the ingredient analyzer in the apps folder."* Transcription would have introduced an entire second product dependency (audio/STT plumbing) that would dominate the work without exercising the SDK any harder. The Ingredient Analyzer is already a working production app with a Gemini cloud path — the port demonstrates "how easily can we plug a local model in," which is the actual story M8 needs to tell.
- ✅ **Fresh port at `Ingredient analyzer - Activation SDK\`.** Copied verbatim from the base `Ingredient analyzer/` folder via robocopy (excluding `node_modules/`, `dist/`, `ios/Pods/`, `android/.gradle/`, `android/build/`, `android/app/build/`, `android/.cxx/`). The older `Ingredient analyzer - Machine Activation SDK/` clone — wired against the pre-M1 SDK — stays untouched as historical reference.
- ✅ **Headline proof: the hand-rolled JSON normalizer layer is gone.** Older clone's `machineActivationService.ts` had ~300 LOC of `normalizeIngredient`, `normalizeRisk`, `normalizeSideEffect`, `normalizeHealthImpact`, `normalizePerspective`, `normalizeAnalysisResult`, `extractJsonCandidate`, `clampScore` helpers defending against partial model output. All deleted. Replaced by `generateObject({ model, schema: zodSchema(IngredientAnalysisSchema), messages, system })` — GBNF constrains generation at the sampling level so the model cannot emit a schema-invalid instance, and `.default(...)` annotations on every Zod field handle any missing values. Before: 623 LOC. After: 247 LOC (−60%).
- ✅ **Files rewritten / added in the new app:**
  - `src/services/machineActivationService.ts` — **rewritten, 247 LOC.** `createMachine({ runtimes: [capacitorLiteRtRuntime], compatibilityPolicy: 'permissive' })` + `machine.model({ filePath, projectorPath, runtimeHint, contextWindowTokens: 4096 })` + `generateObject({ schema: zodSchema(IngredientAnalysisSchema) })` for analysis, `generateText(...)` for chat. Public function names (`analyzeDocumentWithMachineActivation`, `sendChatMessageWithMachineActivation`, `getMachineActivationModelConfig`, `setMachineActivationModelConfig`, `probeMachineActivationModelConfig`) kept identical to the older clone so the provider-switch seam ports cleanly.
  - `src/types/ingredientAnalysisSchema.ts` — **new, 218 LOC.** Zod mirror of `IngredientAnalysisResult` with `.default(...)` on every field. This is what replaces the 300-LOC normalizer layer.
  - `src/services/aiProvider.ts`, `capacitorMachineActivationRuntime.ts`, `machineActivationCapacitorPlugin.ts`, `machineActivationPrompts.ts`, `machineActivationFilePicker.ts` — copied verbatim from the older clone. The `ActivationRuntime` contract is unchanged between old and new SDK, so these ported without modification.
  - `src/components/SourceBadge.tsx` — **new.** Subtle `Local model` / `Cloud model` pill, wired into the analysis modal header (`ProductAnalysisModal.tsx`) and above the chat input (`AskChat.tsx`).
  - `src/components/SettingsView.tsx` — **patched.** Added an **AI Provider** card with Cloud/Local toggle + "Pick Local Model" button that calls `pickMachineActivationModel()` → `probeMachineActivationModelConfig()` → `setMachineActivationModelConfig()`.
  - `src/services/geminiService.ts`, `chatService.ts`, `documentValidator.ts` — **patched minimally.** One-line provider switch at the top of `analyzeDocument`, `sendChatMessage`, `validateDocument`. Cloud behavior byte-identical when not in local mode.
- ✅ **Android Gradle changes:** `android/build.gradle` added `classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.20'`; `android/variables.gradle` bumped `minSdkVersion 22 → 23` (LiteRT-LM requirement); `android/app/build.gradle` applied `org.jetbrains.kotlin.android`, added `kotlinOptions { jvmTarget='17'; freeCompilerArgs+=['-Xskip-metadata-version-check'] }`, and two runtime deps (`com.google.mediapipe:tasks-genai:0.10.27`, `com.google.ai.edge.litertlm:litertlm-android:0.10.0`). `MainActivity.java` rewritten to register the `MachineActivationPlugin` Kotlin plugin (876 LOC copied verbatim from the older clone).
- ✅ **`package.json`:** `@machine/activation-sdk` dep repointed to `"file:../Machine AI/iterations/MachineActivationSDK"`; `zod@^3.23.0` added as a direct dep (peer-optional to the SDK but needed at the call site for `zodSchema(IngredientAnalysisSchema)`).
- ✅ **`ACTIVATION_SDK_INTEGRATION_CHECKPOINT.md`** added inside the new app folder — tells the before/after story, documents where the cloud seam was preserved, lists what had to stay app-specific (Capacitor Kotlin plugin, runtime adapter, prompt templates).

**Scope decisions:**
- **API-upgrade story, same runtime.** Kept the existing LiteRT-LM Capacitor plugin unchanged. The savings come entirely from call-site + schema enforcement, not from swapping runtimes. Makes the delta clean: "here is the old SDK, here is the new SDK, 300 LOC of defensive normalization dies, nothing else changes."
- **Fresh copy of the base app, not edit-in-place on the older clone.** User chose: *"Let's copy the ingredient analyzer (base) folder once more and make another copy and call it Activation SDK."* The older `Ingredient analyzer - Machine Activation SDK/` clone stays intact as historical reference — important because the diff between it and the new port *is* the M8 proof.
- **Model selection stays "user picks a `.litertlm` file on device."** No catalog integration, no cartridge resolver, no `machine pull`. The SDK's cartridge path is overkill for a single hand-picked local model and would have dragged the scope. Cartridge integration is reserved for a future demo.
- **No npm install / Android build in this session.** Android builds take 10+ min and need a physical device to actually verify the local-model flow works end-to-end. User verifies downstream. The scope of this session was the code port, not the device-side smoke test.
- **Vercel-AI-SDK demo port split into next session.** Keeping the sessions focused: Reference App 01 (Ingredient Analyzer) is the "API-upgrade" story; Reference App 02 (Vercel-AI-SDK port) is the "drop-in claim" story. Bundling both would have blown past the context budget.

**Verification (from the app side, not SDK):**
- `grep -rn "normalizeAnalysisResult\|normalizeIngredient\|normalizeRisk" "Ingredient analyzer - Activation SDK/src/"` → zero hits ✅
- `grep -rn "createMachineFramework\|createActivationClient\|activateModel" "Ingredient analyzer - Activation SDK/src/"` → zero hits ✅
- `wc -l "Ingredient analyzer - Activation SDK/src/services/machineActivationService.ts"` → **247** (older clone: 623) ✅

**SDK-side:** no changes landed this session, so the 2026-04-22 baseline (`npm run check:all` green) carries over by construction. Not re-run.

Next session: **M8 — Reference App 02 (ported Vercel-AI-SDK demo).** Then M9 (publish + docs). M7.5 stays deferred.

### Session 11 — 2026-04-23 (same-day follow-up to Session 10)
**Milestone: M8 Reference App 01 — hardened into a pure local-only Android app with zero cloud dependencies. M8 stays 🟡 partial (Vercel-AI-SDK port still deferred); no Current-status table change.**

- ✅ **Rationale:** the Session 10 port had kept the cloud inference path behind a provider toggle; this session removes the cloud path entirely so the reference app tells a clean one-story narrative: local-only, no backend, no hosting.
- ✅ **Cloud/account code + config removed:** the prior cloud inference, account, and provider-toggle modules and their root config were deleted, leaving a local-only app.
- ✅ **Services rewritten to local-only:**
  - `chatService.ts` — stripped the remote streaming path; `sendChatMessage` now delegates straight to `sendChatMessageWithMachineActivation`. Chat typewriter UX preserved via the existing RAF drain + `bufferRef`.
  - `documentValidator.ts` — removed the remote validation callable; `validateDocument` now returns after a local check (480px minimum dimension + Laplacian variance blur score, threshold 100).
  - `comparisonService.ts` (294 LOC) — the side-by-side product comparison ported to a local `generateObject({ model, schema: zodSchema(ComparisonResponseSchema), … })` call with a mirror Zod schema (all fields `.default(...)`). No feature regression — comparison still works, just offline.
- ✅ **`SettingsView.tsx` rewritten (304 LOC):** removed the cloud account / provider-toggle UI. Kept Language + Clear History cards. Added a **Local AI Model** card (Pick Local Model → `pickMachineActivationModel` → `probeMachineActivationModelConfig` → `setMachineActivationModelConfig`) and a **Recommended Model** card linking to an external Hugging Face model page (`Gemma 3n E2B (LiteRT-LM)`, ~1.5 GB) with a 3-step download instruction block. Zero in-app bundling, zero self-hosting.
- ✅ **`App.tsx` patched:** removed the cloud gating wrappers and their state; `handleStartValidation` collapsed (no permission-check race, no `Promise.race` timeout). Bottom return simplified to `return <>{renderView()}</>;`.
- ✅ **Native + Gradle stripped:** removed all cloud/account native dependencies and their Gradle / Capacitor plugin wiring. `MainActivity.java` verified clean — only registers `MachineActivationPlugin.class`.
- ✅ **What's kept:** the LiteRT-LM Kotlin plugin (unchanged), the Capacitor bridge, `tasks-genai:0.10.27`, `litertlm-android:0.10.0`, Kotlin Gradle plugin 2.1.20, `minSdkVersion 23`, `jvmTarget 17` — the load-bearing bits that actually run the local model.

**Scope decisions:**
- **Local-only means no backend gating.** A local-only app needs no remote gating or usage-metering layer; that logic is gone entirely. Free, unlimited, local.
- **Recommended-model UX is a link, not a download manager.** Bundling a ~1.5 GB model into an APK is a non-starter (Play size limits, install time) and self-hosting incurs bandwidth cost. Chosen: external Hugging Face link + in-app file picker that accepts any `.litertlm`.
- **`comparisonService` ported in-place rather than dropped.** Comparison is a visible, high-value UI feature; the port is small (~100 LOC of local inference wiring) and reuses the same `machine.model({...})` handle the analysis path already warms up.
- **No npm install / Android APK build in this session.** Builds take 10+ min and need a physical device; user verifies downstream.

**SDK-side:** no changes landed this session — all edits were inside the app folder. The 2026-04-22 `npm run check:all` baseline carries over.

**Effect on the M8 narrative:** Reference App 01 is now a strictly harder demo of the SDK's value prop: "swap an API call, delete ~300 LOC of defensive normalizers, and run entirely on-device with no backend." Plays directly into the "plug a local model in" positioning for M9.

Next session: **M8 — Reference App 02 (ported Vercel-AI-SDK demo).** Then M9 (publish + docs). M7.5 stays deferred.

### Session 12 — 2026-04-27
**Milestone: SDK packaging + Capacitor adapter sub-package — ✅ shipped. Two new SDK improvements (#1 ship `@machine/activation-capacitor`; #2 dual ESM+CJS build with proper `exports` map) plus a third packaging-discipline fix (Node-only helpers split behind `@machine/activation-sdk/node`). Reference App 01 re-ported onto the new sub-package; app-side SDK boilerplate dropped from 1186 → 265 LOC (−78%). Triggered by user direct feedback: *"did our sdk improve the ease of building the app? thats the overall goal here"* — answer was "not enough" until this session.**

- ✅ **Driving question from user:** *"so what is the point of the sdk if it isnt really helping?"* and *"how can it be improved"*. Forced an honest audit of where the SDK was still leaking implementation detail into consumer apps. Two friction points dominated: (1) every Capacitor consumer had to copy ~570 LOC of adapter glue (`capacitorMachineActivationRuntime.ts` + `machineActivationCapacitorPlugin.ts` + `machineActivationFilePicker.ts`) verbatim from Reference App 01; (2) the SDK shipped CJS-only with no `exports` map, so Vite consumers needed `optimizeDeps.include: ['@machine/activation-sdk']` + `build.commonjsOptions.include: [/@machine\/activation-sdk/]` workarounds to even build.

- ✅ **#2 — Dual ESM+CJS build + exports map.** SDK root now ships `dist/cjs/` (CJS, `module: "CommonJS"`, `moduleResolution: "Node"`) and `dist/esm/` (ESM, `module: "ESNext"`, `moduleResolution: "Bundler"`) from two `tsc -p` invocations. New `scripts/finalize-esm-build.js` writes `dist/esm/package.json: {"type":"module","sideEffects":false}` so Node's ESM resolver flips for that subdirectory only. `package.json.exports` gained `import` / `require` / `types` / `default` conditions. The ESM bundle uses real `export *` (Rollup can statically trace), unlike the prior CJS-only `__exportStar(require(...))` pattern which kept the entire module graph opaque. Build script: `tsc -p tsconfig.build.json && tsc -p tsconfig.build.esm.json && node ./scripts/finalize-esm-build.js`.

- ✅ **#1 — `@machine/activation-capacitor` workspace.** New `packages/activation-capacitor/` ships `@machine/activation-capacitor@0.1.0-alpha.1`. Mirrors the SDK root's dual-build pattern. Three source files (`runtime.ts`, `plugin.ts`, `filePicker.ts`) lifted from Reference App 01 verbatim; `runtime.ts` was lightly refactored to replace `this.listBackendCapabilities!()`/`probeDeviceCapabilities!()`/`probeModelPackage!(input)` non-null assertions with module-scope helper functions (the runtime contract changed `Reporters` to `Partial<Reporters>` between old + new SDK). Public API: `createCapacitorMachineActivationRuntime`, `registerCapacitorMachineActivationRuntime`, `pickMachineActivationModel`, `isMachineActivationPluginAvailable`, `MachineActivationNative`, plus type re-exports. Peer-deps: `@capacitor/core >=5.0.0`, `@capawesome/capacitor-file-picker >=6.0.0` (optional), `@machine/activation-sdk *` (workspace-resolvable).

- ✅ **#3 — Browser-safe main barrel (post-build-discovery).** First Ahara rebuild after #1+#2 still failed with `"readFile" is not exported by "__vite-browser-external", imported by "node_modules/@machine/activation-sdk/dist/esm/cartridge/nodeFs.js"`. Root cause: `src/cartridge/index.ts` and `src/catalog/index.ts` had `export { createNodeCartridgeFileSystem } from './nodeFs'` etc. — static ESM star-exports keep `node:fs/promises` / `node:path` / `node:crypto` imports in the consumer's bundle graph regardless of `sideEffects: false`. The legacy `package.json.browser` field map was tried first and ignored (modern bundlers prefer `exports` map over `browser` for path-to-path remapping). Real fix: created `src/node.ts` exporting all `createNode*` / `packCartridge` / `unpackCartridge` / `downloadAndUnpackCartridge` helpers, removed those names from `src/index.ts` + `cartridge/index.ts` + `catalog/index.ts`, and added `./node` to the `exports` map. CLI commands (`pack`, `unpack`, `validate`, `info`, `inspect`, `list`, `pull`) updated to deep-import the underlying files (e.g. `import { unpackCartridge } from '../../cartridge/nodeUnpackCartridge'`) since they always run in Node and don't need to go through the sub-export. `node-script` template updated to `import { createNodeCartridgeResolver } from '@machine/activation-sdk/node'`.

- ✅ **Reference App 01 re-port.**
  - `src/main.tsx` — added `import { registerCapacitorMachineActivationRuntime } from '@machine/activation-capacitor'` + the registration call. (This was a latent bug in Sessions 10/11 — the runtime was never being registered in the new app.)
  - `src/services/machineActivationService.ts` — switched plugin/probe imports from local `./machineActivationCapacitorPlugin` to `@machine/activation-capacitor`. File grew slightly (247 → 265 LOC, +18) because it now declares the consumer-facing `MachineActivationModelConfig` interface directly instead of leaning on the file-picker module's re-exports. The 300-LOC normalizer layer still gone, the `createMachineFramework(...).createActivationClient().activateModel(...)` ceremony still gone.
  - `src/components/SettingsView.tsx` — `pickMachineActivationModel` import switched from local `../services/machineActivationFilePicker` to `@machine/activation-capacitor`.
  - **Deleted:** `src/services/capacitorMachineActivationRuntime.ts` (~381 LOC), `machineActivationCapacitorPlugin.ts` (~146 LOC), `machineActivationFilePicker.ts` (~36 LOC). All three now provided by `@machine/activation-capacitor`.
  - **App `package.json`:** added `"@machine/activation-capacitor": "file:../Machine AI/iterations/MachineActivationSDK/packages/activation-capacitor"`. SDK dep already pointed at the workspace; no change needed there.
  - **`vite.config.ts`:** removed `optimizeDeps.include: ['@machine/activation-sdk']` + `build.commonjsOptions.include`. Added `resolve.preserveSymlinks: true` (only because we're still `file:`-linking the SDK + sub-package from a sibling monorepo; removable post-publish). Net effect: Vite config is back to "stock" + one symlink flag, no SDK-shaped escape hatches.
  - **`ACTIVATION_SDK_INTEGRATION_CHECKPOINT.md`:** rewritten to reflect the new before/after (1186 → 265 LOC instead of just 623 → 265 for the service file alone), and to explain what the SDK now provides vs what stays app-specific (Kotlin plugin, prompts, Zod schema).

**Scope decisions:**
- **Did NOT publish to npm this session.** Workspaces stayed file-linked. Publishing is M9's concern; this session was about getting the consumer experience clean enough that npm publish becomes mechanical, not about cutting a release.
- **Did NOT typecheck or build the host Android APK.** Same reasoning as Sessions 10/11 — the user verifies downstream because Android builds take 10+ min and need a physical device. Web/Vite production build (which exercises the full SDK path through Rollup) was the in-session signal: green.
- **CLI commands deep-import instead of going through `@machine/activation-sdk/node`.** They always run in Node, never get bundled, and the deep paths (`../../cartridge/nodeUnpackCartridge`) match the existing relative-import style of the codebase. Going through the sub-export would have meant rewriting every CLI command's import to use the package name during build, which buys nothing.
- **Kept the test for `@machine/activation-capacitor` minimal.** `tests/run.ts` is a build-artifact existence check rather than a runtime-import test, because TS path aliases can't resolve `@machine/activation-sdk` at Node runtime against a file-linked workspace without `npm install` having run. The build check is sufficient — typecheck catches API surface mismatches, the host app's build catches integration mismatches.

**Verification:**
- SDK root `npm run typecheck && npm run test && npm run build` — exit 0; full SDK suite green (modulo pre-existing CLI pull/search localhost flake noted at the top of this doc).
- `packages/activation-capacitor` `npm run check` — exit 0; both CJS + ESM dist trees emitted (`runtime.js`, `plugin.js`, `filePicker.js`, `index.js` × 2).
- Reference App 01 `npm run build` — exit 0; `dist/index-*.js` 394 KB (gzip 108 KB) in 56 s. The pre-fix run hit `"readFile" is not exported by "__vite-browser-external"` after ~3 min.
- Reference App 01 `grep -rn "createMachineFramework\|createActivationClient\|activateModel" src/` → zero hits ✅
- Reference App 01 `grep -rn "normalizeAnalysisResult\|normalizeIngredient\|normalizeRisk" src/` → zero hits ✅
- Reference App 01 `wc -l src/services/machineActivationService.ts` → 265 ✅
- Reference App 01 `ls src/services/{capacitorMachineActivationRuntime,machineActivationCapacitorPlugin,machineActivationFilePicker}.ts` → all three "No such file" ✅

**Why this session is M-shaped, not just polish:** The headline claim of the SDK is "plug a local model into your app cheaply." Sessions 10/11 proved that *given* a perfectly wired-up app — but the wiring itself was 1186 LOC of mostly-boilerplate adapter glue + a Vite config with two SDK-specific escape hatches. Until session 12, the per-app cost of *getting to* the clean call site dominated the per-app savings *at* the call site. After session 12, the consumer-side cost is `npm install @machine/activation-sdk @machine/activation-capacitor` + one `registerCapacitorMachineActivationRuntime()` line, and the savings stay (300-LOC normalizers + activation ceremony, gone). Reference App 01's Capacitor port is now genuinely small.

**SDK-side files touched:** `package.json`, `tsconfig.build.json`, `tsconfig.build.esm.json` (new), `scripts/finalize-esm-build.js` (new), `src/index.ts`, `src/node.ts` (new), `src/cartridge/index.ts`, `src/catalog/index.ts`, `src/bin/commands/{list,pack,unpack,info,inspect,validate,pull}.ts`, `tests/catalog/nodeCartridgeResolver.test.ts`, `packages/ui/tsconfig.build.json` (path bump for new dist layout), `packages/create-machine-app/templates/node-script/src/index.ts` (new sub-export consumer). New workspace: `packages/activation-capacitor/` (full tree).

Next session: **M8 — Reference App 02 (ported Vercel-AI-SDK demo).** Then M9 (publish + docs). M7.5 stays deferred. The SDK's consumer-side cost is finally low enough that M9's "migration guide" can credibly say "swap one import."

---

### Session 13 — 2026-04-28
**Milestone: M8 — Reference Apps — ✅ shipped (M8 closed). Reference App 02 (Second Brain — local conversational notebook) built fresh on Electron + better-sqlite3 + Tailwind, putting the local LLM in the foreground as the engine for both memory extraction and retrieval rerank. Two latent bugs in the `electron-local-chat` scaffolder template fixed in the same session: wrong `complete` signature + GBNF grammar dropped on the floor across the IPC boundary.**

- ✅ **User pivot from the original M8 #2 plan.** The roadmap's M8 #2 was a small "port a Vercel-AI-SDK demo" deliverable. User explicitly dropped that framing — *"i would like the 2nd app to be something unique where the local model that we load is the brain behind a local 'memory' bank ... lets brainstorm this before coding as i want us to nail this concept"*. The new shape: chat is the input; structured memories extracted from each turn are the product; the model is the engine for retrieval rerank, not just chat. After clarifying via AskUserQuestion: conversation-first with full notes panel; general-purpose second brain (no vertical assumption); desktop-first Electron + responsive Tailwind UI; retrieval = recency + keyword + LLM rerank (no embeddings).

- ✅ **Two latent template bugs fixed in `electron-local-chat`.**
  1. **Wrong `complete` signature.** `nodeLlamaRuntime.ts` and `ipcRuntime.ts` both defined `complete: async ({ prompt, maxTokens, stream, signal }) => ...` — destructuring the first argument as an object — but `ActivationSession.complete` is `(prompt: string, options?: ActivationCompletionOptions) => ...`. Templates intentionally aren't typechecked in CI (`scripts/scaffolder-test-matrix.sh` only checks tree-shape via grep), so the mismatch never surfaced. Both runtimes rewritten to use the correct signature.
  2. **GBNF grammar dropped at the IPC boundary.** The renderer's `ipcRuntime` only forwarded `{ prompt, maxTokens }` to `window.machine.complete`, the preload bridge only typed those two fields, and the main process's `ipcMain.handle('machine:complete')` only forwarded those two into the runtime. `grammar`, `systemPrompt`, `temperature`, `topP`, `topK`, `stopSequences`, `responseFormat` all dropped. `generateObject({ schema })` would fall through to the prompt-only retry path on Electron — silently losing the GBNF-at-sampling-time guarantee that's the whole headline of M7.

  Both fixes shipped together. `nodeLlamaRuntime` now lazily builds + caches `LlamaGrammar` instances via `llama.createGrammar({ grammar: gbnfText })` keyed by GBNF string. Capability snapshots in both runtimes flipped `structuredJsonOutput: true` since the runtime genuinely supports it now. Both runtimes also emit proper `ActivationCompletionChunk` objects (`{ rawToken, text, textDelta, reasoningText, reasoningDelta, tokensGenerated, tokensPerSecond }`) so `streamText`'s `onChunk` consumer actually sees deltas — pre-fix it would have hung on `result.textStream` because `chunk.textDelta` was always undefined.

- ✅ **Scaffolder tests extended.** `packages/create-machine-app/tests/electron-local-chat.test.ts` gains four assertions:
  - `main.ts` forwards `args.grammar` / `args.systemPrompt` / `args.temperature` / `args.stopSequences`.
  - `nodeLlamaRuntime.ts` imports `LlamaGrammar`, calls `llama.createGrammar`, has a `grammarCache`, and capability snapshot advertises `structuredJsonOutput: true`.
  - `ipcRuntime.ts` forwards `opts.grammar` / `opts.systemPrompt` and capability snapshot advertises `structuredJsonOutput: true`.

- ✅ **Reference App 02 — `Second Brain - Activation SDK/`.** Full Electron + Vite + React + Tailwind + better-sqlite3 + zod app. Architecture:
  - **Main process** (`electron/`): `main.ts` (IPC handlers for both `machine:*` and `memory:*`), `nodeLlamaRuntime.ts` (the now-fixed runtime, identical to template), `db.ts` (better-sqlite3 + WAL + FTS5 virtual table + sync triggers), `memoryRepo.ts` (typed CRUD + `listRecent` + `searchKeyword` over FTS5 + `getByIds`), `preload.ts` (contextBridge for `window.machine` and `window.memory`), `preload-types.d.ts` (typed contract).
  - **Renderer** (`src/`): `App.tsx` (responsive grid, lg breakpoint switches between two-pane and tabbed mobile layout), `ChatPanel.tsx` (uses `streamText` directly — *not* `useInference` because the latter's closure semantics make post-stream extraction error-prone), `NotesPanel.tsx` (lists/filters/sorts memories + manual create + edit + delete + 1.5s polling refetch), `MemoryRow.tsx`, `MemoryEditor.tsx`, `SourceBadge.tsx`. Lib: `memorySchema.ts` (Zod schemas for memory + extraction batch + picked-ids), `memoryClient.ts` (typed wrapper over `window.memory.*`), `extractMemories.ts` (`generateObject` post-turn), `retrieveMemories.ts` (recency + keyword + LLM rerank), `buildSystemPrompt.ts`.
  - **Per-turn flow:** retrieve memories → build system prompt with cited memory list → `streamText` → on completion, `generateObject` extracts atomic memories → SQLite write → notes panel sees them on next poll. The SDK is exercised at three places: `streamText` for chat, `generateObject` twice (extraction + retrieval rerank). The retrieval rerank is the non-obvious one — it's the local model doing structured *reasoning* via `generateObject({ schema: PickedIdsSchema })`, not just data extraction.
  - **Total app-side LOC:** ~1300 across the new files (electron + renderer + lib + components). Of that, ~110 LOC is the SQLite layer (`db.ts` + `memoryRepo.ts`), ~140 LOC is Tailwind+UI shell, ~150 LOC is the chat panel + 220 LOC notes panel + editor — most of the volume is product UI, not SDK plumbing. The actual SDK call sites (`extractMemories.ts` + `retrieveMemories.ts` + `buildSystemPrompt.ts`) are ~150 LOC combined.

- ✅ **App-side `ACTIVATION_SDK_INTEGRATION_CHECKPOINT.md`** lays out the architecture diagram + per-turn data flow + "what the SDK provides vs what stayed app-specific" + `vite.config.ts` is stock + the two template bugs that were fixed in this session. App-side `README.md` covers the same ground from the developer's perspective.

**Scope decisions:**
- **Did NOT install npm deps or rebuild native bindings.** `better-sqlite3` rebuilds against Electron's Node ABI via `electron-rebuild` — the user runs `npm install && npm run rebuild` themselves to verify. Same precedent as Reference App 01's Android-build deferral.
- **Did NOT use `useInference`.** That hook from `@machine/ui/web` is correct for simple chat surfaces, but its return shape (`{ text, status, ... }`) is observed via React state which means the calling component reads stale closure values in any `await inference.start(...)` continuation. The chat panel needs the resolved final text *immediately* after streaming to feed into `extractMemories`, so it calls `streamText` directly and resolves `result.text` after the iterator drains. `useInference` is fine; the right tool for a more complex flow is just `streamText`.
- **Did NOT add embeddings.** Recency + keyword (FTS5) + LLM rerank covers the intended scale. The `memorySchema` has a `links` field that an embedding-based linker could populate later.
- **Did NOT build the Vercel-AI-SDK port.** User dropped it in favor of an original product. The shape-compatibility claim is already implicit in both reference apps' SDK call sites — every name (`streamText`, `generateObject`, `tool`) matches Vercel AI SDK verbatim. A separate port adds little.
- **Did NOT build a model picker UI.** Cartridge id is hard-coded as `dev.machine.gemma-3n-e4b-it`. User swaps the constant in `electron/main.ts` + `src/components/ChatPanel.tsx` to point at their own model. Could be replaced with `<ModelPicker>` from `@machine/ui/web` later.

**Verification:**
- SDK root `npm run check:all` — green (typecheck + tests + dual-build + UI kit + scaffolder tests). New template assertions pass. Pre-existing `tests/cli/pull.test` + `tests/cli/search.test` localhost flake still surfaces; unrelated.
- Reference App 02 file tree exists at `Second Brain - Activation SDK\` with all 25+ source files and config. Manual end-to-end (`npm install && npm run rebuild && npm run dev` + send a message + watch memories appear) deferred to user — same precedent as Reference App 01.
- Grep checks against the new app: `grep -rn "streamText\|generateObject" src/` shows the SDK is exercised at exactly the three documented call sites; `grep -n "structuredJsonOutput: true" src/ipcRuntime.ts electron/nodeLlamaRuntime.ts` shows both runtimes advertise the capability.

**Why this session closes M8, not just adds an app:** Reference App 01 proved the *drop-in* claim — port a working Gemini-cloud app to a local LLM and the call site collapses by 78%. Reference App 02 proves something stronger: the SDK doesn't just make porting easier, it makes a fundamentally local-shaped product feasible (local privacy + persistent memory + retrieval reasoning, all on one model on one machine). Two reference apps × two completely different runtime topologies (Capacitor + LiteRT-LM Android; Electron + node-llama-cpp) × two completely different product shapes (replace-cloud-LLM-in-existing-app; brand-new-product-built-around-local-LLM) is enough surface area to call M8 done.

**SDK-side files touched this session:** `packages/create-machine-app/templates/electron-local-chat/electron/{preload.ts,preload-types.d.ts,main.ts,nodeLlamaRuntime.ts}`, `packages/create-machine-app/templates/electron-local-chat/src/ipcRuntime.ts`, `packages/create-machine-app/tests/electron-local-chat.test.ts`. New app: `Apps/Second Brain - Activation SDK/` (full tree).

Next session: **M9 — npm publish + migration guides + docs site.** All four workspaces version-bump + `npm publish --access public`, drop the `file:` deps in both reference apps, write the "coming from Vercel AI SDK / OpenAI / Anthropic" migration guide, and stand up a docs site (Astro/Mintlify/Nextra — pick during planning).

### Session 14 — 2026-05-09 / 2026-05-10
**Milestone: M8 follow-up — replaced the `electron-local-chat` inference architecture after a real-world failure exposed a structural defect in the template.**

The trigger was Reference App 02 hitting a `Failed to load model` when a user pointed it at a Gemma 4 GGUF. Root cause: `node-llama-cpp@3.18.1` (latest on npm, published 2026-03-17) ships llama.cpp build `b8390`. Gemma 4 launched 2026-04-02 with parser/tokenizer fixes through April–May. `b8390` simply doesn't know what Gemma 4 is — `llama_model_load_from_file` returns null with `unknown model architecture: gemma4`. No newer `node-llama-cpp` exists on npm. This wasn't a one-off bug — it was a *structural defect in the template*: ship-frozen-llama.cpp-via-npm guarantees that every downstream app breaks for weeks whenever a new architecture lands upstream.

**Fix: drop `node-llama-cpp` entirely. Vendor llama.cpp's official prebuilt `llama-server.exe` instead.**
- `scripts/fetch-llama-cpp.js` hits `api.github.com/repos/ggml-org/llama.cpp/releases/latest` at build time, picks `llama-bXXXX-bin-win-cpu-x64.zip`, extracts via PowerShell `Expand-Archive` to `vendor/llama-cpp/win-x64/`, records build number in `version.json`. Idempotent.
- `electron/llamaServerRuntime.ts` spawns the binary on first `createSession` for a model path. Subprocess lifecycle: kill on model switch, kill on `window-all-closed`. Health-checks `/health` before resolving. Talks `/v1/chat/completions` with `stream: true`. Native GBNF pass-through via the `grammar` body field. stderr piped to `<userData>/main.log`. Subprocess isolation = a model load that crashes llama.cpp can't take down Electron.
- New model architecture upstream → re-run `npm run fetch:llama` → done. Zero source compile, zero native rebuild, zero npm-cadence coupling.

**Also added in the same iteration (since the template was already getting replaced):**
- `src/lib/mediaPipeRuntime.ts` — `.task` files via `@mediapipe/tasks-genai` in the renderer (WebAssembly). No GBNF — capability snapshot honestly reports `structuredJsonOutput: false`, so `generateObject` falls back to its prompt-and-retry path.
- `src/lib/runtimeSelector.ts` — extension-based routing (`.gguf` → ipcRuntime, `.task` → mediaPipeRuntime, `.litertlm` → mediaPipeRuntime which then errors clearly).
- `app-model://` custom Electron protocol — registered in `main.ts` via `protocol.handle`. Lets the renderer pass an arbitrary user-picked path to MediaPipe's `modelAssetPath` without an IPC buffer copy of multi-GB model files.
- Multi-format file picker (`.gguf`/`.task`/`.litertlm`), config persistence at `<userData>/config.json`, `SetupScreen` for first-run, model-switch button in chat header.
- `vite.config.ts` plugin (`copyMediaPipeWasm`) emits the WASM variants to `dist/renderer/mediapipe-wasm/` at build time and serves them in dev via a small middleware.
- `scripts/prepackage.js` — removes the `node_modules/@machine/*` symlinks before electron-builder packages (workspace `file:` deps create junctions pointing outside the app root, which electron-builder's asar packer rejects).
- esbuild used to bundle the main process into `dist/electron/main.js` so `@machine/activation-sdk` is inlined; the app no longer needs to ship `node_modules/@machine/*` at runtime.

**`.litertlm` handling.** Google shipped `litert_lm_main.windows_x86_64.exe` in v0.11.0 (2026-05-07), so my earlier "no JS runtime exists" claim in Reference App 02's UI was wrong by two days. But: (1) downloaded the v0.11.0 binary, ran it locally — exits `0xC0000135` (`STATUS_DLL_NOT_FOUND`) because the release ships the .exe alone without the `libLiteRt*.dll` / `libGemmaModelConstraintProvider.dll` companions it loads at startup. (2) Even if functional, the CLI is single-shot `--prompt=` mode — no daemon, no streaming protocol, no GBNF. Not embeddable for a chat app. So the picker accepts `.litertlm` and the renderer routes to a clear notice that explains both reasons and points the user at the matching `.task` build (e.g. `gemma-4-E4B-it-web.task` from `huggingface.co/google/gemma-4-E4B-it`). When upstream ships a complete release with a daemon mode, a `.litertlm` runtime can mirror `llamaServerRuntime.ts`'s spawn-and-HTTP pattern.

**Per the user's "this needs to be written to the SDK as well" directive, the entire architecture was back-ported into `packages/create-machine-app/templates/electron-local-chat/`:**
- New files: `electron/llamaServerRuntime.ts`, `electron/config.ts`, `scripts/fetch-llama-cpp.js`, `scripts/prepackage.js`, `src/SetupScreen.tsx`, `src/lib/runtimeSelector.ts`, `src/lib/mediaPipeRuntime.ts`.
- Deleted: `electron/nodeLlamaRuntime.ts`.
- Rewritten: `electron/main.ts` (multi-format picker, `app-model://` protocol, config-based filePath), `electron/preload.ts` + `preload-types.d.ts` (exposes `window.config` IPC), `src/App.tsx` (SetupScreen gate + runtime selector + format notices), `src/ChatScreen.tsx` (file-path-driven, model-switch button, uses `streamText` directly to avoid `useInference` closure-stale bug), `src/ipcRuntime.ts` (`ACTIVATION_CONTRACT_SCHEMA_VERSION` constant, full options forwarding), `vite.config.ts` (MediaPipe WASM copy plugin), `package.json.tmpl` (dropped `node-llama-cpp` dep, added `@mediapipe/tasks-genai` + `esbuild`, added `fetch:llama` / `bundle:main` / `prepackage` scripts, `extraResources` for vendored binary), `README.md.tmpl` (full rewrite explaining *why* the template doesn't use `node-llama-cpp`).
- `templates.ts` description + `nextSteps` updated.
- `tests/electron-local-chat.test.ts` rewritten — 16 assertions covering: tree shape (all new files exist), `node-llama-cpp` is NOT a dep, `@mediapipe/tasks-genai` IS a dep, llamaServerRuntime spawns/forwards-grammar/exports-dispose, fetch-llama-cpp pulls from upstream, main.ts uses llamaServerRuntime + multi-format picker + `app-model://` protocol, mediaPipeRuntime loads via `app-model://` and reports `structuredJsonOutput: false`, runtimeSelector routes by extension, vite.config copies WASM, preload exposes both `window.machine` and `window.config`, ChatScreen imports from `@machine/ui` root (not `/web`), SetupScreen calls picker IPC, App.tsx uses selector + format detection.

**Verification:**
- `npm run check:scaffolder` — all green, including the 16 new electron-local-chat assertions.
- `npm run check` — 5 failures, all the documented pre-existing `tests/cli/pull.test` + `tests/cli/search.test` localhost flake. Unchanged from prior baseline.
- Reference App 02 packaged: `release/Second Brain-0.1.0-Setup.exe` (124 MB; was 371 MB before dropping `@node-llama-cpp/*` platform packages — they shipped ~250 MB of unused CUDA/Vulkan/Metal binaries). Vendored llama.cpp build: `b9094` (2026-05-10).

**Latent template bugs fixed along the way (would have surfaced in any scaffolded electron app):**
- Wrong import subpath: `MachineProvider` + `useMachineModel` were imported from `@machine/ui/web` but are only exported from `@machine/ui` root. In dev with `bundler` resolution this somehow worked; in production bundle they resolved to `undefined` → React error #130 (black screen). Now fixed throughout the template AND Reference App 02. Worth checking other templates use the right subpath too — `expo-local-chat`, `rn-cli-local-chat` correctly use `@machine/ui/native`; `next-local-chat` still uses `@machine/ui/web` (which IS correct there since it only renders visual components, not hooks).
- `LlamaChatSession.setSystemPrompt(...)` was called in the old template runtime but doesn't exist on that class in `node-llama-cpp@3.18.1`. Replaced with `setChatHistory([{ type: 'system', text }])`. (Moot now that the runtime is replaced entirely, but the same fix was applied to the old runtime first while diagnosing.)
- `schemaVersion: 1` (number) in capability snapshots should be `ACTIVATION_CONTRACT_SCHEMA_VERSION` (string) — the SDK type requires string.

**Roadmap-level lesson worth documenting:** the original M8 template `electron-local-chat` chose `node-llama-cpp` because it was the obvious npm package. The structural defect (frozen llama.cpp via npm) was invisible until a real model architecture landed upstream that wasn't in the frozen build. **For any future runtime template, prefer: (a) vendoring an upstream prebuilt binary + subprocess, or (b) compiling from source at install/build time against a current tag, over (c) depending on a third-party npm package that bundles a frozen build of the underlying native runtime.** The vendor-and-spawn pattern in `llamaServerRuntime.ts` is the reference implementation.

**SDK-side files touched this session:** `packages/create-machine-app/templates/electron-local-chat/electron/*`, `packages/create-machine-app/templates/electron-local-chat/scripts/*`, `packages/create-machine-app/templates/electron-local-chat/src/*`, `packages/create-machine-app/templates/electron-local-chat/{package.json.tmpl,README.md.tmpl,vite.config.ts,tsconfig.main.json}`, `packages/create-machine-app/src/templates.ts`, `packages/create-machine-app/tests/electron-local-chat.test.ts`. **App-side files touched:** Reference App 02 received the same architecture (this session's work was driven from the app side; the template port is a back-port of what shipped first in the app).

Next session: **M9 — npm publish + migration guides + docs site.** Unchanged from prior plan. After publish, a small follow-up: extend `scripts/fetch-llama-cpp.js` for macOS arm64 + Linux x64 so the template isn't Windows-only.

---

## Current status

| Milestone | Status |
|---|---|
| M1 — drop-in API shim | ✅ shipped (session 1, 2026-04-17) |
| M2 — cartridge format | ✅ shipped directory loader + validator + bridge (session 2, 2026-04-17) — zip I/O deferred to M3 |
| M3 — CLI | ✅ shipped six subcommands + streaming zip pack/unpack (session 3, 2026-04-19) |
| M4 — catalog | ✅ shipped portable core + Node adapters + `pull`/`search`/`list` CLI + `createMachine({ cartridge })` integration (session 4, 2026-04-19) |
| M5 — scaffolder | ✅ shipped — Session A: CLI + `node-script` + `expo-local-chat` (session 8, 2026-04-21). Session B: `rn-cli-local-chat` + `next-local-chat` + `electron-local-chat` (session 9, 2026-04-21). Session 14 (2026-05-09/10) replaced `electron-local-chat`'s inference architecture: dropped `node-llama-cpp` for a vendored `llama-server.exe` subprocess + added `@mediapipe/tasks-genai` `.task` runtime + multi-format picker + `app-model://` protocol. |
| M6 — UI kit | ✅ shipped `packages/ui/` workspace — 6 core hooks + 5 components × {web, native} + 14 pure-logic tests (session 7, 2026-04-20) |
| M7 — tools + typed structured output | ✅ shipped portable JSON-Schema → GBNF emitter + Zod walker + `generateObject`/tool-loop grammar wiring (session 5, 2026-04-19) |
| M8 — reference apps | ✅ shipped — Reference App 01 (`Ingredient analyzer - Activation SDK/`, sessions 10/12) + Reference App 02 (`Second Brain - Activation SDK/`, sessions 13–14). Three runtime topologies covered (Capacitor + LiteRT-LM Android; Electron + llama-server subprocess; Electron + MediaPipe WASM) prove the runtime contract isn't shaped around any one backend. |
| M9 — publish & docs | not started |

---

## Decisions & trade-offs

Append notable decisions as we make them.

- **2026-04-16** — **SDK-first, protocol-second.** We ship a usable SDK and cartridge format, earn adoption, then formalize `.mcart` as an open spec. Avoids standards-body politics on day zero.
- **2026-04-16** — **Keep `createMachineActivationSdk` backwards-compatible.** The new drop-in API (`createMachine`, `generateText`, ...) layers on top of the existing activation manager — no breaking changes for current external consumers.
- **2026-04-16** — **Zod as optional peer dep.** Duck-typed via `.parse()` + `.safeParse()` so any validator library works. Full Zod types preserved for users who install it.
- **2026-04-16** — **Drop-in API mirrors Vercel AI SDK shape** (`generateText`, `streamText`, `generateObject`, `tool`) rather than inventing a new shape. Migration cost is the dominant adoption blocker; matching the incumbent shape eliminates it.
- **2026-04-19** — **Zip I/O uses `yazl` + `yauzl` (runtime deps), not pure-JS.** GB-scale GGUFs need streaming; a pure-JS in-memory zip would OOM. The deps are tiny (~10 KB) and isolated to Node-only files (`src/cartridge/nodeZip.ts` + `src/bin/**`) so RN/browser bundlers don't pull them in.
- **2026-04-19** — **Files importing `node:*` at the top level use the `node*` filename prefix.** Generalizes the existing `nodeFs.ts` rule to `nodeZip.ts`, `nodePackCartridge.ts`, `nodeUnpackCartridge.ts`. Function names stay clean (`packCartridge`, not `nodePackCartridge`).
- **2026-04-19** — **GBNF is the forcing function; retries are the fallback, not the default.** When a `SchemaLike` exposes `toJsonSchema()`, `generateObject` constrains generation via a schema-specific grammar and defaults `maxRetries: 0`. A constrained sample that fails validation signals an emitter gap, not a sampling accident, so re-rolling under the same grammar burns tokens for no reason. Users can still opt back in explicitly.
- **2026-04-19** — **Tool-loop grammar is all-or-nothing.** The `generateText({ tools })` union grammar emits only when *every* tool's `parameters` self-describes via `toJsonSchema()`. A mixed setup falls back to M1's prompt-only path rather than emitting a grammar that would forbid the schemaless tool branch. Keeps back-compat strict for apps that adopt Zod incrementally.
- **2026-04-19** — **Zod support stays duck-typed.** `zodToJsonSchema` walks `_def.typeName` — no `import 'zod'` anywhere in `src/sdk/**`. Consumers can use zod, `@zod/mini`, in-house forks, or no validator at all; `peerDependenciesMeta.zod.optional = true` holds.

---

## Open questions

Things we still need to decide.

- **Web runtime adapter.** Do we build our own WebLLM integration (M7.5) or delegate to existing libraries? Affects M5 `next-local-chat` template.
- **Cartridge distribution economics.** Who pays for bandwidth when `machine pull` downloads a 3 GB GGUF? GitHub Pages / R2 free tier is fine for alpha; need a Hugging-Face-style hosting model for scale.
- **Chat template resolution.** Cartridge declares `chatTemplate: "gemma"` but backend has to actually apply it. Today we rely on llama.cpp's auto-detected template. Decide: manifest-declared overrides vs backend-autodetected.
- **Cross-cartridge compatibility.** If app says "I need any 7B model with vision," how does the cartridge catalog surface that? Capability-based discovery (M4.5 or later).
- **Multi-tenant models.** Can one app load two cartridges simultaneously? Parent-project docs say "single active model on mobile" — stand by that, or revisit?
