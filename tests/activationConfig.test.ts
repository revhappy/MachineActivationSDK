import assert from 'node:assert/strict';
import { test } from './_harness';
import {
  createJsonActivationModelConfigStorage,
  inferActivationModelConfigFromPickedFile,
  normalizeStoredActivationModelConfig,
  validateStoredActivationModelConfig,
  LITERT_LM_ANDROID_PRESET,
} from '../src/activation/activationConfig';

test('activationConfig normalizes stored config fields and drops empty paths', () => {
  assert.equal(
    normalizeStoredActivationModelConfig({
      filePath: '   ',
    }),
    null,
  );

  const normalized = normalizeStoredActivationModelConfig({
    filePath: '  /models/demo.litertlm  ',
    modelId: '  Demo Model ',
    runtimeHint: '  litert.capacitor.android ',
  });
  assert.equal(normalized?.filePath, '/models/demo.litertlm');
  assert.equal(normalized?.modelId, 'Demo Model');
  assert.equal(normalized?.projectorPath, null);
  assert.equal(normalized?.runtimeHint, 'litert.capacitor.android');
});

test('activationConfig infers a stored config from a picked file', () => {
  const config = inferActivationModelConfigFromPickedFile(
    {
      name: 'Gemma 4 E2B it.litertlm',
      path: '/models/Gemma 4 E2B it.litertlm',
      sizeBytes: 123,
    },
    LITERT_LM_ANDROID_PRESET,
  );

  assert.equal(config.filePath, '/models/Gemma 4 E2B it.litertlm');
  assert.equal(config.modelId, 'gemma-4-e2b-it');
  assert.equal(config.runtimeHint, 'litert.capacitor.android');
  assert.equal(config.projectorPath, null);
});

test('activationConfig validates allowed extensions', () => {
  assert.deepEqual(
    validateStoredActivationModelConfig({
      filePath: '/models/demo.gguf',
      fileName: 'demo.gguf',
    }),
    {
      valid: false,
      reasons: ['Expected one of: .litertlm'],
    },
  );
});

test('activationConfig persists normalized configs through JSON storage', () => {
  const memoryStore = new Map<string, string>();
  const storage = createJsonActivationModelConfigStorage({
    storageKey: 'test.model',
    storage: {
      getItem: (key) => memoryStore.get(key) ?? null,
      setItem: (key, value) => memoryStore.set(key, value),
      removeItem: (key) => memoryStore.delete(key),
    },
  });

  storage.save({
    filePath: ' /models/demo.litertlm ',
    modelId: ' demo ',
    projectorPath: '',
  });

  const loaded = storage.load();
  assert.equal(loaded?.filePath, '/models/demo.litertlm');
  assert.equal(loaded?.modelId, 'demo');
  assert.equal(loaded?.projectorPath, null);

  storage.clear();
  assert.equal(storage.load(), null);
});
