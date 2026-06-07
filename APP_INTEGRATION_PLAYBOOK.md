# App Integration Playbook

This playbook is the human-readable companion to:

- [APP_INTEGRATION_AGENT_SPEC.json](./APP_INTEGRATION_AGENT_SPEC.json)

Its purpose is simple:

help a future developer or agent port an existing AI-native app to the Machine Activation SDK without losing the plot.

## Primary Goal

Do not rebuild the app around the SDK.

Keep the app's own UI and product behavior, then replace the inference layer underneath it with a local-model activation path.

The ideal user flow is:

1. pick or import a model
2. save the config
3. activate a session
4. run inference

Everything else is secondary.

## What A Good Port Looks Like

A good port:

- keeps the app UI recognizable
- adds a simple provider seam
- routes analysis and chat through the SDK in local mode
- avoids hidden cloud detours
- treats diagnostics as helpful guidance, not bureaucratic blocking
- gives the user a subtle proof of whether inference is local or cloud

## Integration Procedure

### 1. Find the cloud seam

Before changing anything, identify:

- analysis call sites
- chat call sites
- validation steps
- any hidden fallback path that still calls the cloud

If local mode is selected, those detours should not quietly keep using the cloud.

### 2. Add a provider seam

Use a small app-level mode such as:

- `gemini_cloud`
- `machine_activation`

Do not overcomplicate this.

The provider seam is the switch that makes the app portable.

### 3. Register the runtime

The SDK needs a runtime adapter.

That may be:

- React Native
- Capacitor
- Android native bridge
- some other integration layer

The runtime registration is the bridge between the app and the execution backend.

### 4. Standardize model config

Do not default to raw ad hoc path strings sprayed across app state.

Use a stored model-config shape with:

- file path
- model id when available
- runtime hint when needed
- optional projector or related auxiliary path only when the backend actually needs it

### 5. Implement the cartridge flow

The activation setup flow should feel like:

- choose model
- import if needed
- save
- try activation

The SDK standard flow for this is now:

- `createActivationModelSetupController(...)`
- `pickModel()`
- optional `verifyConfig()`
- `saveConfig()`

Not:

- choose model
- answer ten technical questions
- get blocked by soft warnings

### 6. Route the real work

When local mode is active:

- analysis should go through Machine Activation
- chat should go through Machine Activation when the app has chat

Keep the original app UI if possible.

### 7. Remove hidden cloud detours

Watch for places where the app still calls cloud logic even though local mode is on.

Common examples:

- image validation
- auth-gated product verification
- fallback prompt routes

If local mode is selected, these must be intentional, visible, and justified. Not accidental.

### 8. Shape local output before the UI sees it

Local-model output will often be partial.

That means:

- missing arrays
- missing nested fields
- malformed JSON
- incomplete section objects

Always add a shaping layer between raw local output and the app UI.

This is one of the most important lessons from the first real integration.

### 9. Add subtle proof

Users will not trust the local path unless they can tell what is active.

Use something small:

- `Local model`
- `Cloud model`

Do not turn this into loud product chrome unless the app wants that.

### 10. Document the port

Every real integration should leave behind:

- a checkpoint doc inside the app
- any backend-specific runtime notes
- any SDK lesson that should be generalized later

## Hard Failures vs Warnings

Hard fail only when the app truly cannot proceed.

Examples:

- file missing
- unsupported format
- import failed
- runtime not registered
- native engine creation failed

Warnings should usually stay warnings.

Examples:

- structured output not guaranteed
- memory fit is tight
- vision support is uncertain
- acceleration is degraded

If warnings become default blockers, the SDK stops feeling like a cartridge system.

## What To Keep Out Of The SDK Core

Do not force these into the generic SDK unless they become broadly reusable:

- app-specific prompts
- app-specific UI layouts
- app-specific result cards
- backend-specific image plumbing details
- app-specific post-processing rules

Those can exist, but they should not distort the core activation promise.

## Minimal Definition Of Success

The port is successful when:

- the app still feels like itself
- local mode really runs through the SDK
- the user can choose a model without expert-only friction
- diagnostics help without dominating
- the app does not crash on partial local output
- the source of inference is visible

## Related Docs

- [README.md](./README.md)
- [ACTIVATION_SDK_INTEGRATION_LESSONS.md](./ACTIVATION_SDK_INTEGRATION_LESSONS.md)
