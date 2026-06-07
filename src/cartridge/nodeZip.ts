import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join as pathJoin, resolve as pathResolve, sep as pathSep } from 'node:path';

import yauzl from 'yauzl';
import yazl from 'yazl';

import type { CartridgeZipAdapter, CartridgeZipEntry } from './zipAdapter';

/**
 * Node host zip adapter using yazl (writer) + yauzl (reader). Streams every
 * entry to/from disk so multi-GB weights never sit fully in memory.
 *
 * Do not import this module in a React Native / browser bundle — it pulls in
 * Node built-ins.
 */
export function createNodeCartridgeZipAdapter(): CartridgeZipAdapter {
  return {
    createZip: createZip,
    extractZip: extractZip,
  };
}

async function createZip(outPath: string, entries: readonly CartridgeZipEntry[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const out = createWriteStream(outPath);

    out.on('error', reject);
    out.on('close', () => resolve());
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(out);

    for (const entry of entries) {
      if (entry.sourcePath !== undefined) {
        zip.addFile(entry.sourcePath, toZipPath(entry.relativePath));
      } else if (entry.bytes !== undefined) {
        zip.addBuffer(Buffer.from(entry.bytes), toZipPath(entry.relativePath));
      } else {
        reject(
          new Error(
            `Zip entry "${entry.relativePath}" must specify sourcePath or bytes`,
          ),
        );
        return;
      }
    }

    zip.end();
  });
}

async function extractZip(zipPath: string, outDir: string): Promise<void> {
  const resolvedOut = pathResolve(outDir);
  mkdirSync(resolvedOut, { recursive: true });

  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openErr, zipFile) => {
      if (openErr || !zipFile) {
        reject(openErr ?? new Error('Failed to open zip'));
        return;
      }

      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      zipFile.on('error', settle);
      zipFile.on('end', () => settle());

      zipFile.on('entry', (entry: yauzl.Entry) => {
        const safeName = entry.fileName;
        if (isUnsafePath(safeName)) {
          settle(new Error(`Refusing to extract unsafe entry path: ${safeName}`));
          return;
        }

        const destPath = pathJoin(resolvedOut, safeName);
        if (!destPath.startsWith(resolvedOut + pathSep) && destPath !== resolvedOut) {
          settle(new Error(`Refusing to extract outside output dir: ${safeName}`));
          return;
        }

        if (safeName.endsWith('/')) {
          mkdirSync(destPath, { recursive: true });
          zipFile.readEntry();
          return;
        }

        mkdirSync(dirname(destPath), { recursive: true });

        zipFile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            settle(streamErr ?? new Error(`Failed to read entry ${safeName}`));
            return;
          }
          const writeStream = createWriteStream(destPath);
          writeStream.on('error', settle);
          readStream.on('error', settle);
          writeStream.on('close', () => zipFile.readEntry());
          readStream.pipe(writeStream);
        });
      });

      zipFile.readEntry();
    });
  });
}

function toZipPath(relativePath: string): string {
  return relativePath.split(/[\\/]+/).filter((s) => s.length > 0).join('/');
}

function isUnsafePath(p: string): boolean {
  if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) return true;
  const segments = p.split(/[\\/]+/);
  let depth = 0;
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      depth -= 1;
      if (depth < 0) return true;
    } else {
      depth += 1;
    }
  }
  return false;
}
