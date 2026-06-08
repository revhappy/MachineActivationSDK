# machineai-activation-capacitor

Capacitor (Android) runtime adapter for [`machineai-activation`](../..).

Bridges the native LiteRT-LM Capacitor plugin to the activation runtime contract, so a Capacitor app can activate a local `.litertlm` model and run on-device inference through the same `createMachine` / `generateText` API as every other runtime — instead of hand-writing ~570 LOC of plugin + capability-resolution glue.

## Install

```bash
npm install machineai-activation-capacitor machineai-activation
```

This package ships the **JavaScript bridge only**. The matching native Kotlin plugin (the actual LiteRT-LM execution) has to live in the host Android app — it can't be packaged as an npm dependency. See `ACTIVATION_SDK_INTEGRATION_CHECKPOINT.md` in the Ingredient Analyzer reference app for the host-app Gradle/Kotlin surface.

> **Android only.** Every entry point throws (or reports unavailable) on web/iOS builds that don't include the native plugin. Guard with `isMachineActivationPluginAvailable()` before activating.

## Usage

### Option A — register a global runtime factory

For apps that resolve the runtime lazily from a global (the activation SDK's default lookup):

```ts
import { registerCapacitorMachineActivationRuntime } from 'machineai-activation-capacitor';

// In your app entry file, once:
registerCapacitorMachineActivationRuntime();
```

### Option B — pass the runtime explicitly to `createMachine`

```ts
import { createMachine, generateText } from 'machineai-activation';
import {
  createCapacitorMachineActivationRuntime,
  isMachineActivationPluginAvailable,
  pickMachineActivationModel,
} from 'machineai-activation-capacitor';

if (!isMachineActivationPluginAvailable()) {
  throw new Error('Local mode requires an Android build with the native plugin.');
}

const machine = createMachine({
  runtimes: [createCapacitorMachineActivationRuntime()],
});

// Let the user pick a .litertlm package via the native file picker:
const picked = await pickMachineActivationModel();
if (picked) {
  const model = machine.model({ filePath: picked.filePath });
  const { text } = await generateText({ model, prompt: 'Hello on-device!' });
}
```

## What it covers

- Routes `.litertlm` models to the LiteRT-LM lane (`canHandleModel` / `supportedModelFormats: ['litert-lm']`).
- Backend, device, and model-package probing through the native plugin.
- Session creation, `complete` / `completeChat`, context-state reporting, vision-readiness probing, diagnostics, abort, and close.
- A native file picker (`pickMachineActivationModel`) and a plugin-availability guard (`isMachineActivationPluginAvailable`).

## Current limitations

- **Android only**, `.litertlm`-first.
- Non-streaming request execution (the native bridge reports `supportsStreaming: false` today).
- Acceleration telemetry currently reports `cpu`; richer GPU/NPU reporting is a follow-up.

See `CARTRIDGE_SDK_ROADMAP.md` and `LITERT_LM_ANDROID_NOTES.md` in the SDK repo for the deeper LiteRT-LM status.
