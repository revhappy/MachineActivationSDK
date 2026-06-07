import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI_PATH = resolve(__dirname, '..', '..', 'src', 'bin', 'machine.js');
//                              .test-dist/tests/cli/_run.js → .test-dist/src/bin/machine.js
//                              (tsconfig.tests.json uses rootDir: ".", which preserves
//                              "src/" in the output path; the production build at dist/
//                              has rootDir: "src", which strips it.)

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
}

export function runCli(args: readonly string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    cwd: options.cwd,
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Async variant of {@link runCli}. Required for tests that need an in-process
 * HTTP server (e.g. catalog fixture) to handle the CLI subprocess's fetch
 * while it runs — `runCli`'s `spawnSync` blocks the parent event loop for the
 * child's entire lifetime, so the server never gets to respond.
 */
export function runCliAsync(
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: options.cwd,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (err) => rejectPromise(err));
    child.once('close', (code) => {
      resolvePromise({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

export function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mcart-cli-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function withTempDirAsync<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mcart-cli-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
