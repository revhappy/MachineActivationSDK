# AGENTS.md — orientation for LLM agents

> You are an LLM working inside the `MachineActivationSDK` repo. Read this file first. It exists so you can ship a real change in one session without rummaging.

## 30-second orientation

This package is **`machineai-activation`** — a Vercel-AI-SDK-shaped API over on-device LLMs, plus a `.mcart` cartridge format (a model + its metadata, packaged + sha256-verified + loadable from a local cache). Ships:

- **SDK:** `createMachine`, `generateText`, `streamText`, `generateObject`, `tool`, `zodSchema`.
- **Format:** `.mcart` cartridges (a zip of `manifest.json` + weights file + optional assets).
- **CLI:** `machine init | pack | unpack | validate | info | inspect | pull | search | list | describe`.
- **Catalog:** a static `catalog.json` hosted anywhere; `machine pull id@version` downloads + verifies + caches.

What's shipped vs. next: run `machine describe pointers` to get pointers, then read `CARTRIDGE_SDK_ROADMAP.md` → the top `RESUME HERE` block.

## Dump the full SDK surface in one call

```bash
npx machine describe              # full JSON payload
npx machine describe cli          # just CLI commands
npx machine describe sdk          # just SDK API
npx machine describe manifest     # just manifest schema fields
npx machine describe catalog      # just catalog schema fields
npx machine describe ui           # machineai-activation-ui components + hooks
npx machine describe scaffolder   # create-machineai-app templates
npx machine describe pointers     # file paths to read for more detail
```

The output is designed to fit in your context in one shot. Prefer it to grepping source when you need to understand the shape of something.

## Non-negotiable rules

1. **RN-portable core.** No `node:*` imports in `src/sdk/**` or `src/cartridge/**` outside files prefixed `node*` (e.g. `nodeFs.ts`, `nodeZip.ts`, `nodePackCartridge.ts`). Consumers on React Native / browser plug in their own adapters via `CartridgeFileSystem` and `CartridgeZipAdapter`.
2. **Zod is an optional peer dep.** Never `import 'zod'` in `src/**`. The duck-typed `SchemaLike` + `zodToJsonSchema` walker lets zod users plug in without forcing the dep on anyone else.
3. **Backwards compatible.** The existing `createMachineActivationSdk(...)` API stays usable unchanged. New APIs (drop-in SDK, cartridge, catalog) layer on top.
4. **Runtime adapter contract is frozen.** External backends (llama.rn, LiteRT) must keep working unmodified. If a change touches the `ActivationRuntime` interface, flag it in the session log.
5. **Cartridge weight paths stay inside the cartridge.** `weights.path` must be relative, no `..`, no absolute paths. The manifest validator enforces this — don't bypass it.

## Commands that must work before you ship any change

```bash
npm run typecheck     # tsc --noEmit on the whole repo
npm run test          # builds tests + runs all suites via tests/run.ts
npm run build         # emits dist/ — publishable artefacts
npm run check         # typecheck + test + build, in order
```

**Pre-existing flake:** `tests/cli/pull.test` has localhost-server tests that can fail with `fetch failed` under port contention. If `check` fails *only* with those 5 tests + nothing else changed, the flake is unrelated — re-run once to confirm.

## Common tasks, in recipe form

### "Add a new CLI command"

1. Create `src/bin/commands/<name>.ts` — export `runX(argv: string[]): Promise<number>`. Include a local `HELP` constant with `machine <name> ...` usage.
2. Wire into `src/bin/machine.ts` — import + add to `COMMANDS` map + add one line to `HELP`.
3. Update `src/bin/commands/describe.ts` — add the command to `CLI_COMMANDS`.
4. Add `tests/cli/<name>.test.ts` — use `runCli(['<name>', ...])` from `tests/cli/_run.ts`.
5. Register the test in `tests/run.ts`.
6. `npm run check`.

### "Add a new field to the cartridge manifest"

1. Edit `src/cartridge/types.ts` — add to `CartridgeManifest` (or a sub-interface).
2. Edit `src/cartridge/manifestSchema.ts` — add validation in `parseCartridgeManifest`. Use path-prefixed issues (`weights.<field>`), not free-form messages.
3. Bump `CARTRIDGE_SCHEMA_VERSION` in `src/cartridge/types.ts` **only if the change is breaking**. Additive optional fields don't bump.
4. Update `src/bin/commands/describe.ts` — add the field to `MANIFEST_FIELDS`.
5. Add a test in `tests/cartridge/manifestSchema.test.ts` covering valid + invalid cases.
6. `npm run check`.

### "Add a new exported API to the drop-in SDK"

1. Create `src/sdk/<name>.ts` — implementation.
2. Export from `src/sdk/index.ts` (and types from the same module).
3. Re-export from `src/index.ts` (root barrel).
4. Add to `src/bin/commands/describe.ts` — extend `SDK_API`.
5. Test under `tests/sdk/<name>.test.ts` + register in `tests/run.ts`.
6. `npm run check`.

### "Add a new runtime backend (beyond llama.rn / LiteRT)"

Out of scope for single-session work — backends live in separate packages. Open `src/activation/runtimeSelection.ts` to see how detection works, then propose a new backend package rather than editing this one.

### "Add a new UI component to `machineai-activation-ui`"

The UI kit is a separate workspace at `packages/ui/`. Root `npm run check` does **not** cover it — use the `*:ui` scripts.

1. Decide the target: `src/web/` (DOM), `src/native/` (React Native), or both. Behavior lives in hooks under `src/core/` — keep web/native files thin.
2. If the component needs new behavior, add a hook to `packages/ui/src/core/` first. Core must only import from `react` and `machineai-activation` — never from `react-native` or DOM globals.
3. Add the component file(s) under `src/web/<Name>.tsx` and/or `src/native/<Name>.tsx`.
4. Export from the matching `src/web/index.ts` / `src/native/index.ts` barrel.
5. If the hook/type is consumer-facing, re-export from `packages/ui/src/index.ts`.
6. Update `src/bin/commands/describe.ts` — extend `UI_PACKAGE.hooks` or `UI_PACKAGE.components`.
7. If the core logic is pure, add a test under `packages/ui/tests/core/<name>.test.ts` and register it in `packages/ui/tests/run.ts`.
8. `npm run check:ui` from repo root (or `npm run check` inside `packages/ui/`) — runs typecheck + tests + build.

### "Add a new `create-machine-app` template"

The scaffolder is a separate workspace at `packages/create-machine-app/`. Root `npm run check` does **not** cover it — use the `*:scaffolder` scripts.

1. Create `packages/create-machine-app/templates/<id>/` with the template tree. Any file containing `{{APP_NAME}}` or `{{PACKAGE_MANAGER}}` must end in `.tmpl`; non-placeholder files (tsconfig, gitignore, etc.) copy verbatim.
2. Register the template in `packages/create-machine-app/src/templates.ts` — add a `TemplateDescriptor` (id, displayName, description, target, nextSteps) to `TEMPLATES`.
3. Add `packages/create-machine-app/tests/<id>.test.ts` covering: tree shape, placeholder substitution, no `.tmpl` leakage. Register it in `packages/create-machine-app/tests/run.ts`.
4. Update `src/bin/commands/describe.ts` — extend `SCAFFOLDER_PACKAGE.templates`.
5. `npm run check:scaffolder` from repo root (or `npm run check` inside `packages/create-machine-app/`).

## File pointers (use `machine describe pointers` for the machine-readable version)

| Question | File |
|---|---|
| "What's the full roadmap + current state?" | `CARTRIDGE_SDK_ROADMAP.md` — always read the `RESUME HERE` block first |
| "What does the package export?" | `src/index.ts` → `src/sdk/index.ts`, `src/cartridge/index.ts`, `src/catalog/index.ts` |
| "What's a valid cartridge manifest?" | `src/cartridge/types.ts` + `src/cartridge/manifestSchema.ts` |
| "What's a valid catalog?" | `src/catalog/types.ts` + `src/catalog/catalogSchema.ts` |
| "How does `generateObject` constrain output?" | `src/sdk/generateObject.ts` → `src/sdk/jsonSchemaToGbnf.ts` |
| "How does the tool-use loop work?" | `src/sdk/generateText.ts` (`runWithTools`) |
| "What does the CLI do?" | `src/bin/machine.ts` + `src/bin/commands/*.ts` |
| "How are tests wired up?" | `tests/run.ts` + `tests/_harness.ts` (no Jest, just `test()` + `finish()`) |
| "Can I see an end-to-end consumer?" | `examples/basic-consumer/` |
| "Where is the React / React Native UI kit?" | `packages/ui/` — `src/core/` (hooks), `src/web/`, `src/native/`. Separate workspace; use `npm run check:ui`. |
| "Where is the scaffolder / templates?" | `packages/create-machine-app/` — `src/` (CLI), `templates/<id>/`. Separate workspace; use `npm run check:scaffolder`. |

## Before you ship

- [ ] `npm run check` green (or flakes clearly in the baseline-flake set).
- [ ] Updated `CARTRIDGE_SDK_ROADMAP.md`: `Session log` gets a new entry, `Current status` table reflects reality, `RESUME HERE` still points at the right next thing.
- [ ] Updated `src/bin/commands/describe.ts` if the change altered any surface that lives in the payload.
- [ ] No new `node:*` imports outside `node*`-prefixed files.
- [ ] No new hard imports of `zod`.

## Session log discipline

`CARTRIDGE_SDK_ROADMAP.md` has a `Session log` at the bottom. Every session writes an entry there — what was shipped, non-obvious scope decisions, and what the next session should pick up. This is the contract that lets agents hand off work. Don't skip it.
