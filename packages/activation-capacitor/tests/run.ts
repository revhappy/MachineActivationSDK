// The Capacitor runtime adapter only loads inside an Android shell with the
// native plugin available, so there is nothing meaningful to exercise in
// Node. The compile pass (`tsc -p tsconfig.tests.json`) already proves the
// package's TypeScript surface lines up against `machineai-activation`'s
// types. This script just verifies the build emitted the expected entry
// files so a packaging regression would be caught.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cjsEntry = join(root, 'dist', 'cjs', 'index.js');
const esmEntry = join(root, 'dist', 'esm', 'index.js');
const esmPkg = join(root, 'dist', 'esm', 'package.json');

for (const path of [cjsEntry, esmEntry, esmPkg]) {
  if (!existsSync(path)) {
    throw new Error(`activation-capacitor build artifact missing: ${path}`);
  }
}

console.log('activation-capacitor build artifact check ok');
