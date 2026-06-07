import assert from 'node:assert/strict';
import { test } from './_harness';
import {
  assessActivationMemoryFit,
  estimateModelRuntimeMemoryMb,
} from '../src/activation/activationPlanning';

test('activationPlanning estimates runtime memory with modality and projector overhead', () => {
  const estimated = estimateModelRuntimeMemoryMb({
    fileSizeBytes: 2 * 1024 * 1024 * 1024,
    modelFormat: 'gguf',
    inputModalities: ['text', 'image'],
    requiresProjector: true,
    contextWindowTokens: 8192,
  });

  assert.ok(typeof estimated === 'number');
  assert.ok(estimated > 2048);
});

test('activationPlanning marks a healthy fit as supported', () => {
  const result = assessActivationMemoryFit(
    {
      fileSizeBytes: 1024 * 1024 * 1024,
      inputModalities: ['text'],
      contextWindowTokens: 4096,
      modelFormat: 'gguf',
      requiresProjector: false,
    } as any,
    {
      platform: 'android',
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: ['cpu'],
      availableMemoryMb: 4096,
      notes: [],
    },
  );

  assert.equal(result.status, 'supported');
});

test('activationPlanning marks low headroom as tight or insufficient', () => {
  const tight = assessActivationMemoryFit(
    {
      fileSizeBytes: 2 * 1024 * 1024 * 1024,
      inputModalities: ['text'],
      contextWindowTokens: 4096,
      modelFormat: 'gguf',
      requiresProjector: false,
    } as any,
    {
      platform: 'android',
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: ['cpu'],
      availableMemoryMb: 2600,
      notes: [],
    },
  );

  const insufficient = assessActivationMemoryFit(
    {
      fileSizeBytes: 2 * 1024 * 1024 * 1024,
      estimatedRuntimeMemoryMb: 3200,
      inputModalities: ['text'],
      contextWindowTokens: 4096,
      modelFormat: 'gguf',
      requiresProjector: false,
    } as any,
    {
      platform: 'android',
      cameraAvailable: false,
      photoLibraryAvailable: false,
      availableAccelerationModes: ['cpu'],
      availableMemoryMb: 2048,
      notes: [],
    },
  );

  assert.match(tight.status, /tight|insufficient/);
  assert.equal(insufficient.status, 'insufficient');
});
