# Documentation index

A directed reading order for `machineai-activation`. Each link below is a markdown file at the repo root or inside this directory.

## Start here

1. **[`/README.md`](../README.md)** — what the SDK is, the cartridge thesis, the activation handshake, and a copy-paste Fast Start using the drop-in API.
2. **[`/MIGRATION.md`](../MIGRATION.md)** — coming from Vercel AI SDK, OpenAI, or Anthropic? This is the import-swap guide with before/after diffs and the runtime adapter you need to add.
3. **[`/GETTING_STARTED.md`](../GETTING_STARTED.md)** — opinionated walkthrough of integrating the SDK into a fresh project, end-to-end.

## Integrating into your app

4. **[`/PACKAGE_CONSUMPTION.md`](../PACKAGE_CONSUMPTION.md)** — how the package is shaped on disk and at import time (main / module / types / `/node` subexport / exports map). Read this before configuring your bundler.
5. **[`/APP_INTEGRATION_PLAYBOOK.md`](../APP_INTEGRATION_PLAYBOOK.md)** — patterns for integrating the SDK into existing apps: provider seam, cloud↔local switching, error/empty-state handling, advisory diagnostics.
6. **[`/APP_INTEGRATION_AGENT_SPEC.json`](../APP_INTEGRATION_AGENT_SPEC.json)** — machine-readable integration spec (consumable by automation/AI agents that port an app to the SDK).
7. **[`/ACTIVATION_SDK_INTEGRATION_LESSONS.md`](../ACTIVATION_SDK_INTEGRATION_LESSONS.md)** — lessons collected from porting the reference apps. Read after the playbook for the "what went wrong, what to avoid" wisdom.

## Backends & runtimes

8. **[`/BACKEND_CAPABILITIES.md`](../BACKEND_CAPABILITIES.md)** — the capability surface area (text completion, chat, streaming, structured JSON, tool calling, vision, acceleration modes) and how the contract resolves them across model + backend + device.
9. **[`/LITERT_LM_ANDROID_NOTES.md`](../LITERT_LM_ANDROID_NOTES.md)** — the LiteRT-LM Android lane: `.task`/`.litertlm` packages, MediaPipe bridge, vision-input quirks, acceleration telemetry gaps.

## Publishing & status

10. **[`/PUBLISHING.md`](../PUBLISHING.md)** — release flow, what `release:verify` does, the CI + release GitHub workflows.
11. **[`/POST_PUBLISH_CHECKLIST.md`](../POST_PUBLISH_CHECKLIST.md)** — what to do **after** the real `npm publish` (replace `file:` deps in reference apps, tag, smoke-test from the registry).
12. **[`/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md)** — honest snapshot of what's shipped, what's working, and what's known-limited.
13. **[`/CARTRIDGE_SDK_ROADMAP.md`](../CARTRIDGE_SDK_ROADMAP.md)** — the multi-session execution log + milestone map (M1 → M9). Update the "Session log" and "Current status" sections whenever the SDK changes meaningfully.

## Adapting an app onto the SDK

14. **[`/REFERENCE_APP_01_PORT_SPEC.md`](../REFERENCE_APP_01_PORT_SPEC.md)** — the spec for the first canonical port (Meeting Notes Assistant shape). A template for what a "clean integration" looks like.

## API surface

The SDK exposes two layers:

- **Drop-in API** (recommended starting point) — `createMachine`, `model`, `generateText`, `streamText`, `generateObject`, `tool`, plus `zodSchema`, `zodToJsonSchema`, `jsonSchemaToGbnf`. Matches the Vercel AI SDK shape. See [`/MIGRATION.md`](../MIGRATION.md).
- **Activation handshake API** (lower-level) — `createMachineActivationSdk(runtime).createActivationClient()` returns a client with `diagnoseModel`, `activateModel`, `buildOnboardingPlan`, `runObservedCapabilityProbes`, plus the model-setup controller (`createActivationModelSetupController`). See [`/BACKEND_CAPABILITIES.md`](../BACKEND_CAPABILITIES.md) and [`/APP_INTEGRATION_PLAYBOOK.md`](../APP_INTEGRATION_PLAYBOOK.md).

The two layers are designed to coexist: use the drop-in API for inference call sites, and the activation client for explicit diagnostics, onboarding, and registry/observed-capability extension.

## Where the source lives

- `src/sdk/` — the drop-in API (M1 + M7).
- `src/cartridge/` — `.mcart` cartridge format (M2 + M3 zip I/O).
- `src/catalog/` — catalog parser, resolver, downloader, cache (M4).
- `src/bin/` — the `machine` CLI (M3 + M4 subcommands).
- `src/activation/` — the activation handshake: contract, adapter, manager, custom-app client, planning, capability inference / registry, observed probes, setup flow.
- `src/framework/` — the top-level factory (`createMachineActivationSdk` / `createMachineFramework`).
- `src/index.ts` — RN/browser-safe public barrel.
- `src/node.ts` — node-only sub-export (`machineai-activation/node`) for tooling.

## Other workspaces in this repo

| Path | Package | Role |
|---|---|---|
| `packages/ui/` | `machineai-activation-ui` | Headless React + RN UI kit (hooks + 5 components per target). |
| `packages/create-machine-app/` | `create-machineai-app` | Scaffolder with 5 templates (expo, rn-cli, next, electron, node). |
| `packages/activation-capacitor/` | `machineai-activation-capacitor` | Capacitor (Android) runtime adapter bridging LiteRT-LM. |
