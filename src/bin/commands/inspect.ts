import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin, relative as pathRelative, resolve as pathResolve } from 'node:path';

import { validateCartridge } from '../../cartridge';
import type { CartridgeValidationResult } from '../../cartridge';
import { createNodeCartridgeFileSystem } from '../../cartridge/nodeFs';
import { createNodeCartridgeZipAdapter } from '../../cartridge/nodeZip';
import { unpackCartridge } from '../../cartridge/nodeUnpackCartridge';
import { getBoolFlag, parseArgs } from '../args';
import { bold, dim, errorln, formatBytes, green, printJson, println, red } from '../output';

const HELP = `\
machine inspect <file|dir> [--json]

Full dump of a cartridge: manifest JSON + file listing with sizes + sha256
verification of weights. Useful for debugging.

Flags:
  --json    Emit JSON instead of human text.
  --help    Show this message.
`;

interface FileEntry {
  path: string;
  sizeBytes: number;
}

export async function runInspect(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const target = args.positionals[0];
  if (!target) {
    errorln(red('inspect: missing input path'));
    errorln(HELP);
    return 2;
  }
  const json = getBoolFlag(args, 'json', false);
  const inputPath = pathResolve(target);

  let workingDir = inputPath;
  let tempDir: string | undefined;

  try {
    if (isFile(inputPath)) {
      tempDir = mkdtempSync(pathJoin(tmpdir(), 'mcart-inspect-'));
      await unpackCartridge(inputPath, tempDir, {
        zip: createNodeCartridgeZipAdapter(),
        verify: false,
      });
      workingDir = tempDir;
    }

    const validation: CartridgeValidationResult = await validateCartridge(workingDir, {
      fs: createNodeCartridgeFileSystem(),
    });
    const files = listFiles(workingDir);

    const manifest = validation.cartridge?.manifest ?? null;

    if (json) {
      printJson({
        valid: validation.valid,
        issues: validation.issues,
        manifest,
        files,
      });
    } else {
      println(bold('Manifest'));
      println(JSON.stringify(manifest, null, 2));
      println('');
      println(bold('Files'));
      for (const f of files) {
        println(`  ${f.path}  ${dim(formatBytes(f.sizeBytes))}`);
      }
      println('');
      if (validation.valid) {
        println(green('✓ sha256 + size verified'));
      } else {
        println(red('✗ validation failed:'));
        for (const issue of validation.issues) {
          println(red(`  ${issue.path || '<root>'}: ${issue.message}`));
        }
      }
    }
    return validation.valid ? 0 : 1;
  } catch (error) {
    errorln(red(`inspect: ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

function listFiles(rootDir: string): FileEntry[] {
  const result: FileEntry[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = pathJoin(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        const info = statSync(abs);
        result.push({
          path: pathRelative(rootDir, abs).split(/[\\/]+/).join('/'),
          sizeBytes: info.size,
        });
      }
    }
  }
  result.sort((a, b) => a.path.localeCompare(b.path));
  return result;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
