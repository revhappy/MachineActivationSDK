# SDK gaps & suggestions

> Concrete gaps/suggestions for `machineai-activation` found while integrating it
> into **Collecta-Local** (on-device Gemma 4 E4B via `llama-server`). Captured
> 2026-06-07 against **v0.2.0-beta.1**. To be addressed in a dedicated SDK
> session — none of these block Collecta today (worked around app-side), but
> fixing them removes friction and makes the tool/agent story first-class.
>
> Verdict up front: **the SDK's tool/agent support is real and good** (`generateText`
> runs a full grammar-constrained agentic loop). These are refinements, not a
> rewrite.

Each item: **what → evidence → impact → suggested fix → priority.**

> **Status as of 2026-07-26 (session 18).** Items **1, 2, 3, 4, 5, 6 and 7 are
> fixed** in `src/`. Session 18 closed **1** (`streamText({ tools })` streams an
> agentic loop, sharing the loop core with `generateText` via `src/sdk/toolLoop.ts`)
> and the documentation half of **7** (`onChunk` is now declared as the callback
> an adapter must emit; `onToken` is marked as insufficient to stream from).
> Still open: **8** (unknown tool name ends the loop silently), **9**
> (enhancement). Individual sections below are left as originally written so the
> field evidence stays intact.

---

## 1. `streamText` has no tool support — ✅ fixed 2026-07-26

> **Landed as suggested, including the shared loop core.** `StreamTextOptions`
> now takes `tools`/`toolChoice`/`maxSteps`/`onStepFinish`, and
> `StreamTextResult` gained `steps` and `toolCalls`. Tool-selection steps are
> generated non-streamed (they are a grammar-locked JSON envelope) and reported
> through `onStepFinish`; the final answer streams.
>
> The part that was not obvious from the outside: the final answer is *also*
> inside the envelope, so "stream only the final-answer step" still meant
> emitting `{"answer":"Par`. `createEnvelopeStreamParser` in `toolProtocol.ts`
> decodes the `answer` string incrementally — including escapes split across
> chunk boundaries — so the answer streams as plain text while the grammar stays
> locked. Nothing else is ever emitted mid-flight, because text shown to a user
> cannot be withdrawn.
>
> The loop itself moved to `src/sdk/toolLoop.ts` and both drivers call it.
- **What:** you can run an agentic tool loop (`generateText`) OR stream tokens
  (`streamText`), but not both. There's no way to stream an agent's output.
- **Evidence:** `StreamTextOptions` (`src/sdk/types.ts:100`) extends only
  `CommonGenerationOptions` — no `tools`/`maxSteps`/`onStepFinish`.
  `src/sdk/streamText.ts` has no tool loop (single `complete`/`completeChat`).
- **Impact:** research-report / chat-agent UIs can't stream the model's final
  answer when tools are involved without splitting into two calls
  (`generateText` for the loop, then a separate `streamText` for the answer).
- **Suggested fix:** add `tools`/`maxSteps`/`toolChoice`/`onStepFinish` to
  `StreamTextOptions`; in the impl, run the loop non-streamed for tool-selection
  steps and stream only the final-answer step (emit `onStepFinish` for tool
  steps, push deltas for the answer). Share the loop core with `generateText`.
- **Priority:** High.

## 2. Tool-loop grammar should always lock the envelope
- **What:** the loop only grammar-constrains output when **every** tool exposes a
  JSON schema; if any tool lacks one, it falls back to *no grammar* and trusts
  the system prompt alone to produce `{"tool","args"}` | `{"answer"}`.
- **Evidence:** `buildToolLoopGrammar` (`src/sdk/generateText.ts:314`) returns
  `undefined` if any `def.parameters.toJsonSchema` is missing/throws/returns null.
- **Impact:** small models (e.g. Gemma 4 E4B) are far less reliable at emitting
  the exact protocol JSON without a grammar — they'll drift into prose and the
  loop ends early.
- **Suggested fix:** even when per-arg schemas are unavailable, still constrain
  the **outer envelope**: `{"tool": <enum of tool names>, "args": object}` |
  `{"answer": string}`. Tighten `args` per-tool when a schema exists. This keeps
  the protocol grammar-locked regardless of tool schema availability.
- **Priority:** High (directly affects on-device reliability).

## 3. `toolChoice` is accepted but ignored
- **What:** `GenerateTextOptions.toolChoice` (`'auto' | 'none' | { toolName }`)
  is part of the public type but has no effect.
- **Evidence:** declared at `src/sdk/types.ts:78`; never read in
  `runWithTools` (`src/sdk/generateText.ts:59`).
- **Impact:** callers can't force a specific tool or disable tools for a turn;
  silently no-ops (misleading API).
- **Suggested fix:** honor it — `'none'` → skip the tool branch (plain
  generation); `{ toolName }` → restrict the envelope grammar to that single tool
  branch (and drop the `answer` branch for that step if forcing a call).
- **Priority:** Medium.

## 4. Original system prompt is duplicated in the tool loop
- **What:** in the tool loop the caller's `system` is sent twice — once baked
  into the tool system message, once again via `completionOptions.systemPrompt`.
- **Evidence:** `runWithTools` builds `messages[0] = { role:'system',
  content: buildToolSystemPrompt(tools, options.system) }` (includes
  `options.system`, `generateText.ts:71` + `:251`), then calls
  `completeChat(messages, completionOptions)` where `completionOptions.systemPrompt
  = options.system` via `toCompletionOptions` (`generateText.ts:85,218`). A
  runtime that prepends `systemPrompt` as a system message then emits the system
  text twice.
- **Impact:** wasted context/tokens; mild instruction-repetition that can skew
  small models.
- **Suggested fix:** in `runWithTools`, clear `completionOptions.systemPrompt`
  (system already lives in `messages`).
- **Priority:** Medium.

## 5. `tool` message role portability contract is undocumented
- **What:** the loop emits `{ role: 'tool' }` messages, but many local chat
  templates (notably **Gemma** via llama.cpp `--jinja`) have no `tool` role.
  Each adapter must translate it or the backend may reject/mistemplate the turn.
- **Evidence:** `generateText.ts:162` pushes `{ role: 'tool', … }`;
  `ActivationChatMessage.role` includes `'tool'` (`activationAdapter.ts:64`).
  In Collecta we had to map `tool → user` in the adapter so Gemma's template
  accepts it.
- **Impact:** every runtime author re-discovers and re-solves this; easy to get a
  silently broken loop.
- **Suggested fix:** (a) document the contract in `BACKEND_CAPABILITIES.md`
  ("runtimes must handle the `tool` role; fold into a user turn if the template
  lacks one"); and/or (b) offer an opt-in SDK normalization that converts `tool`
  messages to user turns (e.g. `Tool result: …`) before they reach the runtime.
- **Priority:** Medium.

## 6. `zod` peer range excludes v4 (zod v4 is GA)
- **What:** the peer range caps zod below 4, so apps on zod v4 must install with
  `--legacy-peer-deps` and pass schemas through the duck-typed `SchemaLike`
  instead of the provided `zodSchema()` helper.
- **Evidence:** `package.json:88` — `"zod": ">=3.22.0 <4"` (optional peer).
  Collecta is on zod v4 and works fine at runtime via `SchemaLike` + zod v4's
  `z.toJSONSchema`, but the peer constraint is friction.
- **Impact:** install friction + can't use the first-party `zodSchema()`/
  `zodToJsonSchema` helpers on v4.
- **Suggested fix:** widen to `">=3.22.0"` (or `>=3.22 <5`) and validate
  `src/sdk/zodSchema.ts` / `src/sdk/zodToJsonSchema.ts` against zod v4 (v4 moved
  JSON-schema generation in-tree as `z.toJSONSchema`). Keep it an optional peer.
- **Priority:** Medium.

## 7. Streaming token callback is ambiguous (`onToken` vs `onChunk`)
- **What:** `ActivationCompletionOptions` exposes both `onToken(token)` and
  `onChunk(ActivationCompletionChunk)`. `streamText` drives streaming **only**
  via `onChunk`; nothing documents which one a runtime must implement, so an
  adapter that implements only `onToken` will "stream" nothing through
  `streamText` (text arrives all at once on completion).
- **Evidence:** both defined at `activationAdapter.ts:37-38`; `streamText` uses
  `onChunk` exclusively (`src/sdk/streamText.ts:40`).
- **Impact:** subtle: streaming silently degrades to non-streaming depending on
  which callback an adapter wired.
- **Suggested fix:** document that runtimes must emit `onChunk` for streaming
  (and ideally have the SDK derive `onToken` from `onChunk` so implementing one
  suffices), or consolidate to a single callback.
- **Priority:** Low–Medium.

## 8. Unknown tool name / unparseable step silently ends the loop
- **What:** if the model emits valid JSON naming a tool that doesn't exist (or
  JSON that's neither `answer` nor a known `tool`), the loop treats the raw text
  as the final answer and stops instead of re-prompting.
- **Evidence:** the trailing `else` in `runWithTools`
  (`src/sdk/generateText.ts:171`) sets `finalText = result.text` /
  `finishReason: 'other'` and breaks.
- **Impact:** a single malformed step aborts the agent with raw JSON as the
  "answer."
- **Suggested fix:** on unknown-tool/invalid-shape, append a corrective system/
  user note ("unknown tool X; choose one of: …") and continue until `maxSteps`,
  rather than breaking. (Item 2's envelope grammar already prevents unknown tool
  *names* if `tool` is an enum — these pair well.)
- **Priority:** Low.

## 9. (Enhancement) optional native `tools` / `tool_calls` passthrough
- **What:** the loop uses the SDK's own JSON `{tool,args}|{answer}` protocol via
  grammar. This is a deliberate, backend-agnostic choice (works without native
  function-calling) and is arguably *more* robust on small models — keep it as
  the default. But OpenAI-compatible backends (llama-server `--jinja`, and most
  hosted providers) support native `tools`/`tool_calls`, which can improve
  quality/interop on larger models.
- **Suggested fix:** an **optional** runtime capability + code path that passes
  native `tools` and parses `tool_calls`, selected when the backend advertises
  native function-calling. Default stays the grammar protocol.
- **Priority:** Low (enhancement, not a gap).

---

### Quick reference: where these surfaced in Collecta-Local
- Adapter fixes that *unblocked* tools live app-side in
  `Collecta-Local/lib/local/runtime.ts` (full-history `completeChat`, multi-role
  → llama-server mapping, `tool→user`, honest `toolCalling` flag).
- App-side context + the keyless tool-loop proof:
  `Collecta-Local/LOCAL_MODEL_TOOLING.md`, `scripts/verify-tool-loop.mts`.
