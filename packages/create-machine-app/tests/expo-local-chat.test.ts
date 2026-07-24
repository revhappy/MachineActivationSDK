import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assert, assertEqual, test } from './_harness';
import { runCli, withTempDir } from './_run';

test('expo-local-chat: scaffolds the full Expo tree', () => {
  withTempDir((tmp) => {
    const result = runCli(['expo-app', '-t', 'expo-local-chat', '-y'], {
      cwd: tmp,
    });
    assertEqual(result.exitCode, 0, `stderr: ${result.stderr}`);

    const appDir = join(tmp, 'expo-app');
    for (const rel of [
      'package.json',
      'tsconfig.json',
      'app.json',
      'babel.config.js',
      'metro.config.js',
      'README.md',
      '.gitignore',
      'index.ts',
      'src/App.tsx',
      'src/ChatScreen.tsx',
      'src/llamaRuntime.ts',
    ]) {
      assert(existsSync(join(appDir, rel)), `missing: ${rel}`);
    }
  });
});

test('expo-local-chat: substitutes APP_NAME into package.json + app.json', () => {
  withTempDir((tmp) => {
    const result = runCli(['my-expo', '-t', 'expo-local-chat', '-y'], {
      cwd: tmp,
    });
    assertEqual(result.exitCode, 0);

    const appDir = join(tmp, 'my-expo');
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    assertEqual(pkg.name, 'my-expo');
    assert(pkg.dependencies?.expo !== undefined, 'expo dep present');
    assert(pkg.dependencies?.['llama.rn'] !== undefined, 'llama.rn dep present');
    assert(pkg.dependencies?.['machineai-activation-ui'] !== undefined, 'machineai-activation-ui dep present');

    const appJson = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8'));
    assertEqual(appJson.expo.name, 'my-expo');
    assertEqual(appJson.expo.slug, 'my-expo');
  });
});

test('expo-local-chat: App.tsx wires MachineProvider + llamaRuntime', () => {
  withTempDir((tmp) => {
    runCli(['a', '-t', 'expo-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'a', 'src', 'App.tsx'), 'utf8');
    assert(source.includes('MachineProvider'), 'App should use MachineProvider');
    assert(source.includes('llamaRuntime'), 'App should use llamaRuntime');
    assert(source.includes('createMachine'), 'App should call createMachine');
  });
});

test('expo-local-chat: llamaRuntime matches the ActivationSession contract', () => {
  withTempDir((tmp) => {
    runCli(['rt', '-t', 'expo-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'rt', 'src', 'llamaRuntime.ts'), 'utf8');

    // See the rn-cli twin of this test: the prior implementation destructured
    // the first argument as an object, so every SDK call passed a string where
    // an object was expected. Templates aren't typechecked, so nothing caught it.
    assert(
      !source.includes('async ({ prompt,'),
      'complete does not destructure its first argument',
    );
    assert(
      !source.includes('async ({ messages,'),
      'completeChat does not destructure its first argument',
    );
    assert(source.includes('complete: (prompt, options)'), 'complete takes (prompt, options)');
    assert(
      source.includes('completeChat: (messages, options)'),
      'completeChat takes (messages, options)',
    );
    assert(!source.includes('stream?.onToken'), 'does not use the non-existent `stream` option');
  });
});

test('expo-local-chat: llamaRuntime enables GPU offload and forwards grammar', () => {
  withTempDir((tmp) => {
    runCli(['gpu', '-t', 'expo-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'gpu', 'src', 'llamaRuntime.ts'), 'utf8');

    assert(!source.includes('n_gpu_layers: 0'), 'does not pin inference to the CPU');
    assert(source.includes('REQUESTED_GPU_LAYERS'), 'requests GPU layer offload');
    assert(source.includes('context.gpu'), 'reports observed GPU state, not an assumption');
    assert(
      source.includes('resolveStructuredOutputGrammar'),
      'resolves grammar via the SDK helper',
    );
    assert(source.includes('structuredJsonOutput: true'), 'advertises structured output honestly');
    assert(source.includes('opts.onChunk?.('), 'emits onChunk so streamText streams');
    assert(source.includes('opts.onToken?.('), 'emits onToken as well');
  });
});

test('expo-local-chat: ChatScreen uses machineai-activation-ui/native hooks', () => {
  withTempDir((tmp) => {
    runCli(['b', '-t', 'expo-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'b', 'src', 'ChatScreen.tsx'), 'utf8');
    assert(source.includes('machineai-activation-ui/native'), 'should import from machineai-activation-ui/native');
    assert(source.includes('useInference'), 'should use useInference');
    assert(source.includes('useMachineModel'), 'should use useMachineModel');
    assert(source.includes('InferenceIndicator'), 'should render InferenceIndicator');
  });
});

test('expo-local-chat: no .tmpl suffixes in output', () => {
  withTempDir((tmp) => {
    runCli(['clean', '-t', 'expo-local-chat', '-y'], { cwd: tmp });
    const appDir = join(tmp, 'clean');
    for (const rel of ['package.json.tmpl', 'app.json.tmpl', 'README.md.tmpl']) {
      assert(!existsSync(join(appDir, rel)), `.tmpl leaked: ${rel}`);
    }
  });
});
