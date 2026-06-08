# machineai-activation-ui

Headless React / React Native UI kit for [`machineai-activation`](../..).

Drop-in components for model picker, cartridge card, activation status, inference indicator, and model-import flows — so apps don't rebuild basic local-model UX from scratch.

## Install

```bash
npm install machineai-activation-ui machineai-activation react
# for React Native apps:
npm install react-native
```

## Usage

### Core hooks (portable — works on web + React Native)

```tsx
import {
  MachineProvider,
  useMachineContext,
  useMachineModel,
  useInference,
  useActivationSnapshot,
  useCartridgeFilter,
} from 'machineai-activation-ui';
import { createMachine } from 'machineai-activation';

const machine = createMachine({ runtimes: [myRuntime] });

function App({ children }) {
  return <MachineProvider machine={machine}>{children}</MachineProvider>;
}

function ChatScreen() {
  const model = useMachineModel({ filePath: '/models/gemma.gguf' });
  const inference = useInference(model);

  return (
    <>
      <button onClick={() => inference.start({ model: model!, prompt: 'Hi' })}>
        Run
      </button>
      <pre>{inference.text}</pre>
    </>
  );
}
```

### Web components

```tsx
import { ModelPicker, CartridgeCard, InferenceIndicator } from 'machineai-activation-ui/web';
```

### React Native components

```tsx
import { ModelPicker, CartridgeCard, InferenceIndicator } from 'machineai-activation-ui/native';
```

## Design principles

- **Headless first.** All logic lives in hooks. The shipped components are thin, override-friendly wrappers. Bring your own styling and layout.
- **Zero styling opinion.** Every web component accepts `className`; every native component accepts `style`. No CSS ships.
- **Optional `react-native`.** Web-only apps don't install it.

## Testing

Core hooks are unit-tested under `tests/core/`. Component behavior tests land once the first reference app (M8) exercises them end-to-end. See `CARTRIDGE_SDK_ROADMAP.md` M6 scope decisions.
