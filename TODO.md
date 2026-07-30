# TODO — Machine Activation SDK

> Updated 2026-07-24 after the *first live-hardware* session. Read alongside
> `PLATFORM_MATRIX.md` (platform ledger), `sdkgaps.md` (defect list from a real
> integration), `PORTABILITY_GAPS.md` (defect list from the first **non-JS**
> port — start there, it holds the current highest-priority item), and
> `PUBLISHING.md` (release plumbing).
>
> **2026-07-30:** porting a Python desktop app (GPT4FreeCAD, a FreeCAD
> workbench) surfaced seven issues, five now fixed. The one that matters most is
> open: the schema→GBNF compiler exists only in TypeScript, so a Python consumer
> needs Node.js to get grammar-enforced output — which makes the Python client a
> client of a Node server rather than a peer. See `PORTABILITY_GAPS.md` #1.

---

## 0. Product focus (set 2026-07-24 — read this first)

**Machine AI is the adapter layer for local models.** The bet: open-source and
specifically *local* models are going to be in demand. The product lets a developer
plug a GGUF into an app like an adapter, extremely easily — serving two audiences:

1. **Port** conventional cloud-first apps onto local models
2. **Build** new local-only apps with the SDK as the backbone

Two verbs define it:

- **test** — point at a model file: does it run *here*, does it fit, how fast,
  what's degraded, what acceleration is live? → **`machine doctor` is this verb**
  (shipped 2026-07-24).
- **package** — bundle that model into your shipped app. → `machine pack` /
  `pull` / the `.mcart` format, still blocked on a real catalog (§3).

**Scope is all five platforms: Windows, macOS, Linux, Android, iOS.**

### What this means for the API surface

The Vercel-AI-SDK-shaped surface (`generateText` / `streamText` / `generateObject`)
is the **porting on-ramp**, not the identity. It stays — "swap one import" is the
entire porting story and nothing beats it on familiarity. But it must not lead.

The reason: **the cloud API shape has no vocabulary for anything that matters
locally.** There is no `model.load()` in a cloud SDK because loading is free and
instant; locally it's 3–30 seconds and several GB of RAM. There is no "will this
fit on this device" because cloud has one model. No thermal, no model swapping, no
quantization tradeoff, no offline-by-default.

The **activation contract is that missing vocabulary**, and it's currently buried
under a surface borrowed from a world where none of those problems exist. Promote
the contract; keep the shim as a compat layer.

Judge every new piece of work by: *does this make "plug a GGUF into any app on any
OS" easier?*

The shell-protocol concept (2026-03, `../../MachineAI/`) is retired.

---

## 1. ✅ Done 2026-07-24 — runtime adapters across five platforms

See `PLATFORM_MATRIX.md` for the full ledger. Summary:

- **Desktop lane was Windows-only.** `fetch-llama-cpp.js` hardcoded a single
  win-x64 asset + PowerShell extraction. Now selects per host
  (win32/darwin-arm64/darwin-x64/linux), extracts via `unzip`/`ditto` on POSIX,
  restores the executable bit, supports `LLAMA_CPP_ASSET` for CUDA/Vulkan builds,
  and records the choice in `version.json`. `llamaServerRuntime.ts` resolves the
  binary from that record and passes `--n-gpu-layers` when the build supports it.
- **Three of seven adapters violated the session contract** — `expo`, `rn-cli`, and
  `next` all destructured `complete`/`completeChat`'s *first argument* as an
  object, so every SDK call passed a string where an object was expected. Same
  defect the Electron template had fixed in session 13; never back-ported. Fixed.
- **Grammar was dead on mobile.** Both mobile adapters hardcoded
  `structuredJsonOutput: false` and dropped `options.grammar`. They now use
  `resolveStructuredOutputGrammar(...)`. This was the SDK's most differentiated
  feature, switched off on its most important platform.
- **GPU offload was disabled on mobile** (zero layers). Now requests full offload
  and reports *observed* acceleration via `context.gpu` / `reasonNoGPU` / `devices`.
- **`completeChat` discarded history** in the Electron lane (sent only the last
  message) — broke multi-turn chat and the tool loop. Fixed.
- **`tool` role folding** (`sdkgaps.md` #5) handled in all four llama/web adapters.
- **`schemaVersion: 1`** (number) corrected to `ACTIVATION_CONTRACT_SCHEMA_VERSION`
  (string) in mobile, web, and `ipcRuntime`.
- **Guardrail added:** `npm run typecheck:adapters` typechecks all seven adapters
  against the real contract using ambient stubs in `packages/create-machine-app/types/`.
  Wired into `check`. It caught the `ipcRuntime` bug on first run.
- 52 scaffolder tests green (was 44); 8 new regression tests pin the fixes.

**Not done: none of this has run on real hardware.** Every non-Windows row in the
matrix is "wired and typechecked," not "verified." See item 2.

---

## 1b. ✅ Done 2026-07-24 — first live hardware run + SDK defect sweep

- **Windows x64 is verified.** A real GGUF (Qwen2.5-0.5B-Instruct-Q4_K_M) loaded
  through `llama-server` and generated tokens via the SDK: 3.7 s load, 1.05 s to
  first token, 12.3 tok/s decode on an i7-10510U, and grammar-constrained
  `generateObject` returned `{"language":"French","confidence":0.95}`. Full
  numbers in `PLATFORM_MATRIX.md`. This is the first inference this project has
  ever actually run.
- **`machine doctor` shipped** (see §4 below, now closed).
- **Tool-loop grammar cliff fixed** (was §5).
- **`abortSignal` honored end-to-end** (was §6).
- **`toolChoice` implemented, duplicate `system` removed, zod v4 supported**
  (was §7).
- **Test-suite stall root-caused and fixed** (was §8). Suite went from ~4–5 min
  to **37 s**.
- 199 SDK tests green (was 157), 14 UI, 52 scaffolder.

---

## 1c. ✅ Done 2026-07-25 (session 17) — the adapter layer became installable, and reachable from any language

The product claim is "plug a GGUF into any app on any OS." Session 17 fixed the two
things that made it untrue in practice.

- **There were four copies of the llama-server adapter**, and no fix ever moved
  between them: `doctorRuntime.ts`, the `electron-local-chat` template's vendored
  526-line file, `Collecta-Local/lib/local/runtime.ts`, and
  `Ingredient analyzer/src/services/capacitorMachineActivationRuntime.ts`. Each
  had drifted differently — dropped chat history, `streaming: false`, a
  `capabilitySnapshot` missing `schemaVersion`. Now **one** implementation in
  `src/runtime/`, portable (`llamaServerRuntime`, `stubRuntime` — no `node:*`) with
  the process manager (`startLlamaServer`, `ensureLlamaServer`,
  `discoverLlamaServer`) behind `machineai-activation/node`. Doctor and the
  template both delegate; the template went 526 → 141 lines. A test enforces the
  portable/Node split at the source level.
- **`machine serve`** — OpenAI-compatible HTTP (`/v1/chat/completions` streaming +
  non-streaming, `/v1/completions`, `/v1/models`) plus `/machine/activation` for
  the contract. This is what makes a non-JS app possible at all;
  `response_format.json_schema` compiles to GBNF so a Python caller gets the same
  guarantee `generateObject` gives TypeScript.
- **Tool calling over HTTP**, so an *agent* is portable and not just a chat box.
  `tools`/`tool_choice` in, OpenAI `tool_calls` out, client executes, feeds a
  `tool` message back. The envelope, grammar and parser moved to
  `src/sdk/toolProtocol.ts` and are shared verbatim with `generateText`'s
  in-process loop — same reliability, different driver. **Verified live from
  Python against Gemma 4:** the model called `get_weather({city:'Paris'})`, Python
  executed it, and the model answered from the result in 28.6 s.
- **The Python client is `pip install machine-activation`**, not a file to vendor.
  `pyproject.toml` + `chat_tools`/`ToolCall` + a `machine-activation-check`
  console script. Agent On Deck's `sys.path` hack is gone.
- **`clients/python/machine_activation.py`** — dependency-free Python client
  (stdlib only): `chat`, `chat_stream`, `chat_json`, `describe_image`,
  `activation()`.
- **Found on hardware: thinking models were reported as producing nothing.** A live
  Gemma 4 E4B run measured **0 tokens and an empty sample** because the adapter
  read only `delta.content` and the model spent its whole budget on
  `reasoning_content`. Fixed end to end (`reasoningText`/`reasoningDelta`,
  `streamText`'s new `onReasoning`, and a doctor report line). After the fix the
  same run measured 93 tokens at 2.5 tok/s. `generateObject` had always worked,
  because a grammar forces immediate JSON — which is exactly why static analysis
  and 199 passing tests never saw it.
- **Also found on hardware: a loading model was being killed as a timeout.**
  `/health` returns `503 loading model` while warming; the fixed 120 s deadline
  aborted a load that was progressing. The wait is now a *silence* budget that
  resets on observed progress, bounded by `loadTimeoutMs` (15 min).
- **Smaller:** `grammar` is now a public option on `generateText`/`streamText`
  (constrained *streaming* was impossible before); `extraBody` passes backend
  sampler knobs the contract does not model; `responseFormat: 'json'` reaches the
  wire as `response_format`.
- **All three target apps repointed and verified** — see §2b.
- 256 SDK tests (was 199), 52 scaffolder, `check:all` clean. New: `PORTING.md`.

## 1d. ✅ Done 2026-07-26 (session 18) — the four things that were still honestly weak

Session 17 made the adapter layer installable and reachable from any language.
The four items below were what remained between that and "an app can just use
this."

- **`streamText({ tools })` — the largest remaining API gap (`sdkgaps.md` #1) is
  closed.** An agentic loop can now stream. The obstacle was not the loop, it was
  that the *final answer lives inside the grammar-constrained envelope* too, so
  "stream the answer step" still meant emitting `{"answer":"Par`.
  `createEnvelopeStreamParser` decodes the `answer` string incrementally —
  including escapes split across chunk boundaries — while tool steps buffer
  silently and surface as `steps`/`toolCalls`. Nothing ambiguous is ever emitted,
  because text shown to a user cannot be withdrawn.
  **The loop itself moved to `src/sdk/toolLoop.ts` and both drivers call it.** A
  forked tool loop is worse than a forked adapter: the ways it drifts are
  invisible until an agent misbehaves in production.
  *Verified live against Gemma 4 E4B:* tool executed, 19 deltas streamed,
  `deltas.join('') === text`, no envelope fragments leaked, 41.7 s.
- **A non-JS app can start its own model.** `machine serve --supervised` emits one
  line of JSON on stdout when ready (`{"event":"ready","url":…}`) and exits when
  stdin closes; `--port 0` takes a free port, which is only knowable through that
  handshake. On the Python side, `MachineServer` spawns, waits, **attaches to a
  healthy server already on the port instead of loading a second 4 GB copy**,
  restarts with backoff on an unexpected death, and kills the whole tree on the
  way out.
  The tree part is the one that bites: `machine serve` spawns `llama-server` as a
  *grandchild*, so killing the child strands the process actually holding the
  weights. Shutdown closes stdin first (letting the server take its own child
  down), then falls back to `taskkill /T` or `killpg`. Stdin-close is also the
  only cross-platform signal a child gets that its parent was *killed* — Windows
  has no `PDEATHSIG` and no inherited process group.
  *Verified live:* Python → `cmd.exe` → node → `llama-server`, ready in 23.7 s on
  an OS-assigned port, grammar JSON and a tool call over HTTP, and **zero
  orphaned `llama-server` processes after `stop()`**.
- **The Python client is a real distribution.** `clients/python` is now a package
  (`machine_activation/{client,server}.py`, `py.typed`), builds an sdist and a
  wheel, and passes `twine check`. 11 supervision tests run against a fake CLI
  that speaks the handshake — no weights needed — on Windows, macOS and Linux
  across Python 3.9 and 3.13, because the supervisor touches process groups,
  `taskkill` and pipe lifetimes, which differ per platform.
  **Still not on PyPI** — see §9. The workflow uses trusted publishing and the
  publisher has to be registered by the account owner; `PUBLISHING.md` has the
  exact steps.
- **Agent On Deck's coverage is now true and named.** It claimed 7 of 13 call
  sites and implemented 5 — `describe_action_batch` and `synthesize_task_writeup`
  were listed as covered while neither function existed. Both are implemented
  now (the map step samples frames, because a local VLM cannot take a whole batch
  the way Gemini can), so the claim is finally accurate. More importantly the
  claim is **executable**: `local_model.COVERAGE` is a table, `coverage_report()`
  computes the counts, and an import-time assertion fails if any verb marked
  local is not actually implemented.
  Two things the docs now say plainly rather than imply: **"Agent On Deck runs on
  local models" is not true** — 6 of 13 sites need a different class of engine
  (STT, TTS, embeddings, search), not a bigger LLM — and `local_model.py` is
  still **not wired into any call site**, so the app runs entirely on cloud
  Gemini today.
  There is a second axis the old table hid: **four of the seven local verbs need
  `--mmproj`.** With no projector, coverage is 3 of 13, and it degrades quietly.
- 277 SDK tests (was 256), 11 Python tests, `typecheck` clean.

---

## 2. 🔴 Run a model on macOS, Linux, iOS, Android

Windows is done. The remaining four are what the platform claim rests on: one
GGUF, one prompt, one `generateObject` call on a Mac (Metal), a Linux box, an
iPhone, and an Android device. Confirm `context.gpu === true` where expected and
that grammar-constrained output actually parses.

**This is now a much smaller job than it was.** `machine doctor --run <model.gguf>`
does the whole check in one command and prints load time, time-to-first-token,
decode throughput, observed acceleration, and whether grammar works. On macOS and
Linux it should be: `npm run fetch:llama` in the electron template, then
`machine doctor --run model.gguf --gpu-layers 999`. Mobile still needs a host app,
since `llama.rn` can't be driven from a CLI.

Typechecking proves shape, not behavior — and note that a real run immediately
surfaced two things static analysis had not: the throughput number was being
computed across prompt-eval time, and `spawn` ENOENT escaped as an uncaught
exception.

---

## 2b. ✅ Done 2026-07-25 — the three local apps run on the live SDK

Verified on this machine against a real Gemma-4 E4B Q4_0 GGUF (3.93 GB) and a
vendored `llama-server` (build b9543), both already present in `Collecta-Local`.

| App | Was | Now | Verified by |
|---|---|---|---|
| `Collecta-Local` (Next.js) | vendored `file:` tarball from **May 28** — pre-rename, missing every fix since | `machineai-activation`; both adapters delegate to the SDK | stub pipeline smoke (capture → PGlite → filed in bucket) **and** a real-model tool loop: Gemma 4 called `web_search`, used the result, answered `BLUE-OTTER-42` |
| `Ingredient analyzer` (Capacitor) | pinned to the **abandoned** `MachineAI-codex` iteration at `0.1.0-alpha.0` | `machineai-activation` + `machineai-activation-capacitor`; 381-line local adapter → 4-line re-export | `tsc` clean (it had drifted from the contract), `vite build` clean — no `node:*` leaked into the browser bundle |
| `Agent On Deck - Local` (Python sidecar) | **could not use the SDK at all** — 100% Python AI surface | `sidecar/local_model.py` over `machine serve`, via `pip install machine-activation` | live: grammar-constrained JSON with correct types in 19.8 s; streaming; **and a full agent loop** — Gemma 4 called `get_weather({city:'Paris'})`, Python executed it, model answered from the result (28.6 s). Degrades to `gemini.py`'s no-key shapes when serve is down |

Notes:

- `Collecta-Local` has **no git**. Backups of the files changed are in the session
  scratchpad. Its 8 remaining `tsc` errors are pre-existing implicit-`any`s in
  files this work never touched (`app/`, `components/`, `lib/actions/`).
- `Collecta-Local/lib/local/runtime.ts` still contains the now-unused
  `llamaChat`/`buildSession`/`buildSnapshot` helpers. Harmless (no
  `noUnusedLocals`) but they should be deleted.
- The Ingredient Analyzer is **wired, not device-verified** — a Capacitor port
  needs an APK on hardware, and the native Kotlin plugin (`MachineActivation`)
  cannot be exercised from a desktop build.
- **Superseded by §1d for Agent On Deck.** The row above says "a full agent loop"
  and that is true of the *SDK path*, but `local_model.py` covers 7 of 13 call
  sites and is wired into none of them. Read §1d before quoting this table.
- `Agent On Deck`'s `local_model.py` is **additive**: `gemini.py` is untouched and
  cloud stays the default and fallback. Wiring it into call sites is the next step.
  STT, TTS, bidi speech-to-speech, embeddings and search grounding have no
  llama.cpp equivalent and are named in `local_model.UNSUPPORTED`.

## 3. ✅ Done 2026-07-24 — the catalog is live and `machine pull` works

`machine pull qwen2.5-0.5b-instruct` now works **with no flags, from a clean
machine**. Verified end to end on Windows: 367.50 MB pulled from the public
internet in 2m31s, sha256 verified, unpacked, and `machine doctor --run` on the
result reported `verdict: ready` with grammar-constrained JSON working.

- **Catalog:** <https://revhappy.github.io/catalog/catalog.json> — repo
  `revhappy/catalog`, served by GitHub Pages, MIT.
- **First cartridge:** `qwen2.5-0.5b-instruct` v1.0.0 (Qwen2.5-0.5B-Instruct
  Q4_K_M, Apache-2.0), packed with `machine pack`.
- **Default URL repointed** in `src/bin/commands/{pull,search}.ts`.

**The old default was never going to work.** It pointed at
`machine-ai.github.io`, and `machine-ai` is a dormant GitHub *user* account from
2019 that we don't control (`machineai` is taken too). This was a namespace
problem wearing a hosting problem's clothes.

**Weights ship as release assets, not repo files.** A `.mcart` is 367 MB and
git's hard per-file cap is 100 MB, so `catalog.json` lives on Pages and the
archives are GitHub Release assets (2 GB each). That keeps the catalog small
enough to fetch on every `search`, diff in a PR, and review by hand, while the
bytes it points at stay content-addressed.

`scripts/add-cartridge.js` in the catalog repo reads the manifest straight out of
an archive and computes size + sha256, so entries are never hand-hashed.

### Still open on the catalog

- **Only one cartridge.** A catalog of one is a demo. Next: a 1–3B instruct model
  and something with a different architecture, so `machine search` has to
  actually discriminate.
- **Bandwidth has no plan.** GitHub Releases is fine at this volume and is not a
  distribution strategy. See the "Cartridge distribution economics" open question
  in the roadmap.
- `catalog/cartridge-catalog.sample.json` in *this* repo is still the
  `example.invalid` fixture. That's intentional — it's a test fixture, not the
  live catalog — but don't mistake it for one.

## 4. ✅ Done — `machine doctor <model.gguf>` surfaces the **test** verb

`machine doctor <model.gguf> [--run]`. Static mode needs no catalog, no network,
no runtime: it parses the GGUF header directly (`src/model/gguf.ts` — portable,
no `node:*`; `nodeGguf.ts` does the file reading) for architecture,
quantization, parameter count, context window and chat-template presence, probes
the device, and runs the whole thing through `resolveCapabilityContract` so the
memory-fit verdict comes from the activation contract rather than a parallel
implementation.

`--run` loads the model through `llama-server` and reports observed load time,
time-to-first-token, decode throughput, acceleration and — importantly — whether
grammar-constrained JSON *actually* works, by calling the real `generateObject`.

Two design notes worth keeping:

- **Backend capability ≠ backend installed.** The first cut set
  `sessionCreationAvailable: false` when no binary was found, which made the
  contract declare a perfectly good model "not recommended". Those are different
  questions; the missing binary is now an advisory.
- **Throughput excludes prompt eval.** Blending prompt evaluation into tokens/sec
  made a short generation look 5× slower than the model decodes. Doctor reports
  time-to-first-token and decode rate separately, as llama.cpp does.

The live-run runtime (`src/bin/commands/doctorRuntime.ts`) is deliberately
CLI-internal, not a shipped SDK runtime — see the roadmap decision entry.

## 5. ✅ Done — tool-loop grammar cliff

`buildToolLoopGrammar` no longer returns `undefined` when a tool lacks
`toJsonSchema`. The outer `{"tool","args"} | {"answer"}` envelope is always
locked; only the offending tool's `args` degrades to "any JSON object". Verified
live: a 0.5B model with an unschema'd tool still produced a well-formed tool call
and terminated in 2 steps.

This reverses the deliberate 2026-04-19 "all-or-nothing" decision, which field
experience in `sdkgaps.md` #2 had already contradicted.

## 6. ✅ Done — `abortSignal` honored

`ActivationCompletionOptions` gained an optional `abortSignal` (documented as:
adapters that can cancel natively should honor it; the SDK also calls
`session.abort()`). `generateText`, `streamText` and `generateObject` all forward
it, link it to `session.abort()`, and check between tool-loop steps. Listeners are
removed when a call settles so a stale controller can't cancel a later call on the
same session. Rejections are `Error` with `name === 'AbortError'` — not
`DOMException`, which isn't reliable across RN runtimes.

Verified live: cancelled an in-flight generation in 731 ms.

## 7. 🟡 Remaining `sdkgaps.md` items

- ~~`streamText` has no `tools`.~~ Done in session 18 — see §1d. `machine serve`
  still deliberately never streams a *tool step* over HTTP: the response is a
  grammar-constrained JSON envelope, and streaming its fragments would emit
  partial JSON no OpenAI client can assemble into a `tool_calls` delta. In
  process there is no such constraint, which is why `streamText` can do what the
  wire format cannot.
- ~~`toolChoice` accepted but never read.~~ Done. `'none'` skips the loop,
  `{ toolName }` forces that tool on the first step only (grammar drops the
  `answer` branch and every other tool), then reverts to `auto` so the loop can
  still terminate. Naming a tool that wasn't passed throws.
- ~~The caller's `system` is sent twice.~~ Done — the tool loop no longer sets
  `completionOptions.systemPrompt`, since the preamble in `messages[0]` already
  carries it. The adapter-level workarounds are now belt-and-braces.
- ~~`zod` peer range excludes v4.~~ Done — peer is now `>=3.22.0 <5`, and
  `zodToJsonSchema` handles **both** major versions (v4 renamed
  `_def.typeName` → `_def.type`, moved array elements to `_def.element`,
  literals to `_def.values`, enums to `_def.entries`, and encodes int as
  `format: 'safeint'`). Both versions are installed side by side as `zod3` /
  `zod4` devDeps and round-trip tested against the real library — the previous
  mock-only tests could never have caught this.
- ~~Document that streaming requires **`onChunk`**, not `onToken`.~~ Done —
  `ActivationCompletionOptions` now says so at both fields.

## 8. ✅ Done — test-suite stall, and it wasn't a flake

All three harnesses (`tests/`, `packages/ui/tests/`,
`packages/create-machine-app/tests/`) now run sequentially with a per-test
timeout (`MACHINE_TEST_TIMEOUT_MS`, default 60 s) and print a pass/fail summary
plus a duration for anything over 5 s.

**The real root cause was narrower than the concurrency diagnosis.** Sequential
execution immediately fingered a single test:
`machine pull exits 1 when the catalog does not contain the id` took
**309,684 ms**. It used the blocking `runCli` (`spawnSync`) while needing the
in-process catalog server to answer — so the parent event loop was held for the
child's entire life, the server could never respond, and the child sat until
undici's 300 s headers timeout, then exited 1. The test asserted exit code 1, so
it *passed*, for entirely the wrong reason, and burned five minutes doing it.
Every other server-backed test already used `runCliAsync` correctly.

Fixed by switching that one call and asserting the error mentions the missing id,
so it can't pass on a timeout again. `runCli` also got a 30 s `spawnSync` timeout,
since a blocked event loop means the harness's own timer can't fire.

Suite: **~4–5 min → 37 s**, 199 tests.

## 9. 🟢 Housekeeping

- **Publish `machine-activation` to PyPI.** The package builds, passes
  `twine check`, and `.github/workflows/python-client-release.yml` is wired for
  trusted publishing on a `python-client-v*` tag. What is missing is a one-time
  registration only the account owner can do: add a pending publisher on PyPI
  (project `machine-activation`, owner `revhappy`, repo `MachineActivationSDK`,
  workflow `python-client-release.yml`, environment `pypi`) and create a `pypi`
  environment in GitHub. Exact steps in `PUBLISHING.md`. Until then
  `pip install machine-activation` does not work and `pip install -e
  clients/python` does.
- **Wire `local_model.py` into Agent On Deck's call sites.** 7 of 13 are
  implemented and none are routed, so the app still runs entirely on cloud
  Gemini. Behind a provider check, per verb, using `local_model.supports()`.
- **Tag the published release.** `0.2.0-beta.1` is on npm (verified: all four
  packages, published 2026-06-08) but has **no git tag**. Don't naively push
  `activation-sdk-v0.2.0-beta.1` — `.github/workflows/activation-sdk-release.yml`
  triggers `npm publish` on that glob and republishing an existing version fails
  with `EPUBLISHCONFLICT`. Either tag outside the glob (`v0.2.0-beta.1`) as a
  provenance marker, or bump to `0.2.0-beta.2` and let the workflow do a real
  release (which also finally exercises the untested publish path).
- **Repoint `Collecta-Local`** off its vendored `file:` tarball
  (`machine-activation-sdk-0.2.0-beta.1.tgz`, dated May 28 — predates both the
  rename and the publish) onto `machineai-activation@0.2.0-beta.1`. Different repo,
  needs its own session + smoke re-run.
- **Clean up `.pack/`** — four tarballs under the abandoned `machine-*` naming.
  Do after the Collecta repoint, which still depends on one.
- **Repo is 12 GB.** ~16K lines of actual source across all iterations; the rest is
  four `node_modules` trees, `.npm-cache/_cacache`, `dist/` + `.test-dist/`, and a
  vendored `LiteRT-LM` checkout. Only `MachineActivationSDK` is under git — the
  other three iterations in `../` are untracked and unbacked-up.
