# Machine Activation SDK

The Machine Activation SDK is now the primary direction of the project.

Its purpose is to let developers plug a local model into an app like a cartridge and get a simple activation path first, with diagnostics available when they want them.

The public package name is:

- `@machine/activation-sdk`

## Fast Start

If you're coming from the Vercel AI SDK, OpenAI SDK, or Anthropic SDK, the drop-in API is the best starting point:

```ts
import { createMachine, generateText, streamText, generateObject, tool } from '@machine/activation-sdk';

const machine = createMachine({ runtimes: [yourRuntimeAdapter] });
const model = machine.model({ filePath: '/models/gemma.gguf' });

// One-shot completion
const { text } = await generateText({
  model,
  prompt: 'What is 2+2?',
  system: 'Answer briefly.',
});

// Streaming
const stream = streamText({ model, prompt: 'Tell me a story.' });
for await (const delta of stream.textStream) process.stdout.write(delta);

// Structured output (any Zod-shaped schema works)
const { object } = await generateObject({
  model,
  schema: mySchema,
  prompt: 'Extract the order details.',
});

// Tools (ReAct-style loop)
const result = await generateText({
  model,
  prompt: 'What time is it?',
  tools: { clock: tool({ description: '...', parameters: s, execute: fn }) },
});
```

See [CARTRIDGE_SDK_ROADMAP.md](./CARTRIDGE_SDK_ROADMAP.md) for where this SDK is going: `.mcart` cartridge format, `machine` CLI, `machine pull`, scaffolders, headless UI kit.

If you need the underlying activation handshake (capability resolution, diagnostics, onboarding plans, etc.), those APIs are still the recommended way in:

1. [GETTING_STARTED.md](./GETTING_STARTED.md)
2. [BACKEND_CAPABILITIES.md](./BACKEND_CAPABILITIES.md)
3. [PACKAGE_CONSUMPTION.md](./PACKAGE_CONSUMPTION.md)
4. [APP_INTEGRATION_PLAYBOOK.md](./APP_INTEGRATION_PLAYBOOK.md)

## Core Promise

Given:

- an app's requirements
- a model file and optional projector
- a backend/runtime
- a device

the SDK should answer:

- can this combination run?
- what is degraded?
- what is missing?
- what acceleration path is active?
- what context/session behavior is active?

And if it can run, the SDK should create the local inference session directly.

## Activation Handshake

The activation handshake is the heart of the SDK, and it should stay easy to explain.

Canonical flow:

1. the app declares its requirements
2. the user selects or imports a model
3. the SDK routes that model to the right runtime lane
4. the SDK gathers app, model, backend, device, registry, and observed-probe truth
5. the resolver computes one explicit contract
6. the app gets a session plus warnings/diagnostics when relevant

Current routing examples:

- `.gguf` -> llama-family lane
- `.task` -> LiteRT Android lane
- `.litertlm` -> LiteRT-LM lane

Important truth:

- the handshake is strong at technical compatibility, runtime/device/backend truth, and session readiness
- the handshake is weaker at judging whether a model is excellent for a specific domain or use case

That distinction matters. The SDK should be honest about whether something can run, but it should not pretend it can guarantee product quality.

## Product Direction

The core activation flow should stay lightweight:

- pick or import a model
- save the config
- activate a session
- run inference

Diagnostics are still important, but they should usually be advisory instead of blocking. In practice that means:

- `activateModel(...)` is permissive by default
- `diagnoseModel(...)` is the optional preflight lane
- apps should only hard-stop on truly impossible cases such as missing files, unsupported formats, or native engine creation failures
- memory fit, context size, and structured-output quality should usually surface as guidance, not as activation blockers

This keeps the SDK aligned with the cartridge vision instead of turning it into a compliance gate.

## Primary Use Cases

### 1. Existing Custom Apps

A developer with a custom app should be able to:

- keep their existing UI
- integrate the SDK
- probe local models
- negotiate capabilities
- activate a local session
- replace or reduce cloud inference dependencies

### 2. App Frameworks And Platforms

Custom frameworks, host apps, and higher-level product layers can consume the same SDK underneath.

That keeps the SDK focused on activation instead of forcing one app architecture.

## Current Code Surface

The current framework/SDK source now lives directly in this package:

- [src/index.ts](./src/index.ts)
- [src/framework/index.ts](./src/framework/index.ts)
- [src/activation/activationAdapter.ts](./src/activation/activationAdapter.ts)
- [src/activation/activationContract.ts](./src/activation/activationContract.ts)
- [src/activation/activationManager.ts](./src/activation/activationManager.ts)
- [src/activation/customAppSdk.ts](./src/activation/customAppSdk.ts)
- [src/activation/capabilityInference.ts](./src/activation/capabilityInference.ts)
- [src/activation/observedCapabilities.ts](./src/activation/observedCapabilities.ts)
- [src/activation/activationPlanning.ts](./src/activation/activationPlanning.ts)

Concrete runtime adapters are expected to live in consuming apps or companion runtime packages.

This isolated SDK project ships:

- the activation contract
- the activation manager
- the custom app client
- model setup/config flows
- capability registry and observed-probe infrastructure

It does not need to carry one specific host app or one specific UI layer in order to stand on its own.

## Backend Strategy

The SDK should not try to out-build mature inference engines where they already solve the backend problem well.

Current intended backend split:

- `llama.cpp` / `llama.rn` is the primary `GGUF` lane
- `LiteRT` / `LiteRT-LM` is the packaged Gemma / Android-optimized lane

That means:

- GGUF models should prefer the llama-family runtime automatically
- `.litertlm` and related LiteRT package formats should prefer the LiteRT lane automatically
- the SDK should focus on cartridge-style activation, app integration, diagnostics, onboarding, and runtime selection
- the SDK should avoid re-implementing backend features that already exist cleanly in `llama.cpp`, such as grammar-constrained output and mature GGUF execution

This keeps the project focused on the standard activation layer instead of turning it into a duplicate inference engine project.

## Contract Versioning

The resolved activation contract is now schema-versioned through:

- `ACTIVATION_CONTRACT_SCHEMA_VERSION`

Every `ResolvedCapabilityContract` and `ActivationCapabilitySnapshot` now carries that schema version so the contract can evolve without pretending backwards compatibility is automatic.

## Structured Output On GGUF

One concrete place where the SDK should lean on llama-family backends is structured output.

The SDK now exposes a small standard request hint:

```ts
const result = await session.completeChat(messages, {
  systemPrompt: 'Return JSON only.',
  responseFormat: 'json',
});
```

On llama-family runtimes, that JSON response hint is translated into a JSON grammar constraint automatically instead of relying on prompt wording alone.

That gives the SDK a clean framework-level way to benefit from llama.cpp's mature grammar-constrained output support without forcing every app to hand-roll its own grammar wiring.

Current truth:

- `llama.rn` / `llama.cpp` is the working execution path today
- `LiteRT` is now a routed second backend lane in the SDK
- Android `.task` bundles now have a real native bridge path through MediaPipe LLM Inference
- that bridge now supports text generation, async streaming callbacks, and image input for compatible multimodal `.task` bundles
- direct `.litertlm` package activation is now wired on Android through the LiteRT-LM engine lane

## New SDK Surface

The SDK now includes:

- device-aware memory-fit assessment in the resolved capability contract
- optional model file-size based runtime memory estimation
- onboarding-plan generation for custom apps that want to recommend local models and explain install/activation steps to users
- a reusable local-model config layer for apps that need a standard "pick model, validate it, save it" setup flow
- a configurable capability registry so new model families can be taught to the SDK without editing one hardcoded inference file
- a shipped default capability catalog artifact that generates the built-in registry defaults
- an SDK-owned observed-probe lane that can run live text/streaming/JSON/vision-readiness checks and save those results locally for later activations
- a focused package-level test suite for contract resolution, runtime selection, config normalization, memory assessment, setup flow, and minimal-runtime compatibility

This is meant to move the SDK closer to a real cartridge workflow:

- app declares what it needs
- SDK inspects the model
- SDK inspects the phone/device
- SDK says whether the model is a healthy fit, a tight fit, or a bad fit
- app can show recommended local models and install guidance before activation

## Direct App Example

Custom apps can now do more than just `diagnoseModel()` and `activateModel()`.

The simple path is activation first:

```ts
const client = createMachineActivationSdk(runtime).createActivationClient();

const session = await client.activateModel({
  modelId: 'gemma-4-e2b',
  filePath: '/models/gemma-4-E2B-it.litertlm',
  appRequirements: {
    textChat: true,
    visionImageInput: true,
  },
});
```

If an app wants advisory diagnostics without blocking activation, it can ask separately:

```ts
const client = createMachineActivationSdk(runtime).createActivationClient();

const advice = await client.diagnoseModel({
  model: {
    modelId: 'gemma-4-e2b',
    filePath: '/models/gemma-4-E2B-it.litertlm',
  },
  appRequirements: {
    textChat: true,
    visionImageInput: true,
    structuredJsonOutput: true,
  },
});

console.log(advice.resolvedContract.warnings);
```

Apps that explicitly want hard preflight enforcement can still opt into it:

```ts
await client.activateModel(
  {
    modelId: 'gemma-4-e2b',
    filePath: '/models/gemma-4-E2B-it.litertlm',
    appRequirements: {
      textChat: true,
      visionImageInput: true,
    },
  },
  { compatibilityPolicy: 'strict' },
);
```

Apps can also ask the SDK for an onboarding plan:

```ts
const client = createMachineActivationSdk(runtime).createActivationClient();

const plan = await client.buildOnboardingPlan({
  appName: 'My AI App',
  model: {
    modelId: 'gemma-4-e2b',
    filePath: '/models/gemma-4-E2B-it.litertlm',
  },
  appRequirements: {
    textChat: true,
    visionImageInput: true,
    structuredJsonOutput: true,
  },
  recommendedModels: [
    {
      id: 'gemma-4-e2b',
      label: 'Gemma 4 E2B',
      description: 'Good balanced on-device multimodal option',
      minimumMemoryMb: 4096,
      preferred: true,
    },
  ],
});
```

That plan is designed for app developers to turn into:

- a model picker
- a local install guide
- a "this phone is too weak for this model" warning
- a recommended-models section for customers

Apps can also make capability truth less guess-based over time:

```ts
import {
  createInMemoryObservedCapabilityStore,
  createMachineActivationSdk,
} from '@machine/activation-sdk';

const sdk = createMachineActivationSdk(runtime, {
  observedCapabilityStore: createInMemoryObservedCapabilityStore(),
});

const client = sdk.createActivationClient();

await client.runObservedCapabilityProbes({
  filePath: '/models/demo.gguf',
});
```

And if a developer needs to teach the SDK about a new model family before a backend can probe it directly:

```ts
import {
  createActivationCapabilityRegistry,
  createMachineActivationSdk,
} from '@machine/activation-sdk';

const registry = createActivationCapabilityRegistry([
  {
    id: 'acme-special',
    match: /acme-special/i,
    infer: () => ({
      inferredFields: {
        structuredJsonOutput: true,
        inputModalities: ['text', 'image'],
      },
      notes: ['Custom registry matched the Acme Special family.'],
    }),
  },
]);

const sdk = createMachineActivationSdk(runtime, {
  capabilityRegistry: registry,
});
```

## External Consumer Proof

There is now a small external-style consumer example that:

- installs the SDK through the package boundary
- uses the public API only
- implements the minimal runtime core
- typechecks outside the host app

See:

- [examples/basic-consumer/package.json](./examples/basic-consumer/package.json)
- [examples/basic-consumer/src/index.ts](./examples/basic-consumer/src/index.ts)

## CI And Release

The package now has dedicated GitHub workflows for:

- CI verification of the SDK package and the external-style consumer example
- tag-based npm publishing for `activation-sdk-v*`

See:

- [../.github/workflows/activation-sdk-ci.yml](./.github/workflows/activation-sdk-ci.yml)
- [../.github/workflows/activation-sdk-release.yml](./.github/workflows/activation-sdk-release.yml)
- [PUBLISHING.md](./PUBLISHING.md)

## Standard Local Model Config

One of the most important product surfaces in this SDK is the local-model setup flow.

Apps should not have to invent their own ad hoc "type the path manually" UX. The SDK now includes a standard config layer for:

- picked model file normalization
- inferred `modelId`
- preset runtime hints
- extension validation
- persisted model-config storage

The first preset is intentionally simple and real:

- `LITERT_LM_ANDROID_PRESET`
- expects a `.litertlm` package
- defaults the runtime hint to `litert.capacitor.android`

Example:

```ts
import {
  createActivationModelSetupController,
  createJsonActivationModelConfigStorage,
  LITERT_LM_ANDROID_PRESET,
} from '@machine/activation-sdk';

const storage = createJsonActivationModelConfigStorage({
  storageKey: 'myapp.machineActivation.modelConfig',
});

const setup = createActivationModelSetupController({
  storage,
  picker: filePicker,
  preset: LITERT_LM_ANDROID_PRESET,
  verifier,
});

const picked = await setup.pickModel();
if (picked) {
  setup.saveConfig(picked.config);
}
```

That gives custom apps a standard way to add the same activation setup flow instead of re-creating model-path logic from scratch.

The intended cartridge setup flow is now:

- `loadState()`
- `pickModel()`
- optional `verifyConfig()`
- `saveConfig()`
- `clearSavedConfig()`

This stays UI-agnostic on purpose. Apps can build their own settings screen or onboarding flow on top, but they should not have to re-invent the storage, picker normalization, or advisory verification contract each time.

## Public Naming

Use these names consistently:

- `Machine Activation SDK`
  - the package and overall product
- `activation contract`
  - the machine-readable compatibility contract inside the SDK
- `activation runtime`
  - a backend adapter implementation
- `cartridge`
  - informal product shorthand for the local model package a user plugs in

Avoid using speculative names like separate product surfaces unless they actually exist as shipped code.

## Reading Order

1. [GETTING_STARTED.md](./GETTING_STARTED.md)
2. [BACKEND_CAPABILITIES.md](./BACKEND_CAPABILITIES.md)
3. [PACKAGE_CONSUMPTION.md](./PACKAGE_CONSUMPTION.md)
4. [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)
5. [APP_INTEGRATION_PLAYBOOK.md](./APP_INTEGRATION_PLAYBOOK.md)
6. [APP_INTEGRATION_AGENT_SPEC.json](./APP_INTEGRATION_AGENT_SPEC.json)
7. [ACTIVATION_SDK_INTEGRATION_LESSONS.md](./ACTIVATION_SDK_INTEGRATION_LESSONS.md)
8. [LITERT_LM_ANDROID_NOTES.md](./LITERT_LM_ANDROID_NOTES.md)
9. [src/index.ts](./src/index.ts)

## Package Checks

From this folder:

```bash
npm run check
```

That verifies the SDK package boundary directly instead of only through the host app.
