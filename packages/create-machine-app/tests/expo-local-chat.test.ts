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
    assert(pkg.dependencies?.['@machine/ui'] !== undefined, '@machine/ui dep present');

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

test('expo-local-chat: ChatScreen uses @machine/ui/native hooks', () => {
  withTempDir((tmp) => {
    runCli(['b', '-t', 'expo-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'b', 'src', 'ChatScreen.tsx'), 'utf8');
    assert(source.includes('@machine/ui/native'), 'should import from @machine/ui/native');
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
