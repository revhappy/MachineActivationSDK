# Activation SDK Status

This file describes the current implementation posture of the activation SDK.

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

It is not yet a separately published package, but it is no longer structurally owned by any host app toolchain.

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

1. Promote observed probe results more clearly in the UI.
2. Expand probe coverage beyond:
   - text sanity
   - streaming
   - structured JSON
   - projector init
3. Exercise the release workflow publicly and validate the npm publish path end to end.
4. Deepen the llama.cpp lane around mature backend features that the SDK should reuse rather than rebuild.
5. Improve acceleration telemetry and richer context/session reporting for LiteRT.
6. Deepen the `.litertlm` lane with broader diagnostics, packaging guidance, and on-device validation.
7. Expand the model-import and registry lane beyond GGUF-first assumptions.
8. Continue tightening the standalone SDK story in host-facing and framework-facing docs.
