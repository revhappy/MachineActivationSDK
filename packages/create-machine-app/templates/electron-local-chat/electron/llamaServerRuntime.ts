// llamaServerRuntime — main-process ActivationRuntime backed by the llama.cpp
// `llama-server` binary.
//
// The adapter itself ships in the SDK (`machineai-activation/node`). What lives
// here is only the part the SDK cannot know: where *this* app keeps its vendored
// binary, which differs between `electron .` and a packaged build.
//
// This file used to be ~530 lines — a full HTTP/SSE client, port allocation,
// health polling, process supervision and capability reporting, all duplicated
// from the SDK. Four copies of that code existed across this repo and the apps
// consuming it, and fixes landed in only one at a time: dropped chat history in
// one, a missing grammar in another, a wrong `complete()` signature in three at
// once. Delegating removes the copy.
//
// Why a server rather than a library binding:
//   - llama.cpp's official prebuilts track HEAD daily on GitHub Releases, so a
//     new model architecture needs `npm run fetch:llama`, not an npm release.
//   - The OpenAI-compatible HTTP surface is stable across llama.cpp versions.
//   - Subprocess isolation: a model load that crashes llama.cpp does not take
//     down the Electron main process.

import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ActivationRuntime,
  ActivationSession,
  ActivationSessionCreateInput,
} from 'machineai-activation';
import { closePooledLlamaServer, ensureLlamaServer } from 'machineai-activation/node';

const BACKEND_ID = 'llama-server';
const BACKEND_NAME = 'llama.cpp llama-server (subprocess)';

interface VendorInfo {
  build: string;
  slug: string;
  exe: string;
  acceleration: 'cpu' | 'gpu' | 'npu';
}

let vendorInfo: VendorInfo | null = null;

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

function resolveBinary(): string {
  // In dev:      <repo>/vendor/llama-cpp/<slug>/<exe>
  // In packaged: <Resources>/llama-cpp/<slug>/<exe>  (via extraResources)
  const { slug, exe } = readVendorInfo();

  const dev = path.join(app.getAppPath(), 'vendor', 'llama-cpp', slug, exe);
  if (fs.existsSync(dev)) return dev;

  const packaged = path.join(process.resourcesPath, 'llama-cpp', slug, exe);
  if (fs.existsSync(packaged)) return packaged;

  throw new Error(
    `${exe} not found at ${dev} or ${packaged}. ` +
      'Run `npm run fetch:llama` to vendor a llama.cpp release for this platform.',
  );
}

function logToFile(line: string): void {
  try {
    const logPath = path.join(app.getPath('userData'), 'main.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* best-effort */
  }
}

export const llamaServerRuntime: ActivationRuntime = {
  id: BACKEND_ID,
  name: BACKEND_NAME,
  supportedModelFormats: ['gguf'],

  createSession: async (input: ActivationSessionCreateInput): Promise<ActivationSession> => {
    const vendored = readVendorInfo();
    const serverBinary = resolveBinary();

    // `ensureLlamaServer` keeps one server per (binary, model, ctx, gpu-layers)
    // and shuts the old one down when the model changes, so switching models in
    // the UI never leaves two multi-gigabyte processes competing for RAM.
    const { runtime, baseUrl } = await ensureLlamaServer({
      serverBinary,
      modelPath: input.filePath,
      projectorPath: input.projectorPath ?? null,
      contextTokens: input.contextWindowTokens ?? 4096,
      // llama-server clamps the layer count to whatever the model actually has.
      gpuLayers: vendored.acceleration === 'gpu' ? 999 : 0,
      onLog: (line) => logToFile(`[llama-server] ${line}`),
    });

    logToFile(`llama-server (build ${vendored.build}) ready at ${baseUrl}`);
    return runtime.createSession(input);
  },
};

/** Called on app quit so the child process does not outlive the window. */
export async function disposeLlamaServer(): Promise<void> {
  await closePooledLlamaServer();
}
