# Getting Started

This is the quickest outsider-friendly path to understanding and using the Machine Activation SDK.

## What This SDK Is

The Machine Activation SDK lets an app plug in a local model like a cartridge.

The app keeps its own UI and product behavior.

The SDK handles:

- model selection/import concepts
- capability and device checks
- runtime selection
- session activation
- diagnostics

The app handles:

- its own UI
- its own prompts
- its own product logic

## What This SDK Is Not

It is not:

- a constrained app template
- a new inference engine
- a replacement for mature backends such as `llama.cpp`

It sits above the backend layer.

## Core Flow

The intended happy path is:

1. choose a local model
2. save the model config
3. activate a session
4. run inference

Diagnostics exist, but they should usually help rather than block.

The SDK now includes a reusable setup controller for that cartridge flow:

- `createActivationModelSetupController(...)`
- `loadState()`
- `pickModel()`
- optional `verifyConfig()`
- `saveConfig()`
- `clearSavedConfig()`

That controller is intentionally UI-agnostic. Apps can keep their own settings screen or onboarding flow while sharing the same setup logic underneath.

## Current Backend Strategy

- use `llama.cpp` / `llama.rn` for GGUF
- use LiteRT / LiteRT-LM for LiteRT-packaged model formats

See:

- [BACKEND_CAPABILITIES.md](./BACKEND_CAPABILITIES.md)

## Smallest Useful Integration

```ts
import {
  createActivationModelSetupController,
  createJsonActivationModelConfigStorage,
  createMachineActivationSdk,
  LITERT_LM_ANDROID_PRESET,
} from '@machine/activation-sdk';

const setup = createActivationModelSetupController({
  storage: createJsonActivationModelConfigStorage({
    storageKey: 'myapp.machineActivation.modelConfig',
  }),
  picker: filePicker,
  preset: LITERT_LM_ANDROID_PRESET,
  verifier,
});

const picked = await setup.pickModel();
if (picked) {
  setup.saveConfig(picked.config);
}

const client = createMachineActivationSdk(runtime).createActivationClient();

const session = await client.activateModel({
  modelId: 'my-local-model',
  filePath: '/models/my-model.gguf',
  appRequirements: {
    textChat: true,
  },
});

const result = await session.completeChat([
  { role: 'user', content: 'Hello' },
]);
```

## JSON Output On The GGUF Lane

If you want structured JSON from the llama-family GGUF lane:

```ts
const result = await session.completeChat(messages, {
  systemPrompt: 'Return JSON only.',
  responseFormat: 'json',
});
```

On llama-family runtimes, the SDK translates that into a JSON grammar constraint automatically.

## Recommended Reading Order

1. [README.md](./README.md)
2. [BACKEND_CAPABILITIES.md](./BACKEND_CAPABILITIES.md)
3. [APP_INTEGRATION_PLAYBOOK.md](./APP_INTEGRATION_PLAYBOOK.md)
4. [APP_INTEGRATION_AGENT_SPEC.json](./APP_INTEGRATION_AGENT_SPEC.json)
5. [ACTIVATION_SDK_INTEGRATION_LESSONS.md](./ACTIVATION_SDK_INTEGRATION_LESSONS.md)

## Current Honest Status

This SDK is close to a meaningful alpha, not yet a polished public 1.0.

What is already strong:

- the activation model
- the capability contract
- the standalone SDK framing
- the GGUF and LiteRT backend lanes
- the first real app integration proof

What still needs more work before a polished publish:

- reusable model-picker/import UI
- one more real app integration
- cleaner packaging/distribution story
- more polished developer-facing examples
