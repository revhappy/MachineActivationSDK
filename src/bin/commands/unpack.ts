import { basename, dirname, extname, resolve as pathResolve } from 'node:path';

import { createNodeCartridgeZipAdapter } from '../../cartridge/nodeZip';
import { unpackCartridge } from '../../cartridge/nodeUnpackCartridge';
import { getStringFlag, parseArgs } from '../args';
import { dim, errorln, green, println, red } from '../output';

const HELP = `\
machine unpack <file> [--out <dir>]

Extract a .mcart archive into a directory. After extraction the cartridge is
loaded with \`loadCartridge\` so corrupt archives fail fast.

Flags:
  --out <dir>   Output directory. Default: <basename-without-ext>/ next to the zip.
  --help        Show this message.
`;

export async function runUnpack(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const target = args.positionals[0];
  if (!target) {
    errorln(red('unpack: missing input file'));
    errorln(HELP);
    return 2;
  }

  const zipPath = pathResolve(target);
  const outFlag = getStringFlag(args, 'out');
  const outDir = outFlag
    ? pathResolve(outFlag)
    : pathResolve(dirname(zipPath), basename(zipPath, extname(zipPath)));

  try {
    const result = await unpackCartridge(zipPath, outDir, {
      zip: createNodeCartridgeZipAdapter(),
    });
    println(green(`Unpacked → ${result.outputDir}`));
    if (result.cartridge) {
      println(dim(`  ${result.cartridge.manifest.id} v${result.cartridge.manifest.version}`));
    }
    return 0;
  } catch (error) {
    errorln(red(`unpack: ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  }
}
