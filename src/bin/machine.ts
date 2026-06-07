#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join as pathJoin } from 'node:path';

import { parseArgs } from './args';
import { errorln, println, red } from './output';
import { runDescribe } from './commands/describe';
import { runInfo } from './commands/info';
import { runInit } from './commands/init';
import { runInspect } from './commands/inspect';
import { runList } from './commands/list';
import { runPack } from './commands/pack';
import { runPull } from './commands/pull';
import { runSearch } from './commands/search';
import { runUnpack } from './commands/unpack';
import { runValidate } from './commands/validate';

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  init: runInit,
  pack: runPack,
  unpack: runUnpack,
  validate: runValidate,
  info: runInfo,
  inspect: runInspect,
  pull: runPull,
  search: runSearch,
  list: runList,
  describe: runDescribe,
};

const HELP = `\
machine — cartridge tooling for the Machine Activation SDK

Usage:
  machine <command> [args] [--flags]

Commands:
  init <dir>                     Scaffold a new cartridge directory.
  pack <dir> [--out <file>]      Build a .mcart from an extracted cartridge.
  unpack <file> [--out <dir>]    Extract a .mcart into a directory.
  validate <file|dir>            Schema + sha256 + size verification.
  info <file|dir>                Print a human-readable summary.
  inspect <file|dir> [--json]    Dump full manifest + file listing + sha256.
  pull <id>[@<version>]          Download and cache a cartridge from a catalog.
  search <query>                 Search a catalog for cartridges.
  list                           List cartridges in the local cache.
  describe [section]             Emit a JSON snapshot of the SDK surface (agent-readable).

Global flags:
  --help, -h                     Show this message.
  --version, -v                  Print SDK version.

Run \`machine <command> --help\` for command-specific options.
`;

main().catch((error) => {
  errorln(red(`machine: ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
});

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    println(HELP);
    return;
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    println(readSdkVersion());
    return;
  }

  const [name, ...rest] = argv;
  const command = COMMANDS[name];
  if (!command) {
    errorln(red(`Unknown command: ${name}`));
    errorln('');
    errorln(HELP);
    process.exit(2);
  }

  if (rest[0] === '--help' || rest[0] === '-h') {
    // Each command exports its own help via parseArgs + a simple --help check.
    // Defer to the command itself so help text lives next to the implementation.
  }

  const code = await command(rest);
  process.exit(code);
}

function readSdkVersion(): string {
  try {
    // dist/bin/machine.js → ../../package.json
    const pkgPath = pathJoin(dirname(__filename), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// Expose parsed argv for unit tests if needed (no current consumers).
export { parseArgs };
