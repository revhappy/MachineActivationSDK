# Activation SDK Status

This file describes the current implementation posture of the activation SDK.

> **Product focus (2026-07-24):** this is **the adapter layer for local models** —
> plug a GGUF into any app, on any OS, to **test** it and to **package** it. Scope is
> Windows + macOS + Linux + Android + iOS. The Vercel-AI-SDK-shaped surface is the
> porting on-ramp, not the identity. Full statement in `TODO.md` §0.
>
> **Per-platform truth lives in [PLATFORM_MATRIX.md](./PLATFORM_MATRIX.md)**, which
> distinguishes *wired and typechecked* from *actually run on hardware*. As of
> 2026-07-24 every non-Windows lane is the former, not the latter.

## Already Implemented

- standalone top-level package boundary
- package-level typecheck flow
- package-level unit test suite
- generated `dist/` build output
- shipped default capability catalog artifact
- external-style sample consumer that installs through the package boundary
- framework entrypoint
- capability contract
- schema-versioned resolved capability contract
- activation manager
- direct custom-app activation client
- one concrete runtime/backend implementation over `llama.rn` / `llama.cpp`
- multi-runtime routing inside the activation manager
- initial LiteRT-LM runtime lane scaffold
- backend/device probing
- model introspection
- capability inference layer
- configurable capability registry
- observed capability probe persistence
- SDK-owned observed capability probe execution
- CI workflow for package and sample consumer verification
- release workflow scaffold for npm publish
- session context strategy/state
- direct demo screen in the host app

## Current Truth Model

Capability resolution currently combines:

- backend-detected facts
- device-detected facts
- model metadata
- projector state
- framework-maintained or app-supplied capability registry inference
- saved observed probe results

That means the SDK is no longer purely guess-based, but it is not yet a perfect oracle either.

## Runtime Status

- `llama.rn` / `llama.cpp`
  - real model probing
  - real session creation
  - real streaming/completion execution
  - intended primary lane for `GGUF` cartridges
  - should absorb mature backend features from the llama.cpp ecosystem where practical instead of re-implementing them at the SDK layer
  - SDK-level `responseFormat: 'json'` now maps to grammar-constrained JSON on the llama-family lane

- `LiteRT-LM`
  - real model-format routing
  - real package recognition during handshake
  - Android `.task` bundles now have a native execution bridge through MediaPipe LLM Inference
  - async streaming and cancellation are now wired for the `.task` bridge
  - vision input is now wired for compatible multimodal `.task` bundles
  - direct `.litertlm` package activation is wired on Android through LiteRT-LM
  - direct `.litertlm` Android vision is confirmed working through cached local JPEG files sent as `Content.ImageFile(...)`
  - `Content.ImageBytes(...)` caused native compiled-model invocation failures for the tested `.litertlm` vision path
  - current bridge still needs better acceleration telemetry and deeper model-package introspection

Additional LiteRT-LM Android details are recorded in [LITERT_LM_ANDROID_NOTES.md](./LITERT_LM_ANDROID_NOTES.md).

## Independence Status

The SDK is now standalone in the following sense:

- it has its own top-level package boundary
- it has its own source tree
- it has its own TypeScript toolchain dependency
- it has its own typecheck/build/test scripts
- it emits generated `dist/` output
- the host consumes it through a package-style import path

It is published to the public npm registry as `machineai-activation@0.2.0-beta.1` (first published 2026-06-08), and it is no longer structurally owned by any host app toolchain.

## Adapter Surface Status

The runtime surface is now intentionally split into:

- a minimal required core:
  - `id`
  - `name`
  - `createSession(...)`
- optional richer reporting hooks:
  - `listBackendCapabilities()`
  - `probeDeviceCapabilities()`
  - `probeModelPackage()`
  - `canHandleModel()`
  - `supportedModelFormats`

That means an outside consumer can implement the session runtime first and add richer capability reporting later instead of swallowing the whole contract up front.

## Highest-Value Next Steps

The authoritative, prioritized queue is **[TODO.md](./TODO.md)**. In short:

1. **Run a model on macOS, Linux, iOS and Android.** Windows x64 is verified on
   hardware as of 2026-07-24; the other four lanes are wired and typechecked but
   unverified. Nothing substitutes for this — the Windows run alone surfaced two
   defects that 199 passing tests had not. `machine doctor --run <model.gguf>`
   does the check in one command.
2. **Stand up a real catalog** — the default `machine pull` URL is currently a 404,
   so the flagship command fails for every user.
3. **`streamText({ tools })`** — you can stream tokens or run an agentic loop, not
   both (`sdkgaps.md` #1). Now the largest remaining API gap.

Closed 2026-07-24: `machine doctor` shipped; the tool-loop grammar cliff, `abortSignal`,
`toolChoice`, the duplicated system prompt, zod v4 support, and the long-standing
test-suite stall are all fixed.

Longer-standing items, still valid: promote observed probe results in the UI; expand
probe coverage beyond text/streaming/JSON/projector; improve acceleration telemetry
and context reporting for LiteRT; deepen the `.litertlm` lane; expand model import
beyond GGUF-first assumptions.
