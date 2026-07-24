import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join as pathJoin } from 'node:path';

import {
  ACTIVATION_CONTRACT_SCHEMA_VERSION,
  type ActivationAccelerationMode,
} from '../../activation/activationContract';
import type {
  ActivationChatMessage,
  ActivationCompletionOptions,
  ActivationCompletionResult,
  ActivationRuntime,
  ActivationSession,
  ActivationSessionCreateInput,
} from '../../activation/activationAdapter';

/**
 * A headless `llama-server` runtime used only by `machine doctor --run`.
 *
 * This is deliberately CLI-internal rather than a shipped SDK runtime. The
 * point of `--run` is to exercise the *real* SDK path — `createMachine` →
 * `generateText` / `generateObject`, grammar and all — against a real model,
 * so the numbers doctor prints are observed rather than assumed. Promoting
 * this to a public `machineai-activation/node` runtime is a separate decision;
 * see CARTRIDGE_SDK_ROADMAP.md.
 *
 * It mirrors the electron template's `llamaServerRuntime.ts` minus the
 * Electron-specific path resolution.
 */

const BACKEND_ID = 'llama-server';
const BACKEND_NAME = 'llama.cpp llama-server (subprocess)';

export interface LlamaServerOptions {
  /** Path to `llama-server[.exe]`. */
  serverBinary: string;
  modelPath: string;
  contextTokens?: number;
  gpuLayers?: number;
  /** Called with server stderr lines; doctor surfaces these on failure. */
  onLog?: (line: string) => void;
}

export interface LlamaServerHandle {
  runtime: ActivationRuntime;
  /** Startup lines llama-server printed — device/backend detection lives here. */
  logs: string[];
  close(): Promise<void>;
}

/**
 * Look for a vendored llama-server the way the electron template lays it out
 * (`vendor/llama-cpp/<slug>/llama-server[.exe]`), starting at `startDir` and
 * walking up. Also honors `MACHINE_LLAMA_SERVER`.
 */
export function discoverLlamaServer(...startDirs: string[]): string | undefined {
  const fromEnv = process.env.MACHINE_LLAMA_SERVER;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const slugs = [
    `${process.platform}-${process.arch}`,
    'win-x64',
    'macos-arm64',
    'macos-x64',
    'linux-x64',
  ];
  // `vendor/llama-cpp/<slug>` is where fetch-llama-cpp.js puts it; the
  // unprefixed form covers a hand-placed binary.
  const roots = ['vendor', '.'];

  for (const startDir of startDirs) {
    let dir = startDir;
    for (let depth = 0; depth < 6; depth += 1) {
      for (const root of roots) {
        for (const slug of slugs) {
          const candidate = pathJoin(dir, root, 'llama-cpp', slug, exe);
          if (existsSync(candidate)) return candidate;
        }
      }
      const parent = pathJoin(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

/** Read the acceleration mode recorded by `fetch-llama-cpp.js`, if present. */
export function readVendoredAcceleration(
  serverBinary: string,
): { build?: string; acceleration: ActivationAccelerationMode } {
  const candidates = [
    pathJoin(serverBinary, '..', '..', 'version.json'),
    pathJoin(serverBinary, '..', 'version.json'),
  ];
  for (const candidate of candidates) {
    try {
      const raw = JSON.parse(readFileSync(candidate, 'utf8')) as {
        build?: string;
        acceleration?: string;
      };
      const acceleration =
        raw.acceleration === 'gpu' || raw.acceleration === 'npu'
          ? raw.acceleration
          : 'cpu';
      return { build: raw.build, acceleration };
    } catch {
      /* try the next location */
    }
  }
  return { acceleration: 'cpu' };
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error('Failed to allocate a port for llama-server.'));
      }
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'ok') return;
      }
      lastError = new Error(`/health returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `llama-server did not become healthy within ${timeoutMs}ms. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

interface ChatMessageWire {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function toWireMessage(message: ActivationChatMessage): ChatMessageWire {
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .map((part) => (part.type === 'text' ? part.text : ''))
          .filter(Boolean)
          .join('\n');

  // Most local chat templates have no `tool` role; fold it into a user turn.
  if (message.role === 'tool') {
    return { role: 'user', content: `Tool result: ${text}` };
  }
  return { role: message.role, content: text };
}

/**
 * Decode throughput measured from the first token onward. The first token
 * itself costs a full prompt evaluation, so it is excluded from the window
 * (n-1 intervals across n tokens).
 */
function decodeRate(tokensGenerated: number, firstTokenAt: number): number {
  if (tokensGenerated < 2 || firstTokenAt === 0) return 0;
  const seconds = (Date.now() - firstTokenAt) / 1000;
  return seconds > 0 ? (tokensGenerated - 1) / seconds : 0;
}

async function* iterateSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

export async function startLlamaServerRuntime(
  options: LlamaServerOptions,
): Promise<LlamaServerHandle> {
  const port = await pickFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs: string[] = [];

  const args = [
    '--model', options.modelPath,
    '--port', String(port),
    '--host', '127.0.0.1',
    '--ctx-size', String(options.contextTokens ?? 4096),
    '--no-webui',
    '--jinja',
  ];
  if (options.gpuLayers && options.gpuLayers > 0) {
    args.push('--n-gpu-layers', String(options.gpuLayers));
  }

  const proc: ChildProcess = spawn(options.serverBinary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const record = (chunk: string): void => {
    for (const line of chunk.split('\n')) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      logs.push(trimmed);
      options.onLog?.(trimmed);
    }
  };
  proc.stderr?.setEncoding('utf8');
  proc.stderr?.on('data', record);
  proc.stdout?.setEncoding('utf8');
  proc.stdout?.on('data', record);

  const exited = new Promise<never>((_, reject) => {
    // A bad binary path surfaces as an 'error' event (ENOENT), not a throw
    // from spawn(). Without this the rejection escapes as an uncaught
    // exception and the caller never gets to report anything useful.
    proc.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          `Could not start llama-server at ${options.serverBinary}: ${error.message}`,
        ),
      );
    });
    proc.on('exit', (code, signal) => {
      reject(
        new Error(
          `llama-server exited (code=${code}, signal=${signal}) before becoming healthy.\n` +
            `Recent output:\n${logs.slice(-25).join('\n') || '(none)'}`,
        ),
      );
    });
  });
  // The rejection is consumed by the race below; mark it handled so an exit
  // after a successful start can't surface as an unhandled rejection.
  exited.catch(() => undefined);

  try {
    await Promise.race([waitForHealth(baseUrl, 120_000), exited]);
  } catch (error) {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
    throw error;
  }

  const accel = readVendoredAcceleration(options.serverBinary);
  const acceleration: ActivationAccelerationMode =
    options.gpuLayers && options.gpuLayers > 0 ? accel.acceleration : 'cpu';

  const runtime: ActivationRuntime = {
    id: BACKEND_ID,
    name: BACKEND_NAME,
    createSession: async (
      input: ActivationSessionCreateInput,
    ): Promise<ActivationSession> => {
      const resolvedCapabilities = {
        textCompletion: true,
        textChat: true,
        streaming: true,
        visionImageInput: false,
        structuredJsonOutput: true,
        toolCalling: true,
        projectorReady: false,
        accelerationMode: acceleration,
      };

      const resolvedContract = {
        schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
        compatible: true,
        degraded: false,
        compatibility: 'compatible' as const,
        resolvedCapabilities,
        memoryAssessment: {
          status: 'unknown' as const,
          detail: 'in-process subprocess; see the doctor report for the estimate',
        },
        reasons: [],
        warnings: [],
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
          notes: accel.build ? [`llama.cpp build ${accel.build}`] : [],
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
          notes: [],
        },
        device: {
          platform: `${process.platform}/${process.arch}`,
          cameraAvailable: false,
          photoLibraryAvailable: false,
          availableAccelerationModes: [acceleration],
          notes: [],
        },
        resolvedContract,
        diagnostics: {
          sourceAdapterId: BACKEND_ID,
          backendId: BACKEND_ID,
          accelerationMode: acceleration,
        },
      };

      let activeAbort: AbortController | null = null;

      const runChat = async (
        history: ChatMessageWire[],
        completion: ActivationCompletionOptions | undefined,
      ): Promise<ActivationCompletionResult> => {
        const opts = completion ?? {};
        const messages: ChatMessageWire[] = [];
        if (opts.systemPrompt && !history.some((m) => m.role === 'system')) {
          messages.push({ role: 'system', content: opts.systemPrompt });
        }
        messages.push(...history);

        const controller = new AbortController();
        activeAbort = controller;
        const callerSignal = opts.abortSignal;
        const onCallerAbort = (): void => controller.abort();
        if (callerSignal) {
          if (callerSignal.aborted) controller.abort();
          else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
        }

        const started = Date.now();
        // Throughput is measured from the FIRST token, not from request start.
        // Prompt evaluation happens before any token comes back, and folding
        // it into tokens/sec makes short generations look 5x slower than the
        // model actually decodes. llama.cpp reports the two separately for the
        // same reason.
        let firstTokenAt = 0;
        let tokensGenerated = 0;
        let accumulated = '';

        try {
          const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'local',
              messages,
              stream: true,
              max_tokens: opts.maxTokens ?? 512,
              temperature: opts.temperature,
              top_p: opts.topP,
              top_k: opts.topK,
              stop: opts.stopSequences,
              grammar: opts.grammar,
            }),
            signal: controller.signal,
          });
          if (!res.ok || !res.body) {
            const errText = await res.text().catch(() => '<no body>');
            throw new Error(`llama-server returned ${res.status}: ${errText}`);
          }

          for await (const data of iterateSse(res.body)) {
            if (data === '[DONE]') break;
            let parsed: { choices?: Array<{ delta?: { content?: string } }> };
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }
            const delta = parsed.choices?.[0]?.delta?.content ?? '';
            if (!delta) continue;
            if (firstTokenAt === 0) firstTokenAt = Date.now();
            tokensGenerated += 1;
            accumulated += delta;
            opts.onToken?.(delta);
            opts.onChunk?.({
              rawToken: delta,
              text: accumulated,
              textDelta: delta,
              reasoningText: '',
              reasoningDelta: '',
              tokensGenerated,
              tokensPerSecond: decodeRate(tokensGenerated, firstTokenAt),
            });
          }
        } finally {
          if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
          if (activeAbort === controller) activeAbort = null;
        }

        return {
          text: accumulated,
          reasoningText: '',
          tokensGenerated,
          tokensPerSecond: decodeRate(tokensGenerated, firstTokenAt),
        };
      };

      return {
        modelId: input.modelId,
        backendId: BACKEND_ID,
        resolvedContract,
        capabilitySnapshot,
        complete: (prompt, completion) =>
          runChat([{ role: 'user', content: prompt }], completion),
        completeChat: (messages, completion) =>
          runChat(messages.map(toWireMessage), completion),
        contextState: async () => ({
          strategy: 'fresh' as const,
          reuseStateAvailable: false,
          maxContextTokens: options.contextTokens ?? 4096,
          overflowStrategy: 'reset' as const,
          notes: [],
        }),
        resetContext: async () => undefined,
        probeVisionReadiness: async () => ({ ready: false, detail: 'not supported' }),
        diagnostics: async () => ({
          sourceAdapterId: BACKEND_ID,
          backendId: BACKEND_ID,
          backendName: BACKEND_NAME,
          backendVersion: accel.build,
          accelerationMode: acceleration,
        }),
        abort: async () => {
          activeAbort?.abort();
        },
        close: async () => undefined,
      };
    },
  };

  return {
    runtime,
    logs,
    close: async () => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    },
  };
}
