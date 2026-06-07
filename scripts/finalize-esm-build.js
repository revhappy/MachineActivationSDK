#!/usr/bin/env node
// Drops a package.json into dist/esm/ marking it as ESM, so Node treats the
// .js files there as ECMAScript modules. Bundlers (Vite/Rollup/Webpack) pick
// up the ESM build via the `import` condition in the root exports map.
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const esmDir = join(__dirname, '..', 'dist', 'esm');
mkdirSync(esmDir, { recursive: true });
writeFileSync(
  join(esmDir, 'package.json'),
  JSON.stringify({ type: 'module', sideEffects: false }, null, 2) + '\n',
);
