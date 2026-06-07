import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assert, assertEqual, test } from './_harness';
import { runCli, withTempDir } from './_run';

test('next-local-chat: scaffolds the full Next.js tree', () => {
  withTempDir((tmp) => {
    const result = runCli(['next-app', '-t', 'next-local-chat', '-y'], {
      cwd: tmp,
    });
    assertEqual(result.exitCode, 0, `stderr: ${result.stderr}`);

    const appDir = join(tmp, 'next-app');
    for (const rel of [
      'package.json',
      'tsconfig.json',
      'next.config.js',
      'next-env.d.ts',
      'README.md',
      '.gitignore',
      'src/app/layout.tsx',
      'src/app/page.tsx',
      'src/app/ChatScreen.tsx',
      'src/lib/webLlmRuntime.ts',
    ]) {
      assert(existsSync(join(appDir, rel)), `missing: ${rel}`);
    }
  });
});

test('next-local-chat: substitutes APP_NAME into package.json', () => {
  withTempDir((tmp) => {
    const result = runCli(['my-next', '-t', 'next-local-chat', '-y'], {
      cwd: tmp,
    });
    assertEqual(result.exitCode, 0);

    const appDir = join(tmp, 'my-next');
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    assertEqual(pkg.name, 'my-next');
    assert(pkg.dependencies?.next !== undefined, 'next dep present');
    assert(pkg.dependencies?.['@mlc-ai/web-llm'] !== undefined, '@mlc-ai/web-llm dep present');
    assert(pkg.dependencies?.['@machine/ui'] !== undefined, '@machine/ui dep present');
  });
});

test('next-local-chat: webLlmRuntime imports @mlc-ai/web-llm', () => {
  withTempDir((tmp) => {
    runCli(['a', '-t', 'next-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(
      join(tmp, 'a', 'src', 'lib', 'webLlmRuntime.ts'),
      'utf8',
    );
    assert(source.includes("from '@mlc-ai/web-llm'"), 'webLlmRuntime imports @mlc-ai/web-llm');
    assert(source.includes('CreateMLCEngine'), 'uses CreateMLCEngine');
    assert(source.includes('ActivationRuntime'), 'exports an ActivationRuntime');
    assert(source.includes('webLlmRuntime'), 'named webLlmRuntime');
  });
});

test('next-local-chat: page.tsx wires MachineProvider + webLlmRuntime', () => {
  withTempDir((tmp) => {
    runCli(['b', '-t', 'next-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'b', 'src', 'app', 'page.tsx'), 'utf8');
    assert(source.includes("'use client'"), 'page.tsx is a client component');
    assert(source.includes('MachineProvider'), 'page.tsx uses MachineProvider');
    assert(source.includes('webLlmRuntime'), 'page.tsx imports webLlmRuntime');
    assert(source.includes('createMachine'), 'page.tsx calls createMachine');
  });
});

test('next-local-chat: ChatScreen uses @machine/ui/web hooks', () => {
  withTempDir((tmp) => {
    runCli(['c', '-t', 'next-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(
      join(tmp, 'c', 'src', 'app', 'ChatScreen.tsx'),
      'utf8',
    );
    assert(source.includes('@machine/ui/web'), 'should import from @machine/ui/web');
    assert(source.includes('useInference'), 'should use useInference');
    assert(source.includes('useMachineModel'), 'should use useMachineModel');
    assert(source.includes('InferenceIndicator'), 'should render InferenceIndicator');
  });
});

test('next-local-chat: next.config.js transpiles @machine/* workspaces', () => {
  withTempDir((tmp) => {
    runCli(['d', '-t', 'next-local-chat', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'd', 'next.config.js'), 'utf8');
    assert(source.includes('transpilePackages'), 'next.config.js sets transpilePackages');
    assert(source.includes('@machine/activation-sdk'), 'transpiles @machine/activation-sdk');
    assert(source.includes('@machine/ui'), 'transpiles @machine/ui');
  });
});

test('next-local-chat: no .tmpl suffixes in output', () => {
  withTempDir((tmp) => {
    runCli(['clean', '-t', 'next-local-chat', '-y'], { cwd: tmp });
    const appDir = join(tmp, 'clean');
    for (const rel of ['package.json.tmpl', 'README.md.tmpl']) {
      assert(!existsSync(join(appDir, rel)), `.tmpl leaked: ${rel}`);
    }
  });
});
