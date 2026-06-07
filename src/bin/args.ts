/**
 * Minimal zero-dep arg parser. Supports:
 *   - Positional arguments (any token not starting with `--`).
 *   - Boolean flags: `--flag` → true, `--no-flag` → false.
 *   - Key/value flags: `--key value` and `--key=value`.
 *   - Stops collecting flags after `--` (everything after becomes positional).
 *
 * Designed for the `machine` CLI; not a general-purpose parser.
 */
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let stopFlags = false;

  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];

    if (stopFlags) {
      positionals.push(tok);
      continue;
    }
    if (tok === '--') {
      stopFlags = true;
      continue;
    }

    if (tok.startsWith('--')) {
      const body = tok.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (body.startsWith('no-')) {
        flags[body.slice(3)] = false;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[body] = next;
          i += 1;
        } else {
          flags[body] = true;
        }
      }
    } else {
      positionals.push(tok);
    }
  }

  return { positionals, flags };
}

/** Read a string flag, returning `fallback` (default undefined) if absent or boolean. */
export function getStringFlag(
  args: ParsedArgs,
  name: string,
  fallback?: string,
): string | undefined {
  const value = args.flags[name];
  if (typeof value === 'string') return value;
  return fallback;
}

/** Read a boolean flag, default `fallback`. `--no-name` → false; `--name` → true. */
export function getBoolFlag(args: ParsedArgs, name: string, fallback = false): boolean {
  const value = args.flags[name];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value !== 'false' && value !== '0';
  return fallback;
}
