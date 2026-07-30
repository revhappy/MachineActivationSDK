#!/usr/bin/env node
/**
 * Regenerate the GBNF parity fixture the Python test suite checks itself against.
 *
 * The Python client carries its own port of `jsonSchemaToGbnf` (a Python app
 * cannot shell out to Node just to constrain a model - that was the whole
 * problem). Two emitters mean they can drift, so `clients/python/tests/
 * test_gbnf.py` asserts the Python output is byte-identical to the TypeScript
 * output for every schema in this fixture.
 *
 * Run this ONLY when you intend to change the TypeScript emitter's output, and
 * make the matching change to `clients/python/machine_activation/gbnf.py` in the
 * same commit:
 *
 *     npm run build && node scripts/dump-gbnf-parity.js
 */
const fs = require('node:fs');
const path = require('node:path');

const { jsonSchemaToGbnf } = require('../dist/cjs/sdk/jsonSchemaToGbnf.js');

const FIXTURE = path.join(
  __dirname, '..', 'clients', 'python', 'tests', 'fixtures', 'gbnf_parity.json');

const existing = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const cases = existing.cases.map(({ schema }) => ({
  schema,
  gbnf: jsonSchemaToGbnf(schema),
}));

fs.writeFileSync(
  FIXTURE,
  JSON.stringify({ note: existing.note, cases }, null, 2) + '\n',
);
console.log(`Regenerated ${cases.length} parity cases -> ${FIXTURE}`);
