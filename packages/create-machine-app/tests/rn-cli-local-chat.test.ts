import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assert, assertEqual, test } from './_harness';
import { runCli, withTempDir } from './_run';

test('rn-cli-local-chat: scaffolds the full bare-RN tree', () => {
  withTempDir((tmp) => {
    const result = runCli(['rn-app', '-t', 'rn-cli-local-chat', '-y'], {
      cwd: tmp,
    });
    assertEqual(result.exitCode, 0, `stderr: ${result.stderr}`);

    const appDir = join(tmp, 'rn-app');
    for (const rel of [
      'package.json',
      'tsconfig.json',
      'app.json',
      'babel.config.js',
      'metro.config.js',
      'README.md',
      '.gitignore',
      'index.js',
      'src/App.tsx',
      'src/ChatScreen.tsx',
      'src/llamaRuntime.ts',
    ]) {
      assert(existsSync(join(appDir, rel)), `missing: ${rel}`);
    }
  });
});

test('rn-cli-local-chat: substitutes APP_NAME into package.json + app.json', () => {
  withTempDir((tmp) => {
    const result = runCli(['my-rn', '-t', 'rn-cli-local-chat', '-y'], {
      cwd: tmp,
    });
    assertEqual(result.exitCode, 0);

    const appDir = join(tmp, 'my-rn');
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    assertEqual(pkg.name, 'my-rn');
    assert(pkg.dependencies?.['react-native'] !== undefined, 'react-native dep present');
    assert(pkg.dependencies?.['llama.rn'] !== undefined, 'llama.rn dep present');
    assert(pkg.dependencies?.['machineai-activation-ui'] !== undefined, 'machineai-activation-ui dep present');
    assert(
      pkg.devDependencies?.['@react-native/metro-config'] !== undefined,
      '@react-native/metro-config devDep present',
    );

    const appJson = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8'));
    assertEqual(appJson.name, 'my-rn');
    assertEqual(appJson.displayName, 'my-rn');
  });
});

test('rn-cli-local-chat: App.tsx wires MachineProvider + llamaRuntime', () => {
  withTempDir((tmp) => {
    runCli(['a', '-t', 'rn-cli-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'a', 'src', 'App.tsx'), 'utf8');
    assert(source.includes('MachineProvider'), 'App should use MachineProvider');
    assert(source.includes('llamaRuntime'), 'App should use llamaRuntime');
    assert(source.includes('createMachine'), 'App should call createMachine');
  });
});

test('rn-cli-local-chat: ChatScreen uses machineai-activation-ui/native hooks', () => {
  withTempDir((tmp) => {
    runCli(['b', '-t', 'rn-cli-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'b', 'src', 'ChatScreen.tsx'), 'utf8');
    assert(source.includes('machineai-activation-ui/native'), 'should import from machineai-activation-ui/native');
    assert(source.includes('useInference'), 'should use useInference');
    assert(source.includes('useMachineModel'), 'should use useMachineModel');
    assert(source.includes('InferenceIndicator'), 'should render InferenceIndicator');
  });
});

test('rn-cli-local-chat: index.js registers the component via AppRegistry', () => {
  withTempDir((tmp) => {
    runCli(['c', '-t', 'rn-cli-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'c', 'index.js'), 'utf8');
    assert(source.includes('AppRegistry'), 'index.js should use AppRegistry');
    assert(source.includes('registerComponent'), 'index.js should call registerComponent');
  });
});

test('rn-cli-local-chat: no .tmpl suffixes in output', () => {
  withTempDir((tmp) => {
    runCli(['clean', '-t', 'rn-cli-local-chat', '-y'], { cwd: tmp });
    const appDir = join(tmp, 'clean');
    for (const rel of [
      'package.json.tmpl',
      'app.json.tmpl',
      'index.js.tmpl',
      'README.md.tmpl',
    ]) {
      assert(!existsSync(join(appDir, rel)), `.tmpl leaked: ${rel}`);
    }
  });
});
