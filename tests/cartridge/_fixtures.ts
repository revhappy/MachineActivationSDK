import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CartridgeManifest } from '../../src/cartridge/types';

export interface FixtureOptions {
  weightsBytes?: Uint8Array;
  manifestOverrides?: Partial<CartridgeManifest>;
  /** If true, write an invalid JSON manifest instead of a valid one. */
  malformedManifest?: boolean;
  /** If true, skip writing the weights file. */
  omitWeights?: boolean;
  /** If true, declare a projector path but don't write the file. */
  declareProjectorWithoutFile?: boolean;
  /** If set, use this sha256 in the manifest instead of the real one. */
  manifestSha256Override?: string;
  /** If set, use this sizeBytes in the manifest instead of the real one. */
  manifestSizeOverride?: number;
}

export interface Fixture {
  dir: string;
  weightsBytes: Uint8Array;
  weightsSha256: string;
  cleanup(): void;
}

export function createCartridgeFixture(options: FixtureOptions = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'mcart-'));
  const weightsBytes = options.weightsBytes ?? new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const weightsSha256 = createHash('sha256').update(weightsBytes).digest('hex');

  mkdirSync(join(dir, 'weights'), { recursive: true });
  if (!options.omitWeights) {
    writeFileSync(join(dir, 'weights', 'model.gguf'), Buffer.from(weightsBytes));
  }

  if (options.malformedManifest) {
    writeFileSync(join(dir, 'manifest.json'), '{ not valid json');
  } else {
    const manifest: CartridgeManifest = {
      schemaVersion: '1.0.0',
      id: 'test.fixture.mini',
      name: 'Mini Fixture',
      version: '0.1.0',
      weights: {
        format: 'gguf',
        path: 'weights/model.gguf',
        sizeBytes: options.manifestSizeOverride ?? weightsBytes.length,
        sha256: options.manifestSha256Override ?? weightsSha256,
      },
      capabilities: {
        inputModalities: ['text'],
        outputModalities: ['text'],
        contextWindowTokens: 2048,
        supportsTextCompletion: true,
        supportsTextChat: true,
        supportsStreaming: true,
      },
      ...options.manifestOverrides,
    };

    if (options.declareProjectorWithoutFile) {
      manifest.weights.projectorPath = 'weights/mmproj.gguf';
    }

    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  return {
    dir,
    weightsBytes,
    weightsSha256,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
