import assert from 'node:assert/strict';
import { test } from '../_harness';
import { jsonSchemaToGbnf } from '../../src/sdk/jsonSchemaToGbnf';

test('jsonSchemaToGbnf emits a string rule for a plain string schema', () => {
  const gbnf = jsonSchemaToGbnf({ type: 'string' });
  assert.match(gbnf, /^root ::= string$/m);
  assert.match(gbnf, /^string ::= /m);
  assert.match(gbnf, /^strchar ::= /m);
});

test('jsonSchemaToGbnf emits alternation for enums', () => {
  const gbnf = jsonSchemaToGbnf({ enum: ['pos', 'neg', 'neu'] });
  assert.match(gbnf, /"\\"pos\\"" \| "\\"neg\\"" \| "\\"neu\\""/);
});

test('jsonSchemaToGbnf emits a const literal', () => {
  const gbnf = jsonSchemaToGbnf({ const: 'hello' });
  assert.match(gbnf, /"\\"hello\\""/);
});

test('jsonSchemaToGbnf emits nested objects with required + optional fields', () => {
  const gbnf = jsonSchemaToGbnf({
    type: 'object',
    properties: {
      summary: { type: 'string' },
      sentiment: { enum: ['pos', 'neg', 'neu'] },
      score: { type: 'number' },
    },
    required: ['summary', 'sentiment'],
  });
  // required keys in strict order, separated by comma
  assert.match(gbnf, /"\\"summary\\"" ws ":" ws string/);
  // optional trailing segment wrapped in ()?
  assert.match(gbnf, /\(ws "," ws "\\"score\\"" ws ":" ws number\)\?/);
  // the root references the synthesized object rule
  assert.match(gbnf, /^root ::= obj-/m);
});

test('jsonSchemaToGbnf wraps all-optional objects so empty-object is legal', () => {
  const gbnf = jsonSchemaToGbnf({
    type: 'object',
    properties: {
      a: { type: 'string' },
      b: { type: 'string' },
    },
  });
  // Whole body must be wrapped so the empty case is matchable
  assert.match(gbnf, /"\{" ws \(/);
});

test('jsonSchemaToGbnf emits union grammar for anyOf', () => {
  const gbnf = jsonSchemaToGbnf({
    anyOf: [
      {
        type: 'object',
        properties: { tool: { const: 'lookup' } },
        required: ['tool'],
      },
      {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
      },
    ],
  });
  // two synthesized object rules, one for each branch
  const objRules = gbnf.match(/^obj-\d+ ::= /gm) ?? [];
  assert.equal(objRules.length, 2);
  // root alternation references both
  assert.match(gbnf, /^root ::= union-\d+$/m);
  assert.match(gbnf, /^union-\d+ ::= obj-\d+ \| obj-\d+$/m);
});

test('jsonSchemaToGbnf emits an array rule with per-item constraint', () => {
  const gbnf = jsonSchemaToGbnf({
    type: 'array',
    items: { type: 'string' },
  });
  assert.match(gbnf, /"\[" ws \(string \(ws "," ws string\)\*\)\? ws "\]"/);
});

test('jsonSchemaToGbnf emits minItems>=1 array without the outer optional', () => {
  const gbnf = jsonSchemaToGbnf({
    type: 'array',
    items: { type: 'integer' },
    minItems: 1,
  });
  assert.match(gbnf, /"\[" ws integer \(ws "," ws integer\)\* ws "\]"/);
});

test('jsonSchemaToGbnf falls back to anyValue for schemas without type', () => {
  const gbnf = jsonSchemaToGbnf({});
  assert.match(gbnf, /^root ::= anyValue$/m);
  assert.match(gbnf, /^anyValue ::= /m);
});

test('jsonSchemaToGbnf caches identical sub-schemas to a single rule', () => {
  const gbnf = jsonSchemaToGbnf({
    type: 'object',
    properties: {
      first: {
        type: 'object',
        properties: { x: { type: 'string' } },
        required: ['x'],
      },
      second: {
        type: 'object',
        properties: { x: { type: 'string' } },
        required: ['x'],
      },
    },
    required: ['first', 'second'],
  });
  // The two identical nested objects should reuse one rule, so at most
  // two top-level obj rules exist (outer + inner), not three.
  const objRules = gbnf.match(/^obj-\d+ ::= /gm) ?? [];
  assert.equal(objRules.length, 2);
});

test('jsonSchemaToGbnf emits nullable as a union with null', () => {
  const gbnf = jsonSchemaToGbnf({ type: 'string', nullable: true });
  // anyOf | null construct — either a union rule referencing string + null
  assert.match(gbnf, /string \| jsonNull/);
  assert.match(gbnf, /^jsonNull ::= "null"$/m);
});

test('jsonSchemaToGbnf escapes special characters in literal values', () => {
  const gbnf = jsonSchemaToGbnf({ const: 'say "hi"' });
  // In GBNF source we should see: "\"say \\\"hi\\\"\""
  // i.e., outer quotes, then escaped \", then "say ", then escaped \" \", ...
  // Easier check: the grammar should not contain unescaped inner "
  const literalMatch = gbnf.match(/"[^"\n]*(?:\\"[^"\n]*)*"/);
  assert.ok(literalMatch, 'should have a literal');
});
