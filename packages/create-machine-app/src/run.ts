import { existsSync, readdirSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

import { getBoolFlag, getStringFlag, parseArgs } from './args';
import { bold, cyan, dim, errorln, green, println, red, yellow } from './output';
import { promptSelect, promptText } from './prompts';
import { scaffold } from './scaffold';
import {
  PACKAGE_MANAGERS,
  TEMPLATES,
  findTemplate,
  isPackageManager,
  templateDir,
  type PackageManager,
} from './templates';

const VERSION = '0.1.0-alpha.1';

const HELP = `\
create-machine-app [app-name] [--template <id>] [--pm <npm|pnpm|yarn>] [--yes] [--force]

Scaffold a local-LLM app preconfigured for machineai-activation.

Templates:
${TEMPLATES.map((t) => `  ${t.id.padEnd(18)} ${t.description}`).join('\n')}

Flags:
  --template, -t   Template id (one of: ${TEMPLATES.map((t) => t.id).join(', ')}).
  --pm             Package manager for the generated app (npm | pnpm | yarn).
  --yes, -y        Skip all prompts; require sufficient flags.
  --force          Overwrite non-empty target directory.
  --help, -h       Show this message.
  --version, -v    Show version.
`;

const APP_NAME_RE = /^[a-z0-9][a-z0-9-_]*$/;
const DEFAULT_APP_NAME = 'my-machine-app';
const DEFAULT_PM: PackageManager = 'npm';

function validateAppName(value: string): string | null {
  if (value.trim() === '') return 'app name cannot be empty';
  if (!APP_NAME_RE.test(value)) {
    return 'app name must start with a lowercase letter or digit, and contain only a-z, 0-9, -, _';
  }
  return null;
}

function isDirNonEmpty(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

export interface ResolvedOptions {
  appName: string;
  templateId: string;
  packageManager: PackageManager;
  targetDir: string;
  force: boolean;
}

export async function run(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);

  if (getBoolFlag(args, 'help', false)) {
    println(HELP);
    return 0;
  }
  if (getBoolFlag(args, 'version', false)) {
    println(VERSION);
    return 0;
  }

  const yes = getBoolFlag(args, 'yes', false);
  const force = getBoolFlag(args, 'force', false);
  const flagTemplate = getStringFlag(args, 'template');
  const flagPm = getStringFlag(args, 'pm');
  const positionalName = args.positionals[0];

  const isInteractive = Boolean(process.stdin.isTTY);

  if (flagTemplate !== undefined && !findTemplate(flagTemplate)) {
    errorln(red(`create-machine-app: unknown template "${flagTemplate}"`));
    errorln(dim(`  available: ${TEMPLATES.map((t) => t.id).join(', ')}`));
    return 2;
  }
  if (flagPm !== undefined && !isPackageManager(flagPm)) {
    errorln(red(`create-machine-app: unknown package manager "${flagPm}"`));
    errorln(dim(`  available: ${PACKAGE_MANAGERS.join(', ')}`));
    return 2;
  }

  let appName = positionalName;
  let templateId = flagTemplate;
  let packageManager = flagPm as PackageManager | undefined;

  const needsPrompting =
    appName === undefined || templateId === undefined || packageManager === undefined;

  if (needsPrompting && !isInteractive && !yes) {
    errorln(red('create-machine-app: stdin is not a TTY and required flags are missing.'));
    errorln(dim('  pass --yes with --template and an app name to run non-interactively.'));
    return 1;
  }
  if (needsPrompting && yes) {
    if (appName === undefined) appName = DEFAULT_APP_NAME;
    if (templateId === undefined) templateId = TEMPLATES[0].id;
    if (packageManager === undefined) packageManager = DEFAULT_PM;
  }

  if (appName === undefined) {
    appName = await promptText('App name', {
      default: DEFAULT_APP_NAME,
      validate: validateAppName,
    });
  } else {
    const err = validateAppName(appName);
    if (err !== null) {
      errorln(red(`create-machine-app: ${err}`));
      return 2;
    }
  }

  if (templateId === undefined) {
    templateId = await promptSelect(
      'Template',
      TEMPLATES.map((t) => ({ value: t.id, label: t.displayName, description: t.description })),
      TEMPLATES[0].id,
    );
  }

  if (packageManager === undefined) {
    const picked = await promptSelect(
      'Package manager',
      PACKAGE_MANAGERS.map((pm) => ({ value: pm, label: pm })),
      DEFAULT_PM,
    );
    packageManager = picked as PackageManager;
  }

  const template = findTemplate(templateId);
  if (!template) {
    errorln(red(`create-machine-app: unknown template "${templateId}"`));
    return 2;
  }

  const targetDir = pathResolve(process.cwd(), appName);

  if (isDirNonEmpty(targetDir) && !force) {
    errorln(red(`create-machine-app: target directory is not empty: ${targetDir}`));
    errorln(dim('  pass --force to scaffold into it anyway.'));
    return 1;
  }

  const srcDir = templateDir(template.id);
  if (!existsSync(srcDir)) {
    errorln(red(`create-machine-app: template files missing at ${srcDir}`));
    errorln(dim('  this usually means the scaffolder was not built before running.'));
    return 1;
  }

  println('');
  println(`${dim('>')} Scaffolding ${bold(template.displayName)} into ${cyan(targetDir)}…`);

  const result = scaffold({
    templateDir: srcDir,
    targetDir,
    values: { APP_NAME: appName, PACKAGE_MANAGER: packageManager },
  });

  println(green(`✔ Wrote ${result.writtenFiles.length} files.`));
  println('');
  println(bold('Next steps:'));
  println(`  cd ${appName}`);
  for (const step of template.nextSteps) {
    println(`  ${step.replace(/\{pm\}/g, packageManager)}`);
  }
  println('');
  println(yellow('Happy hacking.'));
  return 0;
}
