# Backend Capabilities

This document explains what each backend lane in the Machine Activation SDK is supposed to guarantee, what is best-effort, and what is still backend-specific.

It exists so developers do not confuse:

- the SDK contract

with:

- the behavior of a specific runtime/backend

## Why This Matters

The SDK is the activation and integration layer.

The backend is the execution layer.

If we blur those two together, developers get a confusing experience and the SDK starts making promises it cannot actually keep.

## Current Backend Lanes

### 1. GGUF via `llama.cpp` / `llama.rn`

This is the primary GGUF lane.

Intended strengths:

- strong GGUF execution path
- mature text/chat inference
- mature acceleration/backend ecosystem
- grammar-constrained output
- strong general-purpose local inference lane

Current SDK expectation:

- GGUF cartridges should prefer the llama-family runtime automatically
- JSON-style structured output should use grammar constraints when requested through the SDK
- GGUF apps should treat this as the default lane unless there is a clear reason to prefer another runtime

Guaranteed or intended-as-core:

- model probing
- session creation
- text completion
- chat-style prompting
- streaming on the working llama lane
- grammar-backed JSON output when `responseFormat: 'json'` is requested

Advisory / best-effort:

- exact tool-calling reliability depends on model and backend behavior
- exact structured-output fidelity still depends on the model even when grammar is applied
- exact acceleration mode may vary by device/backend availability

Backend-specific caveats:

- vision on GGUF may require a projector/model-specific multimodal setup
- not every GGUF model family is equally strong at instruction following or JSON discipline

### 2. LiteRT / LiteRT-LM

This is the packaged Android-oriented lane.

Intended strengths:

- packaged model activation
- Android-native deployment path
- strong fit for LiteRT-packaged Gemma-style models

Current SDK expectation:

- `.litertlm` and LiteRT-related package formats should prefer the LiteRT lane automatically
- this lane is especially relevant for Android-first packaged deployments

Guaranteed or intended-as-core:

- package-format routing
- session creation on the supported Android path
- text generation on the supported Android path

Working but more runtime-sensitive:

- direct `.litertlm` activation on Android
- vision support on tested LiteRT-LM Android paths

Advisory / best-effort:

- exact acceleration telemetry is still improving
- packaging/model introspection is not yet as rich as the GGUF lane
- some behavior is more dependent on the underlying packaged runtime and device

Backend-specific caveats:

- image invocation details are runtime-sensitive
- not all failures are SDK failures; some are package/runtime/device mismatches

## What The SDK Guarantees vs What The Backend Guarantees

### SDK-level guarantees

The SDK should guarantee:

- a standard activation flow
- a standard model-config flow
- runtime selection
- compatibility/advisory reporting
- session creation abstraction
- diagnostics surface
- integration guidance for apps

### Backend-level guarantees

The backend is responsible for:

- actual model loading
- actual execution
- actual acceleration
- actual multimodal support
- actual grammar support
- actual tool or function calling behavior

The SDK should expose those capabilities honestly, not fake them.

## Current Recommendation

For now:

- prefer `llama.cpp` / `llama.rn` for GGUF
- prefer LiteRT for packaged LiteRT model formats

That keeps the backend story simple and avoids reinventing mature inference-engine features inside the SDK itself.

## What Is Still Advisory

These should usually remain warnings, not hard blockers:

- memory is tight
- structured output is not guaranteed
- context is smaller than ideal
- acceleration is degraded
- vision support is inferred rather than strongly observed

If these become default blockers, the SDK stops feeling plug-and-play.
