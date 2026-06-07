import * as React from 'react';

interface Props {
  onModelPicked: (filePath: string) => void;
}

export function SetupScreen({ onModelPicked }: Props): React.ReactElement {
  const [picking, setPicking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handlePick = async (): Promise<void> => {
    setPicking(true);
    setError(null);
    try {
      const result = await window.config.pickModelFile();
      if (result.filePath) onModelPicked(result.filePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 640, fontFamily: 'system-ui' }}>
      <h1>Pick a local model</h1>
      <p>Three formats are accepted out of the box:</p>
      <ul>
        <li>
          <code>.gguf</code> — runs in the main process via the bundled <code>llama-server</code>{' '}
          subprocess (CPU). Grammar-constrained generation works (the SDK&apos;s{' '}
          <code>generateObject</code> uses GBNF for sampling-time JSON shape enforcement).
          The vendored llama.cpp build is fetched from upstream releases at package time, so
          new model architectures are picked up by re-running <code>npm run fetch:llama</code>.
        </li>
        <li>
          <code>.task</code> — MediaPipe LLM bundles. Runs in the renderer via WebAssembly
          using <code>@mediapipe/tasks-genai</code>. No grammar support; structured output
          falls back to the prompt-and-retry path inside <code>generateObject</code>.
        </li>
        <li>
          <code>.litertlm</code> — accepted by the picker. Currently displays an explanatory
          notice (Google&apos;s LiteRT-LM Windows CLI v0.11.0 is single-shot and ships
          incomplete on Windows). When Google ships a daemon mode + complete release, we
          can add it as a third runtime.
        </li>
      </ul>

      <button type="button" onClick={() => void handlePick()} disabled={picking}>
        {picking ? 'opening picker…' : 'choose model file'}
      </button>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 24 }}>
        Path is persisted to <code>config.json</code> under the app&apos;s user-data folder.
      </p>
    </main>
  );
}
