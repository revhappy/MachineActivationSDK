import { readFile, stat } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';

import { createNodeCartridgeCache } from '../../catalog/nodeCartridgeCache';
import { parseCartridgeManifest } from '../../cartridge';
import { getBoolFlag, getStringFlag, parseArgs } from '../args';
import { bold, dim, errorln, formatBytes, printJson, println, red } from '../output';

const HELP = `\
machine list [--cache <dir>] [--json]

List cartridges in the local cache.

Flags:
  --cache <dir>   Override cache root (default: ~/.machine/cartridges).
  --json          Emit the list as JSON.
  --help          Show this message.
`;

export async function runList(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const cacheDir = getStringFlag(args, 'cache');
  const json = getBoolFlag(args, 'json', false);

  const cache = createNodeCartridgeCache(cacheDir ? { rootDir: cacheDir } : {});

  try {
    const listed = await cache.list();
    const rows = await Promise.all(listed.map((l) => describeEntry(l)));

    if (json) {
      printJson({ rootDir: cache.rootDir, entries: rows });
      return 0;
    }

    if (rows.length === 0) {
      println(dim(`No cartridges cached under ${cache.rootDir}.`));
      return 0;
    }

    println(dim(`Cache: ${cache.rootDir}`));
    for (const row of rows) {
      const header = `${row.id}@${row.version}`;
      const size = row.weightsSize !== undefined ? formatBytes(row.weightsSize) : 'size?';
      println(bold(header) + '  ' + dim(size));
      println(dim(`  → ${row.cartridgeDir}`));
    }
    return 0;
  } catch (error) {
    errorln(red(`list: ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  }
}

interface DescribedEntry {
  id: string;
  version: string;
  cartridgeDir: string;
  weightsSize?: number;
  name?: string;
}

async function describeEntry(
  listed: Awaited<ReturnType<ReturnType<typeof createNodeCartridgeCache>['list']>>[number],
): Promise<DescribedEntry> {
  const base: DescribedEntry = {
    id: listed.id,
    version: listed.version,
    cartridgeDir: listed.cartridgeDir,
  };
  try {
    const raw = JSON.parse(await readFile(listed.manifestPath, 'utf8'));
    const parsed = parseCartridgeManifest(raw);
    if (parsed.valid) {
      const weightsAbs = pathJoin(listed.cartridgeDir, parsed.manifest.weights.path);
      try {
        const info = await stat(weightsAbs);
        base.weightsSize = info.size;
      } catch {
        /* weights missing — leave undefined */
      }
      base.name = parsed.manifest.name;
    }
  } catch {
    /* malformed manifest — still list the entry */
  }
  return base;
}
