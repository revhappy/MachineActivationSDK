import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

export interface Placeholders {
  APP_NAME: string;
  PACKAGE_MANAGER: string;
}

const PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;

export function applyPlaceholders(input: string, values: Placeholders): string {
  const lookup = values as unknown as Record<string, string>;
  return input.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(lookup, key)) {
      return lookup[key];
    }
    return match;
  });
}

export interface ScaffoldWriter {
  mkdir(path: string): void;
  writeFile(path: string, contents: string | Buffer): void;
  copyFile(src: string, dest: string): void;
}

export const fsWriter: ScaffoldWriter = {
  mkdir(path) {
    mkdirSync(path, { recursive: true });
  },
  writeFile(path, contents) {
    writeFileSync(path, contents);
  },
  copyFile(src, dest) {
    copyFileSync(src, dest);
  },
};

export interface ScaffoldOptions {
  templateDir: string;
  targetDir: string;
  values: Placeholders;
  writer?: ScaffoldWriter;
}

export interface ScaffoldResult {
  writtenFiles: string[];
}

/**
 * Copy every file under `templateDir` into `targetDir`. Files whose basename ends in `.tmpl` are
 * read as UTF-8, have placeholders substituted, then written without the `.tmpl` suffix. Other
 * files are byte-copied. Directories are created on demand.
 */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const writer = options.writer ?? fsWriter;
  const written: string[] = [];

  writer.mkdir(options.targetDir);
  walk(options.templateDir, options.templateDir, options.targetDir, options.values, writer, written);

  return { writtenFiles: written };
}

function walk(
  rootSrc: string,
  currentSrc: string,
  rootDest: string,
  values: Placeholders,
  writer: ScaffoldWriter,
  written: string[],
): void {
  const entries = readdirSync(currentSrc);
  for (const name of entries) {
    const fullSrc = join(currentSrc, name);
    const rel = relative(rootSrc, fullSrc);
    const info = statSync(fullSrc);
    if (info.isDirectory()) {
      const destDir = join(rootDest, rel);
      writer.mkdir(destDir);
      walk(rootSrc, fullSrc, rootDest, values, writer, written);
      continue;
    }

    const srcBase = basename(name);
    const isTemplate = srcBase.endsWith('.tmpl');
    const destRel = isTemplate ? rel.slice(0, -'.tmpl'.length) : rel;
    const destPath = join(rootDest, destRel);

    if (isTemplate) {
      const raw = readFileSync(fullSrc, 'utf8');
      writer.writeFile(destPath, applyPlaceholders(raw, values));
    } else {
      writer.copyFile(fullSrc, destPath);
    }

    written.push(destRel);
  }
}
