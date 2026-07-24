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
  type ActivationChatMessage,
  type ActivationCompletionOptions,
  type ActivationCompletionResult,
  type ActivationRuntime,
  type ActivationSession,
  type ActivationSessionCreateInput,
} from 'machineai-activation';

const BACKEND_ID = 'llama-server';
const BACKEND_NAME = 'llama.cpp llama-server (subprocess)';

interface ServerHandle {
  modelPath: string;
  port: number;
  proc: ChildProcess;
  baseUrl: string;
}

let activeServer: ServerHandle | null = null;
let vendorInfo: VendorInfo | null = null;

interface VendorInfo {
  build: string;
  slug: string;
  exe: string;
  acceleration: 'cpu' | 'gpu' | 'npu';
}

// Host → vendor slug + binary name, mirroring scripts/fetch-llama-cpp.js.
// macOS prebuilts ship with Metal; the rest are CPU unless the developer
// vendored an accelerated build via LLAMA_CPP_ASSET.
const HOST_DEFAULTS: Record<string, Omit<VendorInfo, 'build'>> = {
  'win32:x64': { slug: 'win-x64', exe: 'llama-server.exe', acceleration: 'cpu' },
  'darwin:arm64': { slug: 'macos-arm64', exe: 'llama-server', acceleration: 'gpu' },
  'darwin:x64': { slug: 'macos-x64', exe: 'llama-server', acceleration: 'gpu' },
  'linux:x64': { slug: 'linux-x64', exe: 'llama-server', acceleration: 'cpu' },
};

function hostDefault(): Omit<VendorInfo, 'build'> {
  const key = `${process.platform}:${process.arch}`;
  return (
    HOST_DEFAULTS[key] ?? {
      slug: `${process.platform}-${process.arch}`,
      exe: process.platform === 'win32' ? 'llama-server.exe' : 'llama-server',
      acceleration: 'cpu',
    }
  );
}

// version.json is written by scripts/fetch-llama-cpp.js and records exactly
// which asset was vendored, so the runtime never has to guess.
function readVendorInfo(): VendorInfo {
  if (vendorInfo) return vendorInfo;
  const fallback = hostDefault();
  try {
    const packaged = path.join(process.resourcesPath, 'llama-cpp', 'version.json');
    const dev = path.join(app.getAppPath(), 'vendor', 'llama-cpp', 'version.json');
    const versionPath = fs.existsSync(packaged) ? packaged : dev;
    const raw = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    vendorInfo = {
      build: String(raw.build ?? raw.tag ?? 'unknown'),
      slug: typeof raw.platform === 'string' ? raw.platform : fallback.slug,
      exe: typeof raw.exe === 'string' ? raw.exe : fallback.exe,
      acceleration:
        raw.acceleration === 'gpu' || raw.acceleration === 'npu'
          ? raw.acceleration
          : fallback.acceleration,
    };
  } catch {
    vendorInfo = { build: 'unknown', ...fallback };
  }
  return vendorInfo;
}

function readBuildTag(): string {
  return readVendorInfo().build;
}

function getResourcePath(): string {
  // In dev: <repo>/vendor/llama-cpp/<slug>
  // In packaged app: <Resources>/llama-cpp/<slug> (via extraResources)
  const { slug } = readVendorInfo();
  const dev = path.join(app.getAppPath(), 'vendor', 'llama-cpp', slug);
  if (fs.existsSync(dev)) return dev;
  return path.join(process.resourcesPath, 'llama-cpp', slug);
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
  const exe = path.join(binDir, readVendorInfo().exe);
  if (!fs.existsSync(exe)) {
    throw new Error(
      `${readVendorInfo().exe} not found at ${exe}. ` +
        `Run \`npm run fetch:llama\` to vendor a llama.cpp release for this platform.`,
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
  // Offload to GPU when the vendored build supports it (macOS Metal, or a
  // CUDA/Vulkan build pulled via LLAMA_CPP_ASSET). llama-server clamps the
  // layer count to whatever the model actually has.
  if (readVendorInfo().acceleration === 'gpu') {
    args.push('--n-gpu-layers', '999');
  }
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

/**
 * Forward a caller's AbortSignal into our own fetch controller. Returns a
 * detach function that must run when the completion settles, so a signal
 * belonging to a finished call can't cancel the next one.
 */
function chainAbortSignal(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!signal) return () => undefined;
  if (signal.aborted) {
    controller.abort();
    return () => undefined;
  }
  const onAbort = (): void => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
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

// Flatten SDK message parts to plain text and fold the `tool` role into a user
// turn. Most local chat templates (Gemma, Llama 3, ChatML via --jinja) have no
// `tool` role; sending one makes the template either reject the turn or render
// it wrong, which silently breaks generateText's tool loop.
function toServerMessage(
  message: ActivationChatMessage,
): ChatRequestBody['messages'][number] {
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .map((part) => (part.type === 'text' ? part.text : ''))
          .filter(Boolean)
          .join('\n');

  if (message.role === 'tool') {
    return { role: 'user', content: `Tool result: ${text}` };
  }
  return { role: message.role, content: text };
}

async function createLlamaServerSession(
  input: ActivationSessionCreateInput,
): Promise<ActivationSession> {
  const handle = await getOrStartServer(input.filePath);
  const vendor = readVendorInfo();
  const acceleration = vendor.acceleration;

  const resolvedCapabilities = {
    textCompletion: true,
    textChat: true,
    streaming: true,
    visionImageInput: false,
    structuredJsonOutput: true,
    // The tool loop rides on grammar-constrained JSON, which this lane
    // forwards end-to-end — so tool calling genuinely works here.
    toolCalling: true,
    projectorReady: false,
    accelerationMode: acceleration,
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
      toolCalling: true,
      requiresProjector: false,
      projectorAttached: false,
      notes: [`llama.cpp build ${vendor.build} (${vendor.slug})`],
    },
    backend: {
      backendId: BACKEND_ID,
      backendName: BACKEND_NAME,
      sessionCreationAvailable: true,
      supportsStreaming: true,
      supportsVision: false,
      supportsStructuredJsonOutput: true,
      supportsToolCalling: true,
      supportsCancellation: true,
      supportedAccelerationModes: [acceleration],
      detectedDevices: [],
      notes: [`vendored asset: ${vendor.slug}`],
    },
    device: {
      platform: `electron-main-subprocess (${process.platform}/${process.arch})`,
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: [acceleration],
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
      accelerationMode: acceleration,
    },
  };

  let activeAbort: AbortController | null = null;

  const runChat = async (
    history: ChatRequestBody['messages'],
    options: ActivationCompletionOptions | undefined,
  ): Promise<ActivationCompletionResult> => {
    const opts = options ?? {};
    const messages: ChatRequestBody['messages'] = [];
    // Only prepend systemPrompt if the caller didn't already supply a system
    // turn — generateText's tool loop bakes its system prompt into messages[0]
    // and also passes `system` through, which would otherwise duplicate it.
    if (opts.systemPrompt && !history.some((m) => m.role === 'system')) {
      messages.push({ role: 'system', content: opts.systemPrompt });
    }
    messages.push(...history);

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

    const controller = new AbortController();
    activeAbort = controller;
    // The SDK passes a per-completion `abortSignal` (generateText/streamText/
    // generateObject all forward it). Chaining it into the fetch controller
    // cancels the HTTP request itself, which is tighter than waiting for the
    // session-wide `abort()` — and it stops llama-server generating tokens
    // nobody is going to read.
    const detachCallerSignal = chainAbortSignal(opts.abortSignal, controller);

    const started = Date.now();
    let tokensGenerated = 0;
    let accumulated = '';

    try {
      const res = await fetch(`${handle.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
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
    } finally {
      detachCallerSignal();
      if (activeAbort === controller) activeAbort = null;
    }

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
    complete: (prompt, options) => runChat([{ role: 'user', content: prompt }], options),
    completeChat: (messages, options) => runChat(messages.map(toServerMessage), options),
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
      accelerationMode: acceleration,
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
