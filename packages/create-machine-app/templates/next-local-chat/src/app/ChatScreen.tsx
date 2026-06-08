'use client';

import * as React from 'react';
import {
  InferenceIndicator,
  useInference,
  useMachineModel,
} from '@revhappy/ui/web';

const CARTRIDGE_ID = 'dev.machine.gemma-3n-e4b-it';

export function ChatScreen(): React.ReactElement {
  const { model, status: modelStatus } = useMachineModel({ cartridge: CARTRIDGE_ID });
  const inference = useInference(model);
  const [prompt, setPrompt] = React.useState('');

  const onSend = async (): Promise<void> => {
    if (!prompt.trim() || !model) return;
    await inference.start({ prompt, maxTokens: 256 });
  };

  const busy = inference.status === 'streaming' || modelStatus === 'loading';

  return (
    <main data-machine-ui="next-chat" style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <header>
        <h1>Local chat</h1>
        <p>
          cartridge: <code>{CARTRIDGE_ID}</code>
        </p>
      </header>

      <section data-machine-ui="output" style={{ minHeight: 240 }}>
        <pre style={{ whiteSpace: 'pre-wrap' }}>
          {inference.text || (busy ? 'thinking…' : 'no response yet')}
        </pre>
      </section>

      <InferenceIndicator inference={inference} />

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask anything…"
        rows={3}
        style={{ width: '100%' }}
      />

      <div>
        <button type="button" onClick={onSend} disabled={busy || !model}>
          Send
        </button>
        <button
          type="button"
          onClick={inference.abort}
          disabled={inference.status !== 'streaming'}
        >
          Stop
        </button>
      </div>
    </main>
  );
}
