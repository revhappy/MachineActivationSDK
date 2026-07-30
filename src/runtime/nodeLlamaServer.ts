import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join as pathJoin } from 'node:path';

import type { ActivationRuntime } from '../activation/activationAdapter';
import type { ActivationAccelerationMode } from '../activation/activationContract';

import { llamaServerRuntime } from './llamaServerRuntime';
import type { LlamaServerRuntimeOptions } from './types';

export interface StartLlamaServerOptions {
  /** Path to `llama-server[.exe]`. See `discoverLlamaServer()`. */
  serverBinary: string;
  /** Path to the `.gguf` weights. */
  modelPath: string;
  /** Multimodal projector (`--mmproj`). Enables the adapter's vision path. */
  projectorPath?: string | null;
  contextTokens?: number;
  /** Layers to offload. `0` (default) keeps everything on CPU. */
  gpuLayers?: number;
  /** Extra `llama-server` flags, appended verbatim. */
  extraArgs?: string[];
  /** Fixed port. Defaults to an OS-assigned free port. */
  port?: number;
  /**
   * How long to tolerate **no response** from `/health`. Default 120s.
   *
   * This is not a total budget: while llama-server reports `503 loading model`
   * the clock resets, because that is proof of progress. See `waitForHealth`.
   */
  healthTimeoutMs?: number;
  /** Hard ceiling on the whole load, however much progress is reported. Default 15min. */
  loadTimeoutMs?: number;
  /** Called with every stdout/stderr line the server prints. */
  onLog?: (line: string) => void;
  /** Forwarded to the adapter. `stream`, `defaultMaxTokens`, `apiKey`, … */
  runtime?: Omit<LlamaServerRuntimeOptions, 'baseUrl' | 'supportsVision' | 'acceleration'>;
}

export interface LlamaServerHandle {
  runtime: ActivationRuntime;
  baseUrl: string;
  /** Startup lines llama-server printed — device/backend detection lives here. */
  logs: string[];
  close(): Promise<void>;
}

/**
 * Look for a vendored llama-server the way `fetch-llama-cpp.js` lays it out
 * (`vendor/llama-cpp/<slug>/llama-server[.exe]`), starting at each `startDir`
 * and walking up. `MACHINE_LLAMA_SERVER` wins when set.
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
  const roots = ['vendor', '.'];

  const dirs = startDirs.length > 0 ? startDirs : [process.cwd()];
  for (const startDir of dirs) {
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

/** Read the build + acceleration recorded by `fetch-llama-cpp.js`, if present. */
export function readVendoredAcceleration(serverBinary: string): {
  build?: string;
  acceleration: ActivationAccelerationMode;
} {
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
        raw.acceleration === 'gpu' || raw.acceleration === 'npu' ? raw.acceleration : 'cpu';
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

/**
 * Wait for llama-server to finish loading the model.
 *
 * The timeout is a **silence** budget, not a total one. While llama-server is
 * still loading it answers `/health` with 503 and `status: "loading model"`, and
 * that is positive evidence the process is alive and working — so observing it
 * refreshes the deadline. Only genuine silence (connection refused, or a stuck
 * server that stops answering) counts down.
 *
 * The distinction is not academic. A 3.9 GB model on a machine with ~1.4 GB free
 * pages its weights in from disk and can take well past two minutes; the fixed
 * 120 s deadline aborted a load that was progressing normally and reported it as
 * a failure. `absoluteTimeoutMs` still bounds the whole wait, so a server that
 * reports "loading" forever cannot hang the caller.
 */
async function waitForHealth(
  baseUrl: string,
  timeoutMs: number,
  absoluteTimeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  let deadline = startedAt + timeoutMs;
  let lastError: unknown;
  let sawLoading = false;

  while (Date.now() < deadline) {
    if (Date.now() - startedAt > absoluteTimeoutMs) {
      throw new Error(
        `llama-server was still loading after ${Math.round(absoluteTimeoutMs / 1000)}s. ` +
          'Either the model is far too large for this machine, or the load is stuck.',
      );
    }

    try {
      const res = await fetch(`${baseUrl}/health`);
      const body = res.ok || res.status === 503 ? await res.json().catch(() => ({})) : {};
      const status = (body as { status?: string }).status;

      if (res.ok && status === 'ok') return;

      if (res.status === 503) {
        // Still loading — reset the silence budget.
        sawLoading = true;
        deadline = Date.now() + timeoutMs;
      }
      lastError = new Error(`/health returned ${res.status}${status ? ` (${status})` : ''}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  throw new Error(
    `llama-server did not become healthy (${elapsed}s elapsed, ` +
      `${Math.round(timeoutMs / 1000)}s without a response). ` +
      (sawLoading
        ? 'It was loading the model but then stopped responding. '
        : 'It never answered /health. ') +
      `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/**
 * Spawn `llama-server` on a free port, wait for it to load the model, and return
 * an `ActivationRuntime` pointed at it.
 *
 * The caller owns the process: call `close()` when done.
 */
export async function startLlamaServer(
  options: StartLlamaServerOptions,
): Promise<LlamaServerHandle> {
  const port = options.port ?? (await pickFreePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs: string[] = [];
  const contextTokens = options.contextTokens ?? 4096;

  const args = [
    '--model', options.modelPath,
    '--port', String(port),
    '--host', '127.0.0.1',
    '--ctx-size', String(contextTokens),
    '--no-webui',
    '--jinja',
  ];
  if (options.projectorPath) args.push('--mmproj', options.projectorPath);
  if (options.gpuLayers && options.gpuLayers > 0) {
    args.push('--n-gpu-layers', String(options.gpuLayers));
  }
  if (options.extraArgs?.length) args.push(...options.extraArgs);

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
    // A bad binary path surfaces as an 'error' event (ENOENT), not a throw from
    // spawn(). Without this the rejection escapes as an uncaught exception and
    // the caller never gets to report anything useful.
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
  // after a successful start cannot surface as an unhandled rejection.
  exited.catch(() => undefined);

  try {
    await Promise.race([
      waitForHealth(
        baseUrl,
        options.healthTimeoutMs ?? 120_000,
        options.loadTimeoutMs ?? 900_000,
      ),
      exited,
    ]);
  } catch (error) {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
    throw error;
  }

  const vendored = readVendoredAcceleration(options.serverBinary);
  // Report GPU only when layers were actually offloaded. A CUDA build running
  // with --n-gpu-layers 0 is a CPU session, and the contract should say so.
  const acceleration: ActivationAccelerationMode =
    options.gpuLayers && options.gpuLayers > 0 ? vendored.acceleration : 'cpu';

  const runtime = llamaServerRuntime({
    ...options.runtime,
    baseUrl,
    contextTokens: options.runtime?.contextTokens ?? contextTokens,
    acceleration,
    supportsVision: Boolean(options.projectorPath),
    backendVersion: options.runtime?.backendVersion ?? vendored.build,
    onLog: options.runtime?.onLog ?? options.onLog,
  });

  return {
    runtime,
    baseUrl,
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

// ---------------------------------------------------------------------------
// Reuse
// ---------------------------------------------------------------------------

interface PooledServer {
  key: string;
  promise: Promise<LlamaServerHandle>;
}

let pooled: PooledServer | null = null;

function poolKey(options: StartLlamaServerOptions): string {
  return JSON.stringify([
    options.serverBinary,
    options.modelPath,
    options.projectorPath ?? null,
    options.contextTokens ?? 4096,
    options.gpuLayers ?? 0,
    options.extraArgs ?? [],
  ]);
}

/**
 * Like `startLlamaServer`, but keeps one server alive per configuration and
 * hands the same handle back on repeated calls.
 *
 * This is what a long-lived host process wants. Loading a multi-gigabyte GGUF
 * takes seconds and holds that memory for the life of the process, so a
 * framework that re-evaluates a module per request — a Next.js dev server, an
 * Inngest worker, an Electron main process reloading — must not spawn a second
 * copy. Changing the model or the flags swaps the pool: the previous server is
 * shut down before the new one starts, because two loaded models rarely fit in
 * RAM at once.
 */
export async function ensureLlamaServer(
  options: StartLlamaServerOptions,
): Promise<LlamaServerHandle> {
  const key = poolKey(options);
  if (pooled?.key === key) {
    try {
      return await pooled.promise;
    } catch {
      // A failed start must not poison the pool forever.
      pooled = null;
    }
  }

  const previous = pooled;
  const entry: PooledServer = {
    key,
    promise: (async () => {
      if (previous) {
        try {
          await (await previous.promise).close();
        } catch {
          /* nothing to close */
        }
      }
      return startLlamaServer(options);
    })(),
  };
  pooled = entry;
  entry.promise.catch(() => undefined);
  return entry.promise;
}

/** Shut down the pooled server, if any. Call on process teardown. */
export async function closePooledLlamaServer(): Promise<void> {
  const entry = pooled;
  pooled = null;
  if (!entry) return;
  try {
    await (await entry.promise).close();
  } catch {
    /* never started */
  }
}
