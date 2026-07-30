# Portability gaps — why porting a non-JS app is still hard

> Field notes from porting a **Python desktop app** to a local model with this
> SDK: [GPT4FreeCAD](https://github.com/revhappy/GPT4FreeCAD), a FreeCAD
> workbench that generates parametric CAD from natural language. Captured
> **2026-07-30** against `machineai-activation` 0.2.0-beta.1 / Python client
> `0.2.0b3`→`0.2.0b4`.
>
> Companion to [`sdkgaps.md`](./sdkgaps.md), which covered the tool/agent surface
> from a **JS** integration (Collecta-Local). This file covers the *porting*
> promise — "plug a local model into any app, on any OS, easily" — from the
> non-JS side, which is where it is weakest.
>
> **Verdict up front: this does not need a rewrite.** The protocol ideas (shell
> manifests, the activation contract, cartridges) are sound and the TS core is
> well tested (285 passing). Everything below is a *boundary* problem —
> packaging, discovery, process launching, cross-language parity. Boundaries are
> cheap to fix relative to the value already built.

Each item: **what → evidence → impact → suggested fix → priority.**

---

## The headline finding

**The port succeeded by not using the SDK.** GPT4FreeCAD ended up with ~250
lines of its own standard-library code (`gpt4freecad/llm/backend.py`) to find,
download, launch and talk to `llama-server` directly. Everything the SDK's Python
client offers, it now gets without it — except the activation report.

That is the single most important signal in this document. A porting SDK whose
successful outcome is "I reimplemented the runtime layer" has a shape problem,
not a bug list. The root cause is item 1.

---

## 1. The SDK's value is trapped behind a Node process — ❗ root cause

- **What:** the source of truth is TypeScript. The one capability that matters
  most to a consumer — compiling a JSON schema into a GBNF grammar so a small
  model *cannot* emit malformed output — exists only in TS
  (`src/sdk/jsonSchemaToGbnf.ts`). There is no Python equivalent.
- **Evidence:**
  - `clients/python/` has no grammar module; `MachineClient.chat_json` posts a
    schema and relies on the *server* to compile it.
  - `machine serve` is the only server that does compile it. It is a Node
    program, so a Python consumer needs Node.js + `npm install` to get the
    SDK's headline feature. That prerequisite is nowhere in the Python client's
    README, which reads as though `pip install machine-activation` is enough.
  - Measured on llama.cpp **b10182**, pointing at a bare `llama-server` instead:
    a CAD program schema with one operation branch returned **nothing in 40 s+**,
    and the full 18-branch schema **did not finish in 400 s**. Through
    `machine serve` the same schema on the same model and machine returned a
    valid program in **~40 s, first try**. llama.cpp's own schema→grammar
    conversion is not a usable substitute.
- **Impact:** the Python client is not a peer client of the SDK — it is a client
  of a Node server. "Port your Python app" silently means "ship Node." For
  GPT4FreeCAD, which runs inside FreeCAD's *embedded* Python, that is
  disqualifying, and it forced the app to disable schema enforcement entirely
  for local models and fall back to prompt + retry.
- **Suggested fix:** pick one, in order of preference.
  1. **Port `jsonSchemaToGbnf` to each client.** The client then sends a
     precompiled `grammar` string, which bare `llama-server` accepts and is
     fast. This also makes the client server-agnostic — the single highest-value
     change in this document.
  2. Ship the grammar compiler as a tiny language-neutral service the client can
     start without Node.
  3. At minimum, **document the Node prerequisite loudly** in the Python client
     README and have `chat_json` fail with "this server cannot enforce a schema"
     rather than returning empty content (see item 4).
- **Priority:** **Highest.** Everything else here is survivable; this is the one
  that decides whether non-JS porting is real.

## 2. Nothing in the published package could obtain a backend — ✅ fixed 2026-07-30

- **What:** `discoverLlamaServer` searched `vendor/llama-cpp/<slug>/`, but no
  published artifact ever populated it. The fetcher existed only inside
  `packages/create-machine-app/templates/electron-local-chat/scripts/`.
- **Evidence:** `src/runtime/nodeLlamaServer.ts` referenced `fetch-llama-cpp.js`
  twice in comments; `scripts/` did not contain it. Scaffolding a new app worked;
  `npm i machineai-activation` into an existing app produced a runtime that
  could not find a backend and had no way to get one.
- **Impact:** the "plug into an app you already have" path — the actual porting
  case — dead-ended at `--server <path>` / `$MACHINE_LLAMA_SERVER`, which is the
  manual step the SDK exists to remove.
- **Fixed:** `machine fetch-runtime` (`src/runtime/fetchLlamaServer.ts` +
  `src/bin/commands/fetchRuntime.ts`), and `fetch_llama_server()` in the Python
  client. `serve` and `doctor` now point at it. Verified: fetched b10182
  (17.5 MB), discovered with no configuration.
- **Follow-up still open:** the fetcher is CPU-build only by default on
  Windows/Linux. `--asset` / `$LLAMA_CPP_ASSET` can select CUDA/Vulkan, but
  nothing *detects* a usable GPU and picks the right archive. That is the
  difference between "it runs" and "it runs well," and it is the next thing a
  user will notice after this document's items are closed.

## 3. Per-project vendoring is wrong for a library — ✅ fixed 2026-07-30

- **What:** the backend was fetched into `./vendor/llama-cpp/`, relative to the
  process's cwd.
- **Evidence:** `discoverLlamaServer` walks up from `startDir`; the original
  fetch script wrote under the template app's root.
- **Impact:** correct for one Electron app shipping its own binary; wrong for a
  library. An addon inside FreeCAD, a Blender plugin and a script in `~/work`
  share no directory, so each downloads its own copy of the same file — and a
  package installed into `site-packages` has no relationship to cwd at all.
- **Fixed (Python):** `fetch_llama_server()` defaults to a per-user cache,
  `~/.machine/llama-cpp` (relocatable via `$MACHINE_HOME`), beside the existing
  cartridge cache; `root_dir=` still vendors into a project. `find_llama_server`
  checks the cache first, then project `vendor/`, then PATH.
- **Still open (TS):** `discoverLlamaServer` and `machine fetch-runtime` do
  **not** yet know about the per-user cache, so the two clients disagree about
  where a backend lives. A binary fetched by Python is invisible to the Node
  runtime. **Fix:** add the cache dir to `discoverLlamaServer`'s search and make
  `fetch-runtime` default to it, keeping `--dir` for project-local vendoring.
  **Priority: High** — divergence between clients is worse than either default.

## 4. `chat_json` silently returned nothing against a bare `llama-server` — ✅ fixed 2026-07-30

- **What:** it posted only the OpenAI-style
  `response_format: {"type": "json_schema", "json_schema": {...}}`.
- **Evidence:** measured against llama.cpp b10182. That build accepts the
  request, constrains nothing, runs to the token limit and returns
  `finish_reason: "length"` with **empty content**. Its own spelling is
  `{"type": "json_object", "schema": ...}` (or a top-level `json_schema`), both
  of which return valid JSON. The Python README meanwhile invites you to point
  the `openai` package at the same endpoint, implying compatibility.
- **Impact:** a caller who asked for guaranteed JSON got nothing, with no error —
  the worst available outcome, and it looks like the model's fault.
- **Fixed:** `chat_json` retries with llama.cpp's spelling before giving up.
- **Follow-up:** a retry is a workaround for not knowing the backend. Once item 1
  lands, send a precompiled grammar and delete the guesswork. Better still,
  expose a capability probe so a caller can ask *before* spending a request.

## 5. `cmd.exe /c` truncated any install path containing a space — ✅ fixed 2026-07-30

- **What:** `find_machine_cli` wrapped npm's batch shim as
  `[cmd.exe, /c, <path>]`.
- **Evidence:** `cmd` strips the outermost quote pair of the whole command line
  once a second quoted argument is present, so appending the model path
  truncated the shim path at its first space:
  `'C:\Users\...\Machine' is not recognized as an internal or external command`.
  A bare `--version` probe passes, which is why it was not caught.
- **Impact:** `MachineServer` could not start for anyone under `Program Files`,
  `My Documents`, or any folder with a space. Wrapping the line in another quote
  pair with `/s` does **not** fix it (Python's `list2cmdline` escapes the inner
  quotes as `\"`); not involving `cmd` does.
- **Fixed:** batch shims go straight to `Popen`; a local npm install runs the
  package's own `bin` entry with `node`, one less process in the tree.

## 6. `vendor/` was not gitignored — ✅ fixed 2026-07-30

- **What/impact:** a fetched ~100 MB host-specific binary was one `git add -A`
  from being committed. **Fixed** in `.gitignore`.

## 7. "Wired" outnumbers "verified" 8 to 1

- **What:** `PLATFORM_MATRIX.md` is admirably honest that only Windows x64 has
  been verified on hardware; macOS, Linux, iOS, Android and Browser are "wired,
  untested."
- **Impact:** a porting SDK's whole promise is that it works on setups the author
  does not personally own. The first bug hit in this port (item 5) is exactly the
  class that only appears on someone else's machine — and it was in a code path
  that typechecked perfectly.
- **Suggested fix:** turn the matrix into CI. A GitHub runner per OS that fetches
  a tiny GGUF (Qwen2.5-0.5B is 379 MB), starts a server and generates one
  grammar-constrained object would have caught items 1, 4 and 5. Where a runner
  cannot exist (iOS/Android), say "unverified" in the README too, not only here.
- **Priority:** High.

## 8. Nothing dogfoods a non-JS port

- **What:** every integration exercised in CI is JavaScript. `basic-consumer-check`
  imports the package from Node.
- **Impact:** all seven items above were found by hand, in one afternoon, by one
  consumer. That rate implies more remain.
- **Suggested fix:** add a Python consumer smoke test to CI — install the wheel,
  `fetch_llama_server()`, `LlamaServer(model)`, one `chat_json` — with no Node on
  the PATH. That single job is the regression test for item 1 and would have
  failed loudly on items 2, 3 and 4.
- **Priority:** High.

---

## The test to hold it to

On a clean machine, in any language, with no Node.js:

```python
m = LocalModel("model.gguf")   # fetches a backend if needed, starts it
m.json(messages, schema)        # grammar-enforced output
```

Line one works in Python as of `0.2.0b4` (items 2 and 3). **Line two does not**
— that is item 1, and it is the whole ballgame for non-JS porting.

## Suggested order for next session

1. **Item 1** — port `jsonSchemaToGbnf` to Python; send a precompiled `grammar`.
   Then re-verify GPT4FreeCAD's Structured mode against a bare `llama-server`;
   it currently has to disable schema enforcement and says so in its README.
2. **Item 3 (TS half)** — teach `discoverLlamaServer` and `fetch-runtime` the
   per-user cache so both clients agree where a backend lives.
3. **Item 8** — the no-Node Python CI job, so item 1 cannot regress.
4. **Item 7** — real-hardware CI per platform, or drop the claim.
5. **Item 2 follow-up** — detect a usable GPU and fetch the matching build.

## Cross-repo note

GPT4FreeCAD carries two workarounds that should be deleted once item 1 lands:

- `gpt4freecad/llm/backend.py` — a standard-library reimplementation of
  fetch/spawn/supervise, written because the SDK's Python client needed Node.
- `gpt4freecad/llm/local.py::supports_schema` — probes for `/machine/activation`
  and skips schema enforcement when the server is a bare `llama-server`, because
  constraining there is pathologically slow.

Both are honest workarounds, not fixes. When the SDK can compile a grammar in
Python, the second becomes unnecessary and the first becomes optional.
