import { fetchCatalog, resolveCartridgeEntry } from '../../catalog';
import { createNodeCartridgeCache } from '../../catalog/nodeCartridgeCache';
import { downloadAndUnpackCartridge } from '../../catalog/nodeDownloadCartridge';
import { getBoolFlag, getStringFlag, parseArgs } from '../args';
import { dim, errorln, formatBytes, green, println, red, yellow } from '../output';

const HELP = `\
machine pull <id>[@<version>] [--catalog <url>] [--cache <dir>] [--force]

Download and unpack a cartridge from a catalog into the local cache.

Arguments:
  <id>[@<version>]   Cartridge id, optionally pinned to a version.

Flags:
  --catalog <url>    Catalog JSON URL. Defaults to
                     https://machine-ai.github.io/catalog/catalog.json.
  --cache <dir>      Override cache root (default: ~/.machine/cartridges).
  --force            Re-download even if the cartridge is already cached.
  --help             Show this message.
`;

const DEFAULT_CATALOG_URL = 'https://machine-ai.github.io/catalog/catalog.json';

export async function runPull(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const target = args.positionals[0];
  if (!target) {
    errorln(red('pull: missing cartridge id'));
    errorln(HELP);
    return 2;
  }

  const { id, version } = splitIdVersion(target);
  const catalogUrl = getStringFlag(args, 'catalog') ?? DEFAULT_CATALOG_URL;
  const cacheDir = getStringFlag(args, 'cache');
  const force = getBoolFlag(args, 'force', false);

  const cache = createNodeCartridgeCache(cacheDir ? { rootDir: cacheDir } : {});

  try {
    println(dim(`Fetching catalog ${catalogUrl}`));
    const catalog = await fetchCatalog(catalogUrl);
    const resolveSpec: { id: string; version?: string } = { id };
    if (version !== undefined) resolveSpec.version = version;
    const { entry } = resolveCartridgeEntry(catalog, resolveSpec);

    const alreadyPresent = !force && (await cache.isPresent(entry.id, entry.version));
    if (alreadyPresent) {
      const { cartridgeDir } = cache.paths(entry.id, entry.version);
      println(yellow(`Already cached: ${entry.id}@${entry.version}`));
      println(dim(`  → ${cartridgeDir}`));
      println(dim('  (use --force to re-download)'));
      return 0;
    }

    println(
      dim(`Downloading ${entry.id}@${entry.version} (${formatBytes(entry.downloadSizeBytes)})`),
    );

    let lastPrintedPercent = -1;
    const startedAt = Date.now();

    const result = await downloadAndUnpackCartridge({
      entry,
      cache,
      force,
      onProgress(p) {
        const percent = Math.floor(p.fraction * 100);
        if (percent !== lastPrintedPercent) {
          lastPrintedPercent = percent;
          const elapsedMs = Date.now() - startedAt;
          const rate = elapsedMs > 0 ? p.receivedBytes / (elapsedMs / 1000) : 0;
          const eta =
            rate > 0 && p.totalBytes > p.receivedBytes
              ? `${Math.ceil((p.totalBytes - p.receivedBytes) / rate)}s`
              : '—';
          const line = `  ${percent}% (${formatBytes(p.receivedBytes)}/${formatBytes(p.totalBytes)})  ETA ${eta}`;
          if (process.stdout.isTTY) {
            process.stdout.write(`\r${line}   `);
          }
        }
      },
    });

    if (process.stdout.isTTY) process.stdout.write('\r');
    println(green(`Pulled ${entry.id}@${entry.version}`));
    println(dim(`  → ${result.cartridgeDir}`));
    println(dim(`  sha256 ${result.sha256.slice(0, 12)}…`));
    return 0;
  } catch (error) {
    errorln(red(`pull: ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  }
}

function splitIdVersion(target: string): { id: string; version?: string } {
  const at = target.lastIndexOf('@');
  if (at <= 0) return { id: target };
  return { id: target.slice(0, at), version: target.slice(at + 1) };
}
