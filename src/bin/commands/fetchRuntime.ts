import {
  fetchLlamaServer,
  supportedLlamaHosts,
} from '../../runtime/fetchLlamaServer';
import { getBoolFlag, getStringFlag, parseArgs } from '../args';
import { bold, dim, errorln, green, println, red, yellow } from '../output';

const HELP = `\
machine fetch-runtime [--dir <path>] [--asset <regex>] [--force]

Download a llama.cpp \`llama-server\` prebuilt for this machine and vendor it at
vendor/llama-cpp/<slug>/, where the SDK looks for it automatically. Run once per
project; after this, \`machine serve\` and the Node runtime need no --server flag.

Cached and idempotent: re-running only downloads when upstream has a newer build.

Flags:
  --dir <path>      Project root to vendor into (default: current directory).
  --asset <regex>   Pick a specific release asset instead of the default build.
                    This is how you get an accelerated build, e.g.
                      --asset 'llama-b\\d+-bin-win-cuda-12.4-x64.zip'
                    Also settable as $LLAMA_CPP_ASSET.
  --force           Re-download even if the cached build is current.
  --help            Show this message.

Supported hosts: ${supportedLlamaHosts().join(', ')}.
Built your own llama-server? Point $MACHINE_LLAMA_SERVER at it and skip this.
`;

export async function runFetchRuntime(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const rootDir = getStringFlag(args, 'dir') ?? args.positionals[0];
  const asset = getStringFlag(args, 'asset');
  const force = getBoolFlag(args, 'force', false);

  try {
    const result = await fetchLlamaServer({
      ...(rootDir ? { rootDir } : {}),
      ...(asset ? { asset } : {}),
      force,
      onLog: (line) => println(dim(`  ${line}`)),
    });

    println('');
    println(
      result.cached
        ? yellow(`Already current: llama.cpp ${result.build} (${result.slug})`)
        : green(`Vendored llama.cpp ${result.build} (${result.slug})`),
    );
    println(dim(`  ${result.binary}`));
    println(dim(`  acceleration: ${result.acceleration} · asset: ${result.asset}`));
    println('');
    println(`${bold('Next:')} machine serve <model.gguf>`);
    return 0;
  } catch (error) {
    errorln(red(`fetch-runtime: ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  }
}
