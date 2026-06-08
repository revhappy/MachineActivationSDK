import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assert, assertEqual, test } from './_harness';
import { runCli, withTempDir } from './_run';

test('node-script: scaffolds into an empty dir with --yes', () => {
  withTempDir((tmp) => {
    const result = runCli(['my-app', '-t', 'node-script', '-y'], { cwd: tmp });
    assertEqual(result.exitCode, 0, `stderr: ${result.stderr}`);

    const appDir = join(tmp, 'my-app');
    assert(existsSync(appDir), 'app dir should exist');
    assert(existsSync(join(appDir, 'package.json')), 'package.json should exist');
    assert(existsSync(join(appDir, 'tsconfig.json')), 'tsconfig.json should exist');
    assert(existsSync(join(appDir, 'README.md')), 'README.md should exist');
    assert(existsSync(join(appDir, '.gitignore')), '.gitignore should exist');
    assert(existsSync(join(appDir, 'src', 'index.ts')), 'src/index.ts should exist');

    // No .tmpl files should leak through.
    assert(
      !existsSync(join(appDir, 'package.json.tmpl')),
      '.tmpl suffix must be stripped',
    );
    assert(
      !existsSync(join(appDir, 'README.md.tmpl')),
      '.tmpl suffix must be stripped',
    );
  });
});

test('node-script: substitutes APP_NAME into package.json', () => {
  withTempDir((tmp) => {
    const result = runCli(['demo-pkg', '-t', 'node-script', '-y'], { cwd: tmp });
    assertEqual(result.exitCode, 0);

    const pkgPath = join(tmp, 'demo-pkg', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assertEqual(pkg.name, 'demo-pkg');
    assert(
      typeof pkg.dependencies?.['@revhappy/activation-sdk'] === 'string',
      'activation-sdk dep should be present',
    );
  });
});

test('node-script: substitutes PACKAGE_MANAGER into README', () => {
  withTempDir((tmp) => {
    const result = runCli(['x', '-t', 'node-script', '--pm', 'pnpm', '-y'], {
      cwd: tmp,
    });
    assertEqual(result.exitCode, 0);

    const readme = readFileSync(join(tmp, 'x', 'README.md'), 'utf8');
    assert(readme.includes('pnpm install'), 'README should reference pnpm');
    assert(!readme.includes('{{PACKAGE_MANAGER}}'), 'placeholder must be substituted');
    assert(!readme.includes('{{APP_NAME}}'), 'placeholder must be substituted');
  });
});

test('node-script: src/index.ts imports core SDK entry points', () => {
  withTempDir((tmp) => {
    runCli(['app1', '-t', 'node-script', '-y'], { cwd: tmp });
    const source = readFileSync(join(tmp, 'app1', 'src', 'index.ts'), 'utf8');
    assert(source.includes('createMachine'), 'should import createMachine');
    assert(source.includes('generateText'), 'should use generateText');
    assert(
      source.includes('createNodeCartridgeResolver'),
      'should wire up the Node cartridge resolver',
    );
  });
});

test('rejects unknown template id with exit 2', () => {
  withTempDir((tmp) => {
    const result = runCli(['x', '-t', 'does-not-exist', '-y'], { cwd: tmp });
    assertEqual(result.exitCode, 2);
    assert(
      result.stderr.includes('unknown template'),
      'stderr should explain the failure',
    );
  });
});

test('rejects non-empty target without --force', () => {
  withTempDir((tmp) => {
    const first = runCli(['same', '-t', 'node-script', '-y'], { cwd: tmp });
    assertEqual(first.exitCode, 0);

    const again = runCli(['same', '-t', 'node-script', '-y'], { cwd: tmp });
    assertEqual(again.exitCode, 1);
    assert(
      again.stderr.includes('not empty'),
      'stderr should explain the conflict',
    );
  });
});

test('--force overwrites a non-empty target', () => {
  withTempDir((tmp) => {
    const first = runCli(['over', '-t', 'node-script', '-y'], { cwd: tmp });
    assertEqual(first.exitCode, 0);

    const forced = runCli(['over', '-t', 'node-script', '-y', '--force'], {
      cwd: tmp,
    });
    assertEqual(forced.exitCode, 0, `stderr: ${forced.stderr}`);
  });
});
