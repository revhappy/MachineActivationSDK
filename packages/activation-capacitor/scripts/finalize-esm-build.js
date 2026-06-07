#!/usr/bin/env node
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const esmDir = join(__dirname, '..', 'dist', 'esm');
mkdirSync(esmDir, { recursive: true });
writeFileSync(
  join(esmDir, 'package.json'),
  JSON.stringify({ type: 'module', sideEffects: false }, null, 2) + '\n',
);
