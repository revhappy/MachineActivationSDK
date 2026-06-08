// Electron main process for the {{APP_NAME}} template.
//
// Architecture (intentionally multi-runtime out of the box):
//   .gguf    → llamaServerRuntime (subprocess + HTTP/SSE)
//   .task    → mediaPipeRuntime in renderer (WASM via @mediapipe/tasks-genai)
//   .litertlm → recognized by picker; renderer shows a clear "not embeddable
//              yet" notice (Google CLI v0.11.0 ships incomplete on Windows)
//
// The user picks a model file at first launch (and can switch any time).
// Path is persisted via electron/config.ts to <userData>/config.json. Model
// files are streamed to the renderer via a custom `app-model://` protocol so
// MediaPipe can load multi-GB .task files without an IPC buffer copy.

import { app, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { llamaServerRuntime, disposeLlamaServer } from './llamaServerRuntime';
import { createMachine, type Machine } from '@revhappy/activation-sdk';
import type { MachineCompleteArgs } from './preload-types';
import { readConfig, writeConfig } from './config';

const IS_DEV = !app.isPackaged;

const APP_MODEL_SCHEME = 'app-model';
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_MODEL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

function registerAppModelProtocol(): void {
  protocol.handle(APP_MODEL_SCHEME, async (req) => {
    const url = new URL(req.url);
    let filePath = decodeURIComponent(url.pathname).replace(/^[\/\\]+/, '');
    filePath = filePath.replace(/\//g, path.sep);
    if (!fs.existsSync(filePath)) {
      return new Response(`Not found: ${filePath}`, { status: 404 });
    }
    return net.fetch('file://' + filePath.replace(/\\/g, '/'));
  });
}

let machine: Machine | null = null;
const sessionAborts = new Map<string, () => Promise<void>>();

function ensureMachine(): Machine {
  if (!machine) {
    machine = createMachine({ runtimes: llamaServerRuntime });
  }
  return machine;
}

async function createMainWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (IS_DEV) {
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

ipcMain.handle('machine:complete', async (event, args: MachineCompleteArgs) => {
  const cfg = readConfig();
  if (!cfg.modelFilePath) throw new Error('No model file configured. Pick a model file first.');
  if (!fs.existsSync(cfg.modelFilePath)) {
    throw new Error(`Configured model file no longer exists: ${cfg.modelFilePath}`);
  }
  if (!cfg.modelFilePath.toLowerCase().endsWith('.gguf')) {
    throw new Error(
      `Main-process inference only handles .gguf files. The renderer routes ` +
        `other formats to in-renderer runtimes.`,
    );
  }
  const m = ensureMachine();
  const model = m.model({ filePath: cfg.modelFilePath });
  const requestId = randomUUID();
  const controller = new AbortController();
  sessionAborts.set(requestId, async () => controller.abort());

  const session = await model.getSession();
  try {
    const result = await session.complete(args.prompt, {
      maxTokens: args.maxTokens ?? 512,
      systemPrompt: args.systemPrompt,
      grammar: args.grammar,
      temperature: args.temperature,
      topP: args.topP,
      topK: args.topK,
      stopSequences: args.stopSequences,
      responseFormat: args.responseFormat,
      onToken: (delta) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('machine:token', { requestId, delta });
        }
      },
    });
    return { requestId, text: result.text, tokensPerSecond: result.tokensPerSecond };
  } finally {
    sessionAborts.delete(requestId);
  }
});

ipcMain.handle('machine:abort', async (_event, args: { requestId: string }) => {
  const abort = sessionAborts.get(args.requestId);
  if (abort) await abort();
  return { ok: true };
});

ipcMain.handle('config:get', async () => readConfig());

ipcMain.handle('config:pickModelFile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Pick a model file (.gguf, .task, .litertlm)',
    properties: ['openFile'],
    filters: [
      { name: 'Local LLM model', extensions: ['gguf', 'task', 'litertlm'] },
      { name: 'GGUF (llama.cpp)', extensions: ['gguf'] },
      { name: 'MediaPipe LLM bundle', extensions: ['task'] },
      { name: 'LiteRT-LM model', extensions: ['litertlm'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return { filePath: null };
  const filePath = result.filePaths[0];
  writeConfig({ modelFilePath: filePath });
  return { filePath };
});

ipcMain.handle(
  'config:setModelFilePath',
  async (_event, args: { filePath: string | null }) => writeConfig({ modelFilePath: args.filePath }),
);

app.whenReady().then(() => {
  registerAppModelProtocol();
  void createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
});

app.on('window-all-closed', async () => {
  await disposeLlamaServer();
  if (machine) await machine.close();
  if (process.platform !== 'darwin') app.quit();
});
