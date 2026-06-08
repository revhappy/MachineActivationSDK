import * as React from 'react';
import { streamText, type StreamTextResult } from '@revhappy/activation-sdk';
import { useMachineModel } from '@revhappy/ui';

interface Props {
  modelFilePath: string;
  onSwitchModel: () => void;
}

export function ChatScreen({ modelFilePath, onSwitchModel }: Props): React.ReactElement {
  const model = useMachineModel({ filePath: modelFilePath });
  const [prompt, setPrompt] = React.useState('');
  const [text, setText] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const activeRef = React.useRef<StreamTextResult | null>(null);

  const onSend = async (): Promise<void> => {
    if (!prompt.trim() || !model) return;
    setText('');
    setStreaming(true);
    const result = streamText({ model, prompt, maxTokens: 256 });
    activeRef.current = result;
    let acc = '';
    try {
      for await (const delta of result.textStream) {
        acc += delta;
        setText(acc);
      }
    } finally {
      setStreaming(false);
      activeRef.current = null;
    }
  };

  const onAbort = (): void => {
    if (activeRef.current) void activeRef.current.abort().catch(() => undefined);
  };

  return (
    <main data-machine-ui="electron-chat" style={{ padding: 16, fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ margin: 0 }}>Local chat</h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.7, fontFamily: 'monospace' }}>
            {fileBaseName(modelFilePath)} · {runtimeLabel(modelFilePath)}
          </p>
        </div>
        <button type="button" onClick={onSwitchModel} disabled={streaming}>
          switch model
        </button>
      </header>

      <section data-machine-ui="output" style={{ marginTop: 16 }}>
        <pre style={{ whiteSpace: 'pre-wrap', minHeight: 160, padding: 12, border: '1px solid #ccc' }}>
          {text || (streaming ? 'thinking…' : !model ? 'loading model…' : 'no response yet')}
        </pre>
      </section>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask anything…"
        rows={3}
        style={{ width: '100%', marginTop: 12 }}
        disabled={streaming || !model}
      />

      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => void onSend()} disabled={streaming || !model || !prompt.trim()}>
          Send
        </button>
        <button type="button" onClick={onAbort} disabled={!streaming}>
          Stop
        </button>
      </div>
    </main>
  );
}

function fileBaseName(p: string): string {
  const segs = p.split(/[\\/]/);
  return segs[segs.length - 1] || p;
}

function runtimeLabel(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.gguf')) return 'llama-server (subprocess)';
  if (lower.endsWith('.task')) return 'mediapipe-wasm (renderer)';
  return 'unknown runtime';
}
