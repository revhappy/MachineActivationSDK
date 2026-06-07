# Activation SDK Integration Lessons

This document records what we actually learned while cloning the Ingredient Analyzer app and swapping its Gemini path to the Machine Activation SDK.

It is intentionally practical.

The goal is to preserve the real lessons from the first migration so we can improve the SDK later without repeating the same mistakes.

## What This Migration Was

App:

- `Ingredient analyzer - Machine Activation SDK`

Original app shape:

- account/auth + product logic
- cloud validation
- Gemini-backed ingredient analysis
- Gemini-backed follow-up chat
- custom UI already built

Migration goal:

- keep the existing app UI
- replace the AI path with a local-model activation path
- use the Machine Activation SDK as the seam
- prove that a real app can swap from cloud to local without being rebuilt around a separate packaging layer

## What We Actually Proved

The swap is real.

We proved that a custom app can:

- add provider selection (`gemini_cloud` vs `machine_activation`)
- register a Machine Activation runtime in-app
- select a local model
- activate a local session through the SDK
- route both analysis and chat through the local session
- preserve the app's existing UI while changing the inference source underneath

That is the core proof for the SDK direction.

## What Ended Up In The Clone

### Standardized / SDK-Shaped

- provider-mode seam between cloud and local
- activation client path via `createMachineActivationSdk(runtime).createActivationClient()`
- SDK-backed local model config storage
- standard local model picker/config concepts
- permissive activation path with optional diagnostics
- visible inference-source badge in the app UI

### Clone-Specific / Product Glue

- Capacitor runtime registration
- Android native plugin for direct `.litertlm` execution
- LiteRT-LM-specific image normalization and invocation details
- app-specific settings card and local model UX
- app-specific analysis prompt/result shaping

This split matters.

Not every fix belongs in the SDK. Some belong in the app integration layer or in a backend-specific runtime adapter.

## Biggest Technical Lessons

### 1. Activation must stay permissive by default

This was the biggest product lesson.

When the SDK started hard-failing on things like:

- structured JSON guidance
- memory fit concerns
- inferred capability uncertainty

the flow became clunky and hostile.

That is not the cartridge vision.

Correct shape:

- hard-fail only on truly impossible cases
- surface the rest as warnings or diagnostics

Hard failures should usually be limited to:

- file missing
- unsupported format
- import failure
- native engine/session creation failure

Everything else should usually be advisory.

### 2. Model selection/import is separate from diagnostics

We mixed these too much at first.

There are really different jobs:

1. pick/import the model
2. save the config
3. activate the session
4. optionally inspect diagnostics

When those were fused together, the SDK felt bureaucratic.

### 3. `content://` URIs are not real file paths

This mattered immediately on Android.

The picker returned `content://...` URIs, but native probing/session creation initially treated them like filesystem paths.

That caused:

- false "model not found" failures
- broken verification

Fix:

- import picked model URIs into app storage first
- then probe and activate using the resolved local file path

This is an important standard lesson for the SDK.

### 4. LiteRT-LM vision is sensitive to payload shape

The working Android path was not just "send image bytes."

Across the tested Android integrations, the stable path was closer to:

- normalize image
- write to a local cached file
- pass `ImageFile(localPath)`

That belongs in backend-specific runtime notes, not in generic SDK abstractions.

### 5. Local-model outputs are often partial, not just wrong

The app did not only need "JSON parsing."

It needed result normalization that tolerates:

- missing arrays
- missing nested fields
- malformed section objects
- empty optional lists

If that normalization is weak, the UI crashes on things like:

- `undefined.length`
- `undefined.replace`

The lesson:

- local integrations need a resilient shaping layer between raw model output and app UI

That may be app-specific, but the SDK should probably document this clearly.

### 6. Stale app bundles can mimic code regressions

The clone had a service-worker/WebView caching issue that made fresh APKs behave like old JS.

That produced fake regression loops where the code looked fixed but the app still ran stale behavior.

This is not a core SDK problem, but it is a real migration lesson for Capacitor/WebView apps.

### 7. Proof needs visible UI, not just internal routing

Even when the code path was local, it still felt ambiguous to the user.

The small inference-source badge was important because it gave the app a subtle but explicit signal:

- `Local model`
- `Cloud model`

That kind of proof is worth standardizing as guidance for integrators.

## Product Lessons

### What felt wrong

- too many strict checks in the activation path
- too much verification ceremony for basic model selection
- too much ambiguity about whether local or cloud was active
- too many backend-specific assumptions leaking into the main product flow

### What felt right

- small model picker flow
- save config, then try activation
- diagnostics as optional guidance
- subtle local/cloud badge
- preserving the original app UI while swapping the inference source underneath

## What Should Stay In The SDK

- activation client surface
- permissive activation by default
- optional diagnostics lane
- standard stored model-config shape
- standard picker/config concepts
- model import normalization
- recommendation/onboarding helpers
- capability contract as advisory truth, not bureaucracy

## What Should Not Be Forced Into The SDK Core

- app-specific result shaping
- app-specific prompts
- app-specific UI cards
- backend-specific image plumbing details in the generic surface
- overly strict activation gates for soft concerns

## Current Recommended SDK Mental Model

The Machine Activation SDK should feel like this:

1. pick/import a local model
2. save the config
3. activate a session
4. run inference
5. optionally inspect warnings/diagnostics

Not this:

1. pick a model
2. negotiate fifteen constraints
3. fail on advisory concerns
4. confuse the user

## Open Follow-Up Work

- decide whether the SDK should ship a small reusable activation UI kit
- decide how much result-normalization guidance should be documented for app developers
- decide whether the SDK should expose a standard "inference source" indicator helper
- keep backend-specific quirks documented separately from the generic SDK promise

## What The Next App Port Still Needs

The first integration taught us what a cleaner second port should still tighten:

- one stable request/response facade that maps cleanly from cloud-style app calls to `activateModel(...)`, `complete(...)`, and `completeChat(...)`
- stronger structured-output helpers above raw completion for apps that depend on parseable JSON
- a polished install and activation UX that recommends models, explains low-memory cases, and keeps activation simple
- prompt migration discipline for local-model context limits and stricter output instructions
- feature gating patterns so apps do not pretend every local model supports every capability
- clearer session/context guidance for multi-turn or workflow-style apps
- a stronger known-models layer built from registry facts plus observed results

The next proof that matters is not another internal demo. It is another real AI-native app that keeps its UI, swaps its cloud inference seam, and works locally through the SDK without expert-only friction.

## Bottom Line

This migration proved the Machine Activation SDK direction is valid.

A real app can keep its own UI and swap the AI layer underneath.

But it also proved that the SDK becomes worse, not better, when diagnostics and compatibility honesty are allowed to dominate the activation path.

The right direction is:

- cartridge-first activation
- optional diagnostics
- backend-specific quirks documented honestly
- app-facing integration kept simple
