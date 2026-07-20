# TODO — Machine Activation SDK

> Picked up 2026-07-20 after an audit run. This is the actionable queue for a future
> clean-context session. Read alongside `sdkgaps.md` (the detailed defect list) and
> `PUBLISHING.md` (release plumbing).

---

## 0. State of the world (verified 2026-07-20)

Correcting a belief that several docs in this repo carried until today:

- **All four packages ARE published to public npm at `0.2.0-beta.1`**, published
  2026-06-08T01:53Z by `revhappy`, MIT, `latest` tag set:
  `machineai-activation`, `machineai-activation-ui`, `create-machineai-app`,
  `machineai-activation-capacitor`.
- `IMPLEMENTATION_STATUS.md`, `PACKAGE_CONSUMPTION.md`, and `PUBLISHING.md` all still
  claimed "not yet published". **Fixed in this commit.**
- The repo is on branch `master`, 5 commits, remote `github.com/revhappy/MachineActivationSDK`.

The consequence: there is **no "name split" problem in this repo.** The rename to unscoped
`machineai-activation` (commit `550f252`, Jun 7) is correct and is what shipped to npm the
next day. The stale name survives only in a *consumer* — see item 2.

---

## 1. Tag the published release ⚠️ CAREFUL

`0.2.0-beta.1` is on npm but **no git tag exists**, so the published artifact isn't linked
to a commit. Worth fixing for provenance.

**Do not naively `git tag activation-sdk-v0.2.0-beta.1 && git push --tags`.**
`.github/workflows/activation-sdk-release.yml` triggers `npm publish` on any
`activation-sdk-v*` tag push, and republishing an existing version will **fail**
(`EPUBLISHCONFLICT`) — a red CI run for no benefit.

Options, pick one:
- Tag with a name outside the trigger glob (e.g. `v0.2.0-beta.1`) purely as a provenance marker; or
- Bump to `0.2.0-beta.2`, then tag `activation-sdk-v0.2.0-beta.2` and let the workflow do a
  real end-to-end release — this also finally exercises the untested release path; or
- Create an annotated tag locally without pushing, if provenance is only for local history.

Also confirm `NPM_TOKEN` still exists in repo secrets before relying on the workflow.

## 2. Repoint `Collecta-Local` off the vendored tarball

`C:\Users\Admin\Desktop\Apps\Collecta-Local\package.json` pins:

```jsonc
"@machine/activation-sdk": "file:./vendor/machine-activation-sdk-0.2.0-beta.1.tgz"
```

That tarball is dated **May 28** — it predates both the rename (Jun 7) and the npm publish
(Jun 8). Collecta-Local was itself last touched Jun 8 00:07–00:14, i.e. **~90 minutes before
the publish landed**, which is the whole explanation for the mismatch. Nothing is broken;
it's just frozen one step behind.

Fix: `npm i machineai-activation@0.2.0-beta.1`, drop the `file:` dep and `vendor/*.tgz`, and
rewrite the import specifier in every consumer file (`lib/local/callLocal.ts`,
`lib/local/runtime.ts`, `lib/local/machine.ts`, `lib/local/tools.ts`, `lib/local/researchLocal.ts`,
`scripts/verify-*.mts`). Note Collecta is on **zod v4** against the SDK's `zod >=3.22 <4`
optional peer, so installs still need `--legacy-peer-deps` until item 5 lands.

**Not done here** — it's a different repo, needs an install plus a re-run of
`npm run slice:smoke` / `actions:smoke` to verify, and that deserves its own session.

## 3. Clean up `.pack/`

`.pack/` still holds four tarballs under the **abandoned** naming scheme
(`machine-activation-sdk-…`, `machine-ui-…`, `machine-create-machine-app-…`,
`machine-activation-capacitor-…`). They are the artifacts Collecta pins and are now
misleading. Regenerate under current names or delete — but not before item 2, since
Collecta currently depends on one of them.

## 4. Fix the tool-loop grammar cliff (blocks any "batteries" work) 🔴

From `sdkgaps.md` gap #2, verified in `src/sdk/generateText.ts:326-335`:
`buildToolLoopGrammar` returns `undefined` if **any** tool lacks `toJsonSchema`, which drops
the grammar for the **entire** loop — including the outer `{"tool","args"} | {"answer"}`
envelope. On small local models an unconstrained ReAct loop is where reliability collapses,
and small local models are this SDK's whole reason to exist.

Fix: always lock the outer envelope; degrade only the individual tool's `args` to `anyValue`
when that tool has no schema. This should land **before** any built-in tools are added.

## 5. Remaining `sdkgaps.md` items

- `streamText` has no `tools` → can't stream an agentic loop (workaround: `generateText` for
  the loop, `streamText` for the final answer).
- `toolChoice` is accepted in the type but never read.
- The caller's `system` prompt is sent **twice** — baked into `messages[0]`
  (`generateText.ts:71`) and re-sent as `completionOptions.systemPrompt` (`:85`, `:218`).
- `zod` peer range excludes v4, forcing `--legacy-peer-deps` downstream and making
  `zodSchema()` / `zodToJsonSchema()` unusable on v4. Consumers currently hand-roll the same
  ~20-line `toSchemaLike()` shim in three places. Widening the peer range (or shipping that
  shim as a helper) removes real friction.
- Adapter-contract docs should state that streaming requires implementing **`onChunk`**, not
  `onToken` — `streamText` reads `onChunk` exclusively, so an `onToken`-only adapter silently
  degrades to non-streaming. Collecta's adapter has exactly this bug.

## 6. Direction: lean into cartridges, not chat

Assessment from the 2026-07-20 review. The `generateText`/`streamText` surface competes
directly with the Vercel AI SDK and won't win on those terms. The genuinely differentiated
asset is the **cartridge + catalog subsystem** (`fetchCatalog`, `resolveCartridgeEntry`,
`downloadCartridgeToStream`, the `.mcart` format) — *shipping a local model with your app* is
a real, unsolved, widely-needed problem that almost nobody handles well.

Concrete pull for this: **Agent on Deck** has no large-asset download mechanism at all (no
per-asset fetch, no cache dir, no checksum/resume), and its Electron main process is Node —
so it can consume this SDK for **model distribution** even though its inference lives in a
Python sidecar and can never use `generateText`. That's the highest-value integration
available and it should shape the roadmap.

Related, deferred: a `machineai-activation/tools` subpath shipping ready-made
`ToolDefinition`s (`web_search`, `fetch_url`, `rerank`). Keep it a **subpath export**, never
core — the core is deliberately browser/RN-safe, and search is a network service with an API
key, which does not belong in a local-inference library. Gate on item 4.
