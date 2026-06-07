import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join as pathJoin, resolve as pathResolve } from 'node:path';

import { CARTRIDGE_SCHEMA_VERSION } from '../../cartridge';
import type { CartridgeManifest } from '../../cartridge';
import { getBoolFlag, parseArgs } from '../args';
import { dim, errorln, green, println, red, yellow } from '../output';

const HELP = `\
machine init <dir> [--force]

Scaffold a new cartridge directory with a placeholder manifest and a weights/
folder. After init, drop your model file into weights/ and run \`machine pack\`.

Flags:
  --force    Overwrite an existing manifest.json.
  --help     Show this message.
`;

export async function runInit(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const target = args.positionals[0];
  if (!target) {
    errorln(red('init: missing target directory'));
    errorln(HELP);
    return 2;
  }

  const force = getBoolFlag(args, 'force', false);
  const dir = pathResolve(target);
  const manifestPath = pathJoin(dir, 'manifest.json');

  if (existsSync(manifestPath) && !force) {
    errorln(red(`init: manifest already exists at ${manifestPath} (use --force to overwrite)`));
    return 1;
  }

  mkdirSync(pathJoin(dir, 'weights'), { recursive: true });

  const manifest: CartridgeManifest = {
    schemaVersion: CARTRIDGE_SCHEMA_VERSION,
    id: 'com.example.my-cartridge',
    name: 'My Cartridge',
    version: '0.1.0',
    description: 'A new cartridge — edit this manifest before publishing.',
    weights: {
      format: 'gguf',
      path: 'weights/model.gguf',
      sizeBytes: 1,
      sha256: '0'.repeat(64),
    },
    capabilities: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindowTokens: 4096,
      supportsTextCompletion: true,
      supportsTextChat: true,
      supportsStreaming: true,
      structuredJsonOutput: false,
      toolCalling: false,
    },
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  println(green(`Created cartridge skeleton at ${dir}`));
  println(dim(`  manifest.json   ← edit id, name, version, description`));
  println(dim(`  weights/        ← drop your model file here (default: model.gguf)`));
  println('');
  println(yellow('Next: place your weights file, then run `machine pack ' + target + '`.'));
  return 0;
}
