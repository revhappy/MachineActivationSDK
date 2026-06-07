import assert from 'node:assert/strict';
import { test } from './_harness';
import { DEFAULT_ACTIVATION_CAPABILITY_REGISTRY } from '../src/index';

test('default capability registry is generated from the shipped catalog and still infers Gemma multimodal hints', () => {
  const inferred = DEFAULT_ACTIVATION_CAPABILITY_REGISTRY.infer({
    filePath: '/models/gemma-4-E2B-it.litertlm',
    modelId: 'gemma-4-e2b',
  });

  assert.deepEqual(inferred.inferredFields.inputModalities, ['text', 'image']);
  assert.equal(inferred.inferredFields.structuredJsonOutput, true);
  assert.equal(inferred.inferredFields.toolCalling, true);
  assert.equal(inferred.inferredFields.requiresProjector, false);
});
