import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test } from '../_harness';
import {
  GgufParseError,
  GgufTruncatedError,
  countParameters,
  formatParameterCount,
  parseGguf,
  quantizationLabel,
  summarizeGguf,
} from '../../src/model/gguf';
import { readGgufSummary } from '../../src/model/nodeGguf';
import { GGUF_TYPE, buildGguf, buildQwenLikeGguf } from './_ggufFixture';

test('parseGguf reads header, KV metadata and tensor info', () => {
  const metadata = parseGguf(buildQwenLikeGguf());

  assert.equal(metadata.version, 3);
  assert.equal(metadata.tensorCount, 3);
  assert.equal(metadata.kv['general.architecture'], 'qwen2');
  assert.equal(metadata.kv['qwen2.context_length'], 32768);
  assert.deepEqual(metadata.kv['tokenizer.ggml.tokens'], ['<pad>', 'hello', 'world']);
  assert.equal(metadata.tensors[0].name, 'token_embd.weight');
  assert.deepEqual(metadata.tensors[0].dims, [896, 1000]);
});

test('summarizeGguf pulls out the fields doctor reports on', () => {
  const summary = summarizeGguf(parseGguf(buildQwenLikeGguf()));

  assert.equal(summary.architecture, 'qwen2');
  assert.equal(summary.name, 'Test Mini Instruct');
  assert.equal(summary.quantization, 'Q4_K_M');
  assert.equal(summary.contextLengthTokens, 32768);
  assert.equal(summary.blockCount, 24);
  assert.equal(summary.headCountKv, 2);
  assert.equal(summary.hasChatTemplate, true);
  // 896*1000 + 896*896 + 896
  assert.equal(summary.parameterCount, 896 * 1000 + 896 * 896 + 896);
});

test('a base model without a chat template is reported as such', () => {
  const bytes = buildGguf({
    kv: [
      ['general.architecture', { type: GGUF_TYPE.STRING, value: 'llama' }],
      ['general.file_type', { type: GGUF_TYPE.UINT32, value: 7 }],
    ],
    tensors: [{ name: 'tok.weight', dims: [16, 16] }],
  });

  const summary = summarizeGguf(parseGguf(bytes));
  assert.equal(summary.hasChatTemplate, false);
  assert.equal(summary.quantization, 'Q8_0');
});

test('unknown file_type ids degrade to a labelled fallback', () => {
  const bytes = buildGguf({
    kv: [['general.file_type', { type: GGUF_TYPE.UINT32, value: 999 }]],
  });
  assert.equal(quantizationLabel(parseGguf(bytes)), 'ftype-999');
});

test('parseGguf rejects a non-GGUF file', () => {
  const notGguf = Buffer.from('this is a text file, not a model', 'utf8');
  assert.throws(() => parseGguf(notGguf), GgufParseError);
});

test('parseGguf signals truncation instead of returning junk', () => {
  const full = buildQwenLikeGguf();
  // Cut mid-KV-section: the parser must say "give me more bytes", not guess.
  assert.throws(() => parseGguf(full.subarray(0, 48)), GgufTruncatedError);
});

test('parseGguf rejects an unsupported GGUF version', () => {
  const bytes = buildGguf({ version: 1, kv: [] });
  assert.throws(() => parseGguf(bytes), /Unsupported GGUF version 1/);
});

test('countParameters returns undefined when tensors were skipped', () => {
  const metadata = parseGguf(buildQwenLikeGguf(), { skipTensors: true });
  assert.equal(countParameters(metadata), undefined);
});

test('formatParameterCount matches how model cards are written', () => {
  assert.equal(formatParameterCount(494_032_768), '494M');
  assert.equal(formatParameterCount(7_240_000_000), '7.24B');
  assert.equal(formatParameterCount(0), undefined);
  assert.equal(formatParameterCount(undefined), undefined);
});

test('readGgufMetadata grows its read window past the initial prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gguf-test-'));
  try {
    const file = join(dir, 'model.gguf');
    // 64 KB of filler stands in for weights the parser must never read.
    writeFileSync(file, buildQwenLikeGguf({ trailingBytes: 64 * 1024 }));

    // Start with a prefix far smaller than the header so the grow path runs.
    const summary = readGgufSummary(file, { initialPrefixBytes: 64 });
    assert.equal(summary.architecture, 'qwen2');
    assert.equal(summary.quantization, 'Q4_K_M');
    assert.equal(summary.tensorCount, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
