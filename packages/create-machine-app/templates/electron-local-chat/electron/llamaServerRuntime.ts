// llamaServerRuntime — main-process ActivationRuntime that spawns the
// llama.cpp `llama-server.exe` binary as a subprocess and talks to it over
// HTTP. This decouples the app from any single npm package's release cadence
// for llama.cpp: whenever a new model architecture lands upstream, we just
// re-run scripts/fetch-llama-cpp.js to vendor the new prebuilt and ship it.
//
// Why a server, not a library:
//   - llama.cpp's reference server (llama-server) tracks llama.cpp's HEAD
//     daily via official prebuilt CI binaries on GitHub Releases.
//   - The OpenAI-compatible HTTP surface is stable across llama.cpp releases.
//   - Subprocess isolation: a model load that crashes llama.cpp does not take
//     down the Electron main process.
//   - Streaming via SSE is well-defined and works through any standard fetch.
//
// Lifecycle: the server starts on first `createSession` for a given model
// path, and is reused across sessions on the same path. Switching to a
// different model path kills the existing server before starting a new one.
// On app quit we fire `disposeLlamaServer()` to terminate cleanly.

import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as net from 'node:net';
import {
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  type ActivationCompletionOptions,
  type ActivationCompletionResult,
  type ActivationRuntime,
  type ActivationSession,
  type ActivationSessionCreateInput,
} from '@machine/activation-sdk';

const BACKEND_ID = 'llama-server';
const BACKEND_NAME = 'llama.cpp llama-server (subprocess)';

interface ServerHandle {
  modelPath: string;
  port: number;
  proc: ChildProcess;
  baseUrl: string;
}

let activeServer: ServerHandle | null = null;
let buildTag: string | null = null;

function getResourcePath(): string {
  // In dev: <repo>/vendor/llama-cpp/win-x64
  // In packaged app: <Resources>/llama-cpp/win-x64 (via extraResources)
  const dev = path.join(app.getAppPath(), 'vendor', 'llama-cpp', 'win-x64');
  if (fs.existsSync(dev)) return dev;
  return path.join(process.resourcesPath, 'llama-cpp', 'win-x64');
}

function readBuildTag(): string {
  if (buildTag) return buildTag;
  try {
    // Try packaged location first, then dev.
    const packaged = path.join(process.resourcesPath, 'llama-cpp', 'version.json');
    const dev = path.join(app.getAppPath(), 'vendor', 'llama-cpp', 'version.json');
    const versionPath = fs.existsSync(packaged) ? packaged : dev;
    const raw = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    buildTag = String(raw.build ?? raw.tag ?? 'unknown');
  } catch {
    buildTag = 'unknown';
  }
  return buildTag;
}

function logToFile(line: string): void {
  try {
    const logPath = path.join(app.getPath('userData'), 'main.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* best-effort */
  }
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error('Failed to allocate port'));
      }
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'ok') return;
      }
      // llama-server returns 503 with status=loading-model while warming up.
      lastErr = new Error(`/health returned ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `llama-server did not become healthy within ${timeoutMs}ms. Last error: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

async function startServer(modelPath: string): Promise<ServerHandle> {
  const binDir = getResourcePath();
  const exe = path.join(binDir, 'llama-server.exe');
  if (!fs.existsSync(exe)) {
    throw new Error(
      `llama-server.exe not found at ${exe}. ` +
        `Run \`npm run fetch:llama\` to vendor a llama.cpp release.`,
    );
  }
  const port = await pickFreePort();
  const args = [
    '--model', modelPath,
    '--port', String(port),
    '--host', '127.0.0.1',
    '--ctx-size', '4096',
    '--no-webui',
    '--jinja',
    '--log-disable',
  ];
  logToFile(`spawning llama-server (build ${readBuildTag()}): ${exe} ${args.join(' ')}`);

  const proc = spawn(exe, args, {
    cwd: binDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderrTail = '';
  proc.stderr?.setEncoding('utf8');
  proc.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4096);
    logToFile(`[llama-server stderr] ${chunk.trimEnd()}`);
  });
  proc.stdout?.setEncoding('utf8');
  proc.stdout?.on('data', (chunk: string) => {
    logToFile(`[llama-server stdout] ${chunk.trimEnd()}`);
  });

  const exitPromise = new Promise<never>((_, reject) => {
    proc.on('exit', (code, signal) => {
      logToFile(`llama-server exited code=${code} signal=${signal}`);
      reject(
        new Error(
          `llama-server exited (code=${code}, signal=${signal}) before becoming healthy.\n` +
            `Recent stderr:\n${stderrTail.trim() || '(none)'}`,
        ),
      );
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    // Race health check vs early-exit: whichever happens first.
    await Promise.race([waitForHealth(baseUrl, 60_000), exitPromise]);
  } catch (err) {
    try { proc.kill('SIGTERM'); } catch { /* */ }
    throw err;
  }

  return { modelPath, port, proc, baseUrl };
}

async function getOrStartServer(modelPath: string): Promise<ServerHandle> {
  if (activeServer && activeServer.modelPath === modelPath) {
    if (!activeServer.proc.killed && activeServer.proc.exitCode === null) {
      return activeServer;
    }
    activeServer = null;
  }
  if (activeServer) {
    logToFile(`switching model: stopping ${activeServer.modelPath}`);
    try { activeServer.proc.kill('SIGTERM'); } catch { /* */ }
    activeServer = null;
  }
  activeServer = await startServer(modelPath);
  return activeServer;
}

export async function disposeLlamaServer(): Promise<void> {
  if (!activeServer) return;
  try { activeServer.proc.kill('SIGTERM'); } catch { /* */ }
  activeServer = null;
}

interface ChatRequestBody {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  stream: true;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop?: string[];
  grammar?: string;
}

async function* iterateSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      if (line.startsWith('data:')) {
        yield line.slice(5).trim();
      }
    }
  }
}

async function createLlamaServerSession(
  input: ActivationSessionCreateInput,
): Promise<ActivationSession> {
  const handle = await getOrStartServer(input.filePath);

  const resolvedCapabilities = {
    textCompletion: true,
    textChat: true,
    streaming: true,
    visionImageInput: false,
    structuredJsonOutput: true,
    toolCalling: false,
    projectorReady: false,
    accelerationMode: 'cpu' as const,
  };

  const capabilitySnapshot = {
    schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
    appRequirements: input.appRequirements ?? {},
    model: {
      modelId: input.modelId,
      modelPath: input.filePath,
      inputModalities: ['text' as const],
      outputModalities: ['text' as const],
      supportsTextCompletion: true,
      supportsTextChat: true,
      supportsStreaming: true,
      structuredJsonOutput: true,
      toolCalling: false,
      requiresProjector: false,
      projectorAttached: false,
      notes: [`llama.cpp build ${readBuildTag()}`],
    },
    backend: {
      backendId: BACKEND_ID,
      backendName: BACKEND_NAME,
      sessionCreationAvailable: true,
      supportsStreaming: true,
      supportsVision: false,
      supportsStructuredJsonOutput: true,
      supportsToolCalling: false,
      supportsCancellation: true,
      supportedAccelerationModes: ['cpu' as const],
      detectedDevices: [],
      notes: [],
    },
    device: {
      platform: 'electron-main-subprocess',
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: ['cpu' as const],
      notes: [],
    },
    resolvedContract: {
      schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
      compatible: true,
      degraded: false,
      compatibility: 'compatible' as const,
      resolvedCapabilities,
      memoryAssessment: { status: 'unknown' as const, detail: 'on-device (subprocess)' },
      reasons: [],
      warnings: [],
    },
    diagnostics: {
      sourceAdapterId: BACKEND_ID,
      backendId: BACKEND_ID,
      accelerationMode: 'cpu' as const,
    },
  };

  let activeAbort: AbortController | null = null;

  const runComplete = async (
    prompt: string,
    options: ActivationCompletionOptions | undefined,
  ): Promise<ActivationCompletionResult> => {
    const opts = options ?? {};
    const messages: ChatRequestBody['messages'] = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const body: ChatRequestBody = {
      model: 'local',
      messages,
      stream: true,
      max_tokens: opts.maxTokens ?? 512,
      temperature: opts.temperature,
      top_p: opts.topP,
      top_k: opts.topK,
      stop: opts.stopSequences,
      grammar: opts.grammar,
    };

    activeAbort = new AbortController();
    const started = Date.now();
    let tokensGenerated = 0;
    let accumulated = '';

    const res = await fetch(`${handle.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: activeAbort.signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '<no body>');
      throw new Error(`llama-server returned ${res.status}: ${errText}`);
    }

    for await (const data of iterateSse(res.body)) {
      if (data === '[DONE]') break;
      let parsed: { choices?: Array<{ delta?: { content?: string }; finish_reason?: string }> };
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = parsed.choices?.[0]?.delta?.content ?? '';
      if (!delta) continue;
      tokensGenerated += 1;
      accumulated += delta;
      const seconds = (Date.now() - started) / 1000;
      const tokensPerSecond = seconds > 0 ? tokensGenerated / seconds : 0;
      opts.onToken?.(delta);
      opts.onChunk?.({
        rawToken: delta,
        text: accumulated,
        textDelta: delta,
        reasoningText: '',
        reasoningDelta: '',
        tokensGenerated,
        tokensPerSecond,
      });
    }
    activeAbort = null;

    const seconds = (Date.now() - started) / 1000;
    return {
      text: accumulated,
      reasoningText: '',
      tokensGenerated,
      tokensPerSecond: seconds > 0 ? tokensGenerated / seconds : 0,
    };
  };

  return {
    modelId: input.modelId,
    backendId: BACKEND_ID,
    resolvedContract: capabilitySnapshot.resolvedContract,
    capabilitySnapshot,
    complete: (prompt, options) => runComplete(prompt, options),
    completeChat: async (messages, options) => {
      const last = messages[messages.length - 1];
      const lastContent =
        typeof last?.content === 'string'
          ? last.content
          : (last?.content ?? [])
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('\n');
      return runComplete(lastContent ?? '', options);
    },
    contextState: async () => ({
      strategy: 'fresh',
      reuseStateAvailable: false,
      overflowStrategy: 'reset',
      notes: [],
    }),
    resetContext: async () => undefined,
    probeVisionReadiness: async () => ({ ready: false, detail: 'not supported' }),
    diagnostics: async () => ({
      sourceAdapterId: BACKEND_ID,
      backendId: BACKEND_ID,
      accelerationMode: 'cpu',
    }),
    abort: async () => {
      if (activeAbort) {
        try { activeAbort.abort(); } catch { /* */ }
      }
    },
    close: async () => undefined,
  };
}

export const llamaServerRuntime: ActivationRuntime = {
  id: BACKEND_ID,
  name: BACKEND_NAME,
  createSession: (input) => createLlamaServerSession(input),
};
