import assert from 'node:assert/strict';
import { test } from '../_harness';
import { parseCartridgeManifest } from '../../src/cartridge/manifestSchema';

const validManifest = {
  schemaVersion: '1.0.0',
  id: 'test.example',
  name: 'Example',
  version: '1.0.0',
  weights: {
    format: 'gguf',
    path: 'weights/model.gguf',
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
  },
  capabilities: {
    inputModalities: ['text'],
    outputModalities: ['text'],
  },
};

test('parseCartridgeManifest accepts a valid manifest', () => {
  const result = parseCartridgeManifest(validManifest);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.manifest.id, 'test.example');
    assert.equal(result.manifest.weights.format, 'gguf');
    assert.equal(result.manifest.weights.sha256, 'a'.repeat(64));
  }
});

test('parseCartridgeManifest rejects a missing id', () => {
  const { id: _id, ...rest } = validManifest;
  const result = parseCartridgeManifest(rest);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === 'id'));
  }
});

test('parseCartridgeManifest rejects an unknown weight format', () => {
  const result = parseCartridgeManifest({
    ...validManifest,
    weights: { ...validManifest.weights, format: 'onnx' },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === 'weights.format'));
  }
});

test('parseCartridgeManifest rejects absolute weights path (escape attempt)', () => {
  const result = parseCartridgeManifest({
    ...validManifest,
    weights: { ...validManifest.weights, path: '/etc/passwd' },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === 'weights.path'));
  }
});

test('parseCartridgeManifest rejects parent-dir-escaping weights path', () => {
  const result = parseCartridgeManifest({
    ...validManifest,
    weights: { ...validManifest.weights, path: '../../../../tmp/evil' },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === 'weights.path'));
  }
});

test('parseCartridgeManifest rejects malformed sha256', () => {
  const result = parseCartridgeManifest({
    ...validManifest,
    weights: { ...validManifest.weights, sha256: 'nope' },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === 'weights.sha256'));
  }
});

test('parseCartridgeManifest accepts custom chatTemplate object', () => {
  const result = parseCartridgeManifest({
    ...validManifest,
    chatTemplate: { type: 'custom', template: '<|system|>{system}<|user|>{user}' },
  });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.manifest.chatTemplate, {
      type: 'custom',
      template: '<|system|>{system}<|user|>{user}',
    });
  }
});

test('parseCartridgeManifest rejects chatTemplate with missing template string', () => {
  const result = parseCartridgeManifest({
    ...validManifest,
    chatTemplate: { type: 'custom' },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === 'chatTemplate'));
  }
});

test('parseCartridgeManifest lower-cases sha256', () => {
  const result = parseCartridgeManifest({
    ...validManifest,
    weights: { ...validManifest.weights, sha256: 'A'.repeat(64) },
  });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.manifest.weights.sha256, 'a'.repeat(64));
  }
});
