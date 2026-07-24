# TODO — Machine Activation SDK

> Updated 2026-07-24 after the *first live-hardware* session. Read alongside
> `PLATFORM_MATRIX.md` (platform ledger), `sdkgaps.md` (defect list from a real
> integration), and `PUBLISHING.md` (release plumbing).

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

## 3. 🔴 Stand up a real catalog

`machine pull` and `machine search` default to
`https://machine-ai.github.io/catalog/catalog.json` (`src/bin/commands/pull.ts:23`,
`search.ts:18`). **That URL is a 404 — the org GitHub Pages site does not exist.**
The only catalog in the repo is `catalog/cartridge-catalog.sample.json`, pointing at
`example.invalid` with an all-zero sha256.

The north-star adoption test in `CARTRIDGE_SDK_ROADMAP.md` is literally
`machine pull gemma-3n`. It fails at step one for every user.

This is the **package** verb — the differentiated half of the product — and the fix
is mostly hosting/content, not engineering: host a catalog, publish one real
`.mcart` for a small model, point the default at it.

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

- `streamText` has no `tools` → can't stream an agentic loop. **Still open** —
  the largest remaining API gap now that the others are closed.
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
- Document that streaming requires **`onChunk`**, not `onToken`. **Still open.**

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
