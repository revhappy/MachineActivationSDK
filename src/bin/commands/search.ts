import { fetchCatalog } from '../../catalog';
import type { CatalogEntry } from '../../catalog';
import { getBoolFlag, getStringFlag, parseArgs } from '../args';
import { bold, dim, errorln, formatBytes, printJson, println, red } from '../output';

const HELP = `\
machine search <query> [--catalog <url>] [--json]

Search a catalog for cartridges matching a substring across id, name,
description, tags, and categories. Case-insensitive.

Flags:
  --catalog <url>   Catalog JSON URL (default: machine-ai.github.io).
  --json            Emit matching entries as JSON instead of a table.
  --help            Show this message.
`;

const DEFAULT_CATALOG_URL = 'https://machine-ai.github.io/catalog/catalog.json';

export async function runSearch(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const query = args.positionals[0];
  if (!query) {
    errorln(red('search: missing query'));
    errorln(HELP);
    return 2;
  }

  const catalogUrl = getStringFlag(args, 'catalog') ?? DEFAULT_CATALOG_URL;
  const json = getBoolFlag(args, 'json', false);

  try {
    const catalog = await fetchCatalog(catalogUrl);
    const matches = filterEntries(catalog.entries, query);

    if (json) {
      printJson(matches);
    } else if (matches.length === 0) {
      println(dim(`No cartridges match "${query}".`));
    } else {
      for (const entry of matches) {
        println(bold(`${entry.id}@${entry.version}  ${dim('— ' + entry.name)}`));
        if (entry.description) println(`  ${entry.description}`);
        const meta: string[] = [formatBytes(entry.downloadSizeBytes)];
        if (entry.tags?.length) meta.push(entry.tags.join(', '));
        println(dim(`  ${meta.join('  ·  ')}`));
      }
    }
    return 0;
  } catch (error) {
    errorln(red(`search: ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  }
}

function filterEntries(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const needle = query.toLowerCase();
  return entries.filter((e) => {
    if (e.id.toLowerCase().includes(needle)) return true;
    if (e.name.toLowerCase().includes(needle)) return true;
    if (e.description?.toLowerCase().includes(needle)) return true;
    if (e.tags?.some((t) => t.toLowerCase().includes(needle))) return true;
    if (e.categories?.some((c) => c.toLowerCase().includes(needle))) return true;
    return false;
  });
}
