import { readFileSync } from 'node:fs';
import { join as pathJoin, resolve as pathResolve } from 'node:path';

import { parseCartridgeManifest } from '../../cartridge';
import { createNodeCartridgeZipAdapter } from '../../cartridge/nodeZip';
import { packCartridge } from '../../cartridge/nodePackCartridge';
import { getBoolFlag, getStringFlag, parseArgs } from '../args';
import { dim, errorln, formatBytes, green, println, red } from '../output';

const HELP = `\
machine pack <dir> [--out <file>] [--no-rehash]

Pack a cartridge directory into a .mcart archive. By default the weights file
is rehashed and its size measured, and those values are written into the
manifest copy embedded in the archive.

Flags:
  --out <file>   Output path. Default: <id>-<version>.mcart in cwd.
  --no-rehash    Trust the manifest's declared sha256/sizeBytes as-is.
  --help         Show this message.
`;

export async function runPack(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const target = args.positionals[0];
  if (!target) {
    errorln(red('pack: missing source directory'));
    errorln(HELP);
    return 2;
  }

  const rehash = getBoolFlag(args, 'rehash', true);
  const outFlag = getStringFlag(args, 'out');
  const sourceDir = pathResolve(target);

  try {
    const outputPath = outFlag
      ? pathResolve(outFlag)
      : pathResolve(defaultOutputName(sourceDir));

    const result = await packCartridge(sourceDir, outputPath, {
      zip: createNodeCartridgeZipAdapter(),
      rehash,
    });

    println(green(`Packed ${result.entries.length} files → ${result.outputPath}`));
    println(
      dim(
        `  weights: ${result.manifest.weights.path} (${formatBytes(result.weightsSizeBytes)}, sha256 ${result.weightsSha256.slice(0, 12)}…)`,
      ),
    );
    return 0;
  } catch (error) {
    errorln(red(`pack: ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  }
}

function defaultOutputName(sourceDir: string): string {
  const manifestPath = pathJoin(sourceDir, 'manifest.json');
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const parsed = parseCartridgeManifest(raw);
  if (!parsed.valid) {
    throw new Error('Cannot derive default output name: manifest is invalid (run `machine validate` for details)');
  }
  return `${parsed.manifest.id}-${parsed.manifest.version}.mcart`;
}
