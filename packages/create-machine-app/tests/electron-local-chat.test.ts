import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assert, assertEqual, test } from './_harness';
import { runCli, withTempDir } from './_run';

test('electron-local-chat: scaffolds the full multi-runtime tree', () => {
  withTempDir((tmp) => {
    const result = runCli(['electron-app', '-t', 'electron-local-chat', '-y'], {
      cwd: tmp,
    });
    assertEqual(result.exitCode, 0, `stderr: ${result.stderr}`);

    const appDir = join(tmp, 'electron-app');
    for (const rel of [
      'package.json',
      'tsconfig.json',
      'tsconfig.main.json',
      'tsconfig.renderer.json',
      'vite.config.ts',
      'README.md',
      '.gitignore',
      'electron/main.ts',
      'electron/preload.ts',
      'electron/preload-types.d.ts',
      'electron/llamaServerRuntime.ts',
      'electron/config.ts',
      'scripts/fetch-llama-cpp.js',
      'scripts/prepackage.js',
      'src/index.html',
      'src/main.tsx',
      'src/App.tsx',
      'src/ChatScreen.tsx',
      'src/SetupScreen.tsx',
      'src/ipcRuntime.ts',
      'src/lib/runtimeSelector.ts',
      'src/lib/mediaPipeRuntime.ts',
    ]) {
      assert(existsSync(join(appDir, rel)), `missing: ${rel}`);
    }
  });
});

test('electron-local-chat: substitutes APP_NAME and drops node-llama-cpp dep', () => {
  withTempDir((tmp) => {
    const result = runCli(['my-electron', '-t', 'electron-local-chat', '-y'], {
      cwd: tmp,
    });
    assertEqual(result.exitCode, 0);

    const appDir = join(tmp, 'my-electron');
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    assertEqual(pkg.name, 'my-electron');
    assert(
      pkg.dependencies?.['node-llama-cpp'] === undefined,
      'node-llama-cpp must NOT be a dep — template uses vendored llama-server instead',
    );
    assert(
      pkg.dependencies?.['@mediapipe/tasks-genai'] !== undefined,
      '@mediapipe/tasks-genai dep present (for .task runtime)',
    );
    assert(pkg.devDependencies?.electron !== undefined, 'electron devDep present');
    assert(pkg.devDependencies?.vite !== undefined, 'vite devDep present');
    assert(pkg.devDependencies?.esbuild !== undefined, 'esbuild devDep present (bundles main)');
    assert(pkg.scripts?.['fetch:llama'] !== undefined, 'fetch:llama script present');
    assert(pkg.scripts?.['bundle:main'] !== undefined, 'bundle:main script present');
    assertEqual(pkg.build?.appId, 'com.example.my-electron', 'build.appId substituted');
    assertEqual(pkg.build?.productName, 'my-electron', 'build.productName substituted');

    const html = readFileSync(join(appDir, 'src', 'index.html'), 'utf8');
    assert(html.includes('<title>my-electron</title>'), 'index.html title substituted');
  });
});

test('electron-local-chat: llamaServerRuntime spawns llama-server and forwards GBNF', () => {
  withTempDir((tmp) => {
    runCli(['srv', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(
      join(tmp, 'srv', 'electron', 'llamaServerRuntime.ts'),
      'utf8',
    );
    assert(source.includes('llama-server.exe'), 'spawns llama-server.exe');
    assert(source.includes("from 'node:child_process'"), 'imports child_process for spawn');
    assert(source.includes('/v1/chat/completions'), 'talks OpenAI-compatible chat endpoint');
    assert(source.includes('grammar'), 'forwards grammar param to llama-server body');
    assert(source.includes('llamaServerRuntime'), 'exports llamaServerRuntime');
    assert(source.includes('disposeLlamaServer'), 'exports disposeLlamaServer for cleanup');
  });
});

test('electron-local-chat: fetch-llama-cpp downloader resolves latest GitHub release', () => {
  withTempDir((tmp) => {
    runCli(['fetch', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(
      join(tmp, 'fetch', 'scripts', 'fetch-llama-cpp.js'),
      'utf8',
    );
    assert(source.includes('ggml-org/llama.cpp'), 'targets the upstream llama.cpp repo');
    assert(source.includes('releases/latest'), 'pulls releases/latest dynamically');
    assert(source.includes('llama-server.exe'), 'verifies llama-server.exe presence');
    assert(source.includes('version.json'), 'records version metadata for the runtime to read');
  });
});

test('electron-local-chat: main.ts uses llamaServerRuntime + multi-format picker', () => {
  withTempDir((tmp) => {
    runCli(['main', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'main', 'electron', 'main.ts'), 'utf8');
    assert(source.includes('ipcMain.handle'), 'main.ts uses ipcMain.handle');
    assert(source.includes("'machine:complete'"), 'registers machine:complete handler');
    assert(source.includes('createMachine'), 'creates a Machine');
    assert(source.includes('llamaServerRuntime'), 'uses llamaServerRuntime (not node-llama-cpp)');
    assert(source.includes("'config:pickModelFile'"), 'exposes the model file picker IPC');
    assert(
      source.includes("'gguf', 'task', 'litertlm'"),
      'picker accepts all three model formats',
    );
    assert(source.includes('app-model'), 'registers the app-model:// custom protocol');
  });
});

test('electron-local-chat: main.ts forwards grammar + system prompt + sampling args', () => {
  withTempDir((tmp) => {
    runCli(['grammar', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'grammar', 'electron', 'main.ts'), 'utf8');
    assert(source.includes('args.grammar'), 'main.ts forwards args.grammar');
    assert(source.includes('args.systemPrompt'), 'main.ts forwards args.systemPrompt');
    assert(source.includes('args.temperature'), 'main.ts forwards args.temperature');
    assert(source.includes('args.stopSequences'), 'main.ts forwards args.stopSequences');
  });
});

test('electron-local-chat: ipcRuntime forwards grammar + advertises structured output', () => {
  withTempDir((tmp) => {
    runCli(['ipcgbnf', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'ipcgbnf', 'src', 'ipcRuntime.ts'), 'utf8');
    assert(source.includes('opts.grammar'), 'ipcRuntime forwards opts.grammar to main');
    assert(source.includes('opts.systemPrompt'), 'ipcRuntime forwards opts.systemPrompt');
    assert(
      source.includes('structuredJsonOutput: true'),
      'ipc capability advertises structured JSON output',
    );
  });
});

test('electron-local-chat: mediaPipeRuntime loads .task via app-model protocol', () => {
  withTempDir((tmp) => {
    runCli(['mp', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(
      join(tmp, 'mp', 'src', 'lib', 'mediaPipeRuntime.ts'),
      'utf8',
    );
    assert(
      source.includes("from '@mediapipe/tasks-genai'"),
      'imports @mediapipe/tasks-genai',
    );
    assert(source.includes('LlmInference'), 'uses LlmInference');
    assert(source.includes('FilesetResolver'), 'resolves the WASM fileset');
    assert(source.includes('app-model'), 'loads model via app-model:// URL');
    assert(
      source.includes('structuredJsonOutput: false'),
      'capability honestly reports no GBNF on this path',
    );
  });
});

test('electron-local-chat: runtimeSelector routes by file extension', () => {
  withTempDir((tmp) => {
    runCli(['sel', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(
      join(tmp, 'sel', 'src', 'lib', 'runtimeSelector.ts'),
      'utf8',
    );
    assert(source.includes('.gguf'), 'selects on .gguf');
    assert(source.includes('.task'), 'selects on .task');
    assert(source.includes('.litertlm'), 'recognizes .litertlm');
    assert(source.includes('ipcRuntime'), 'routes .gguf through ipcRuntime');
    assert(source.includes('mediaPipeRuntime'), 'routes .task through mediaPipeRuntime');
  });
});

test('electron-local-chat: vite.config copies MediaPipe WASM into renderer bundle', () => {
  withTempDir((tmp) => {
    runCli(['vite', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'vite', 'vite.config.ts'), 'utf8');
    assert(source.includes('mediapipe-wasm'), 'emits mediapipe-wasm assets');
    assert(
      source.includes('@mediapipe/tasks-genai/wasm'),
      'copies from @mediapipe/tasks-genai/wasm',
    );
  });
});

test('electron-local-chat: preload exposes window.machine and window.config', () => {
  withTempDir((tmp) => {
    runCli(['c', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'c', 'electron', 'preload.ts'), 'utf8');
    assert(source.includes('contextBridge'), 'uses contextBridge');
    assert(source.includes("exposeInMainWorld('machine'"), 'exposes window.machine');
    assert(source.includes("exposeInMainWorld('config'"), 'exposes window.config');
    assert(source.includes('pickModelFile'), 'config bridge has pickModelFile');
  });
});

test('electron-local-chat: ChatScreen uses @machine/ui hooks (root, not /web)', () => {
  withTempDir((tmp) => {
    runCli(['d', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'd', 'src', 'ChatScreen.tsx'), 'utf8');
    assert(
      source.includes("from '@machine/ui'") && !source.includes("from '@machine/ui/web'"),
      'imports from @machine/ui root (the /web subpath only has visual components, not hooks)',
    );
    assert(source.includes('useMachineModel'), 'uses useMachineModel');
    assert(source.includes('streamText'), 'uses streamText for direct streaming');
    assert(source.includes('onSwitchModel'), 'wires the model-switch button');
  });
});

test('electron-local-chat: SetupScreen calls window.config.pickModelFile', () => {
  withTempDir((tmp) => {
    runCli(['setup', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'setup', 'src', 'SetupScreen.tsx'), 'utf8');
    assert(source.includes('window.config.pickModelFile'), 'invokes the picker IPC');
    assert(source.includes('.gguf'), 'documents the .gguf path');
    assert(source.includes('.task'), 'documents the .task path');
    assert(source.includes('.litertlm'), 'mentions .litertlm');
  });
});

test('electron-local-chat: App.tsx routes by format and gates with SetupScreen', () => {
  withTempDir((tmp) => {
    runCli(['app', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'app', 'src', 'App.tsx'), 'utf8');
    assert(source.includes('SetupScreen'), 'falls through to SetupScreen when no model picked');
    assert(source.includes('selectRuntimeForModel'), 'composes runtime via the selector');
    assert(source.includes('detectModelFormat'), 'detects format for routing');
    assert(source.includes('MachineProvider'), 'wraps in MachineProvider');
  });
});

test('electron-local-chat: ipcRuntime forwards through window.machine', () => {
  withTempDir((tmp) => {
    runCli(['e', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'e', 'src', 'ipcRuntime.ts'), 'utf8');
    assert(source.includes('window.machine.complete'), 'forwards complete through window.machine');
    assert(source.includes('ActivationRuntime'), 'declares an ActivationRuntime');
    assert(source.includes('ipcRuntime'), 'exports ipcRuntime');
  });
});

test('electron-local-chat: no .tmpl suffixes in output', () => {
  withTempDir((tmp) => {
    runCli(['clean', '-t', 'electron-local-chat', '-y'], { cwd: tmp });
    const appDir = join(tmp, 'clean');
    for (const rel of ['package.json.tmpl', 'README.md.tmpl', 'src/index.html.tmpl']) {
      assert(!existsSync(join(appDir, rel)), `.tmpl leaked: ${rel}`);
    }
  });
});
