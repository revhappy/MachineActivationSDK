import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test } from '../_harness';
import { buildGguf, buildQwenLikeGguf, GGUF_TYPE } from '../model/_ggufFixture';
import { runCli } from './_run';

function withModelFile<T>(bytes: Buffer, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-test-'));
  try {
    const file = join(dir, 'model.gguf');
    writeFileSync(file, bytes);
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('machine doctor reports model, device and fit without a runtime', () => {
  withModelFile(buildQwenLikeGguf({ trailingBytes: 4096 }), (file) => {
    const result = runCli(['doctor', file]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Test Mini Instruct/);
    assert.match(result.stdout, /architecture:\s+qwen2/);
    assert.match(result.stdout, /quantization:\s+Q4_K_M/);
    assert.match(result.stdout, /context:\s+32,768 tokens/);
    assert.match(result.stdout, /Device/);
    assert.match(result.stdout, /Fit/);
    assert.match(result.stdout, /Verdict:/);
    // Static analysis must work with nothing installed — that's the whole
    // point of doctor being the day-one tool.
    assert.match(result.stdout, /Static analysis only/);
  });
});

test('machine doctor --json emits a machine-readable report', () => {
  withModelFile(buildQwenLikeGguf({ trailingBytes: 4096 }), (file) => {
    const result = runCli(['doctor', file, '--json']);

    assert.equal(result.exitCode, 0);
    const report = JSON.parse(result.stdout) as {
      model: { gguf: { architecture: string; hasChatTemplate: boolean } };
      device: { platform: string; totalMemoryMb: number };
      contract: { memoryAssessment: { status: string } };
      verdict: string;
    };

    assert.equal(report.model.gguf.architecture, 'qwen2');
    assert.equal(report.model.gguf.hasChatTemplate, true);
    assert.ok(report.device.totalMemoryMb > 0);
    assert.ok(['supported', 'tight', 'insufficient', 'unknown'].includes(
      report.contract.memoryAssessment.status,
    ));
    assert.ok(['ready', 'tight', 'not-recommended'].includes(report.verdict));
  });
});

test('machine doctor flags a base model with no chat template', () => {
  const bytes = buildGguf({
    kv: [
      ['general.architecture', { type: GGUF_TYPE.STRING, value: 'llama' }],
      ['general.file_type', { type: GGUF_TYPE.UINT32, value: 7 }],
      ['llama.context_length', { type: GGUF_TYPE.UINT32, value: 4096 }],
    ],
    tensors: [{ name: 'tok.weight', dims: [64, 64] }],
    trailingBytes: 2048,
  });

  withModelFile(bytes, (file) => {
    const result = runCli(['doctor', file, '--json']);
    const report = JSON.parse(result.stdout) as {
      model: { gguf: { hasChatTemplate: boolean } };
      contract: { resolvedCapabilities: { textChat: boolean }; reasons: string[] };
    };

    // Chat prompts against a base model produce drivel; say so up front
    // rather than letting the developer discover it at inference time.
    assert.equal(report.model.gguf.hasChatTemplate, false);
    assert.equal(report.contract.resolvedCapabilities.textChat, false);
    assert.ok(report.contract.reasons.length > 0);
  });
});

test('machine doctor exits 2 on a missing path and 1 on a non-GGUF file', () => {
  const missing = runCli(['doctor', join(tmpdir(), 'definitely-not-here.gguf')]);
  assert.equal(missing.exitCode, 2);
  assert.match(missing.stderr, /cannot read/);

  withModelFile(Buffer.from('plain text, not a model', 'utf8'), (file) => {
    const notGguf = runCli(['doctor', file]);
    assert.equal(notGguf.exitCode, 1);
    assert.match(notGguf.stderr, /Not a GGUF file/);
  });
});

test('machine doctor --run without a runtime fails with an actionable message', () => {
  withModelFile(buildQwenLikeGguf({ trailingBytes: 4096 }), (file) => {
    const result = runCli([
      'doctor',
      file,
      '--json',
      '--run',
      '--server',
      join(tmpdir(), 'no-such-llama-server'),
    ]);

    assert.equal(result.exitCode, 1);
    const report = JSON.parse(result.stdout) as { liveRun: { ok: boolean; error: string } };
    assert.equal(report.liveRun.ok, false);
    assert.match(report.liveRun.error, /llama-server|ENOENT|spawn/i);
  });
});

test('machine doctor --help exits 0', () => {
  const result = runCli(['doctor', '--help']);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /machine doctor/);
});
