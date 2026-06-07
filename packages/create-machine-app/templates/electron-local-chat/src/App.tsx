import * as React from 'react';
import { createMachine, type Machine } from '@machine/activation-sdk';
import { MachineProvider } from '@machine/ui';
import { ChatScreen } from './ChatScreen';
import { SetupScreen } from './SetupScreen';
import { selectRuntimeForModel, detectModelFormat } from './lib/runtimeSelector';
import type { AppConfig } from '../electron/preload-types';

export function App(): React.ReactElement {
  const [config, setConfig] = React.useState<AppConfig | null>(null);

  React.useEffect(() => {
    void window.config.get().then(setConfig);
  }, []);

  const machine = React.useMemo<Machine | null>(() => {
    if (!config?.modelFilePath) return null;
    try {
      return createMachine({ runtimes: selectRuntimeForModel(config.modelFilePath) });
    } catch (err) {
      console.error('Failed to select runtime:', err);
      return null;
    }
  }, [config?.modelFilePath]);

  React.useEffect(() => {
    if (!machine) return;
    return () => {
      void machine.close();
    };
  }, [machine]);

  const handleModelPicked = React.useCallback((filePath: string) => {
    setConfig((prev) => ({ ...(prev ?? { modelFilePath: null }), modelFilePath: filePath }));
  }, []);

  const handleSwitchModel = React.useCallback(async () => {
    const result = await window.config.pickModelFile();
    if (result.filePath) handleModelPicked(result.filePath);
  }, [handleModelPicked]);

  if (config === null) return <p style={{ padding: 16 }}>loading…</p>;
  if (!config.modelFilePath) return <SetupScreen onModelPicked={handleModelPicked} />;

  const fmt = detectModelFormat(config.modelFilePath);
  if (fmt === 'unknown') {
    return (
      <FormatNotice
        title="Unrecognized model file"
        body={
          <>Pick a <code>.gguf</code>, <code>.task</code>, or <code>.litertlm</code> file.</>
        }
        filePath={config.modelFilePath}
        onPickAgain={() => setConfig({ modelFilePath: null })}
      />
    );
  }
  if (fmt === 'litertlm') {
    return (
      <FormatNotice
        title=".litertlm not embeddable yet"
        body={
          <>
            Google&apos;s LiteRT-LM CLI (v0.11.0, May 2026) is single-shot only and ships
            incomplete on Windows (missing companion DLLs). Use the{' '}
            <code>.task</code> build of the same model (e.g.{' '}
            <code>gemma-4-E4B-it-web.task</code> from{' '}
            <code>huggingface.co/google/gemma-4-E4B-it</code>) — this app runs it natively
            via the renderer&apos;s WebAssembly MediaPipe runtime.
          </>
        }
        filePath={config.modelFilePath}
        onPickAgain={() => setConfig({ modelFilePath: null })}
      />
    );
  }
  if (!machine) return <p style={{ padding: 16 }}>initializing runtime…</p>;

  return (
    <MachineProvider machine={machine}>
      <ChatScreen modelFilePath={config.modelFilePath} onSwitchModel={handleSwitchModel} />
    </MachineProvider>
  );
}

function FormatNotice({
  title,
  body,
  filePath,
  onPickAgain,
}: {
  title: string;
  body: React.ReactNode;
  filePath: string;
  onPickAgain: () => void;
}): React.ReactElement {
  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1>{title}</h1>
      <p>{body}</p>
      <p style={{ fontFamily: 'monospace', wordBreak: 'break-all', opacity: 0.6 }}>{filePath}</p>
      <button type="button" onClick={onPickAgain}>Pick another file</button>
    </main>
  );
}
