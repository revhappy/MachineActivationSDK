import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin, resolve as pathResolve } from 'node:path';

import { validateCartridge } from '../../cartridge';
import type { CartridgeValidationResult } from '../../cartridge';
import { createNodeCartridgeFileSystem } from '../../cartridge/nodeFs';
import { createNodeCartridgeZipAdapter } from '../../cartridge/nodeZip';
import { unpackCartridge } from '../../cartridge/nodeUnpackCartridge';
import { getBoolFlag, parseArgs } from '../args';
import { errorln, green, printJson, println, red } from '../output';

const HELP = `\
machine validate <file|dir> [--json]

Validate a cartridge: schema + sha256 + size verification. Accepts an extracted
directory OR a .mcart zip (which is unpacked into a temp directory first).

Exit code 0 if valid, 1 if invalid.

Flags:
  --json    Emit a machine-readable JSON report instead of human text.
  --help    Show this message.
`;

export async function runValidate(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const target = args.positionals[0];
  if (!target) {
    errorln(red('validate: missing input path'));
    errorln(HELP);
    return 2;
  }
  const json = getBoolFlag(args, 'json', false);
  const inputPath = pathResolve(target);

  let workingDir = inputPath;
  let tempDir: string | undefined;

  try {
    if (isFile(inputPath)) {
      tempDir = mkdtempSync(pathJoin(tmpdir(), 'mcart-validate-'));
      await unpackCartridge(inputPath, tempDir, {
        zip: createNodeCartridgeZipAdapter(),
        verify: false,
      });
      workingDir = tempDir;
    }

    const result: CartridgeValidationResult = await validateCartridge(workingDir, {
      fs: createNodeCartridgeFileSystem(),
    });

    if (json) {
      printJson({
        valid: result.valid,
        issues: result.issues,
        manifest: result.cartridge?.manifest ?? null,
      });
    } else if (result.valid) {
      const m = result.cartridge.manifest;
      println(green(`✓ valid — ${m.id} v${m.version} (${m.weights.format})`));
    } else {
      println(red('✗ invalid'));
      for (const issue of result.issues) {
        println(red(`  ${issue.path || '<root>'}: ${issue.message}`));
      }
    }
    return result.valid ? 0 : 1;
  } catch (error) {
    errorln(red(`validate: ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
