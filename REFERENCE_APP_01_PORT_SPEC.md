# Reference App 01 Port Spec

This spec is for the first polished reference app migration built on top of the Machine Activation SDK.

Its purpose is not to impress with product complexity.

Its purpose is to prove the ideal app-port shape cleanly:

- simple provider seam
- reusable model setup flow
- clean local activation path
- subtle local/cloud proof
- resilient output shaping
- no unnecessary friction

## Chosen App Shape

Build a small text-first app called:

`Meeting Notes Assistant`

The app takes pasted meeting notes or a transcript and returns:

- a concise meeting summary
- key decisions
- action items
- open questions
- optional structured JSON output for downstream UI cards

This is the right first polished example because:

- it is simple enough to build cleanly
- it has one obvious cloud inference seam
- it avoids multimodal/runtime image complexity
- it still proves real app portability
- it feels like a real app concept instead of a generic demo
- it is easy for outside developers to understand and copy

## Primary Goal

Show that a developer can take a normal AI-native app, keep the UI and product behavior, and swap the inference layer underneath it with the Machine Activation SDK.

The local path should feel like:

1. load or pick a model
2. save the cartridge choice
3. run a meeting-notes analysis
4. see subtle proof that inference was local

## Non-Goals

Do not:

- build a large feature-rich product
- add accounts or backend complexity
- add image analysis
- overcomplicate diagnostics
- redesign the app around the SDK

## Product Requirements

### Core Workflow

The user can:

- paste meeting notes or transcript text into a large input area
- choose one output mode:
  - `Summary`
  - `Summary + Actions`
  - `Structured`
- tap `Generate`
- see a result screen with clearly separated sections for:
  - summary
  - key decisions
  - action items
  - open questions

### Settings Workflow

The user can:

- switch between `Cloud` and `Local model`
- use the SDK-backed model setup flow
- load a compatible local cartridge
- save the cartridge selection

### Source Proof

The app should show a small subtle badge:

- `Cloud model`
- `Local model`

This should appear:

- during generation
- in the result header

## Technical Architecture

### 1. Provider Seam

Add a tiny app-level provider mode:

- `cloud`
- `machine_activation`

This should be the only top-level mode switch.

Do not add more provider abstractions than necessary.

### 2. SDK Setup Flow

Use the SDK's reusable setup flow directly:

- `createActivationModelSetupController(...)`
- `loadState()`
- `pickModel()`
- optional `verifyConfig()`
- `saveConfig()`
- `clearSavedConfig()`

Do not rebuild picker/storage logic manually unless the platform bridge requires a thin adapter.

### 3. Runtime Registration

Register one local runtime at app boot.

First-choice runtime lane:

- `GGUF` via llama-family runtime if the example target is RN/host-aligned

Acceptable alternate lane:

- LiteRT if the example is Android-first and the runtime is already available

Recommendation:

Use the simplest existing lane already working in the chosen scaffold.

### 4. Inference Service

Create one focused service:

`meetingNotesService`

Responsibilities:

- accept input text and mode
- route to cloud when provider is `cloud`
- route to Machine Activation when provider is `machine_activation`
- keep the output contract stable for the UI

### 5. Output Shaping Layer

The local result must be normalized before it reaches the UI.

Expected normalized shape:

```ts
type MeetingNotesResult = {
  title: string;
  summary: string;
  keyDecisions: string[];
  actionItems: string[];
  openQuestions: string[];
  structured?: {
    sentiment?: 'positive' | 'neutral' | 'negative';
    urgency?: 'low' | 'medium' | 'high';
    topics: string[];
  };
};
```

Rules:

- missing arrays become `[]`
- missing strings become safe fallback strings
- malformed JSON should not crash the app
- the UI should never parse raw model output directly

### 6. Prompting

Keep prompts short and disciplined.

Need two prompt shapes:

- cloud prompt
- local prompt

The local prompt should avoid overlong instructions.

For local mode:

- prefer compact structure
- use `responseFormat: 'json'` when on the llama GGUF lane
- still normalize output after inference

### 7. UI Shape

Keep the app minimal and polished.

Required screens:

- `ComposerScreen`
- `ResultScreen`
- `SettingsScreen`

Required UI elements:

- large text composer
- mode segmented control
- generate button
- subtle source badge
- results cards/sections
- local model setup card in settings

## Suggested Folder Structure

```text
src/
  app/
    App.tsx
    routes.ts
  components/
    SourceBadge.tsx
    ModePicker.tsx
    ResultCard.tsx
    ModelSetupCard.tsx
  screens/
    NotesComposerScreen.tsx
    ResultScreen.tsx
    SettingsScreen.tsx
  services/
    aiProvider.ts
    meetingNotesService.ts
    cloudMeetingNotesService.ts
    localMeetingNotesService.ts
    activationRuntime.ts
    modelSetup.ts
  types/
    meetingNotes.ts
  docs/
    ACTIVATION_SDK_INTEGRATION_CHECKPOINT.md
```

## Required SDK Usage

The implementation should clearly demonstrate:

- `createMachineActivationSdk(runtime).createActivationClient()`
- `activateModel(...)`
- SDK setup controller usage for model loading
- permissive activation by default
- diagnostics only as advisory

## Success Criteria

This reference app is successful if:

- it feels like a real small product, not a test harness
- cloud mode works
- local mode works
- the same UI works for both
- the local path uses the SDK cleanly
- the user does not need to type raw model paths
- the app does not crash on partial local output
- the local/cloud source is visible but subtle
- the code is simple enough for outsiders to copy

## Deliverables

The implementing agent should produce:

1. the app itself
2. a short integration checkpoint doc inside the app
3. one short migration note explaining:
   - where the cloud seam was
   - where the SDK was inserted
   - what runtime lane was chosen
   - what had to stay app-specific

## Explicit Guidance For The Implementing Agent

Prioritize:

- clarity
- small surface area
- polished happy path
- readable code

Avoid:

- experimental architecture
- unnecessary capability gating
- too many settings knobs
- app-specific hacks leaking back into the SDK core

If a tradeoff is needed, choose the simpler path that best demonstrates the cartridge model.

## Why This App Comes Before The Next Harder Port

The first reference app should teach the pattern.

The second real port should prove the pattern under more product complexity.

That means this first app is intentionally a reference integration, not a stress test.
