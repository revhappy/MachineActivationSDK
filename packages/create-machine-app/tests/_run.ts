import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Compiled test at .test-dist/tests/_run.js → built CLI at dist/bin/index.js.
// From .test-dist/tests/ we walk up two levels to the package root, then into dist/.
const CLI_PATH = resolve(__dirname, '..', '..', 'dist', 'bin', 'index.js');

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function runCli(args: readonly string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    cwd: options.cwd,
    env: options.env ?? { ...process.env, NO_COLOR: '1' },
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'cma-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
