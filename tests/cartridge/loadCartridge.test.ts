import assert from 'node:assert/strict';
import { test } from '../_harness';
import {
  CartridgeLoadError,
  loadCartridge,
} from '../../src/cartridge/loadCartridge';
import { createNodeCartridgeFileSystem } from '../../src/cartridge/nodeFs';
import { createCartridgeFixture } from './_fixtures';

const fs = createNodeCartridgeFileSystem();

test('loadCartridge parses a valid extracted cartridge directory', async () => {
  const fixture = createCartridgeFixture();
  try {
    const loaded = await loadCartridge(fixture.dir, { fs });
    assert.equal(loaded.manifest.id, 'test.fixture.mini');
    assert.equal(loaded.manifest.weights.format, 'gguf');
    assert.ok(loaded.weightsPath.endsWith('model.gguf'));
    assert.equal(loaded.projectorPath, undefined);
  } finally {
    fixture.cleanup();
  }
});

test('loadCartridge throws on a missing manifest.json', async () => {
  const fixture = createCartridgeFixture();
  try {
    const { rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    rmSync(join(fixture.dir, 'manifest.json'));

    await assert.rejects(
      () => loadCartridge(fixture.dir, { fs }),
      (err: unknown) => err instanceof CartridgeLoadError,
    );
  } finally {
    fixture.cleanup();
  }
});

test('loadCartridge throws on malformed manifest JSON', async () => {
  const fixture = createCartridgeFixture({ malformedManifest: true });
  try {
    await assert.rejects(
      () => loadCartridge(fixture.dir, { fs }),
      (err: unknown) =>
        err instanceof CartridgeLoadError &&
        /Failed to parse/.test(err.message),
    );
  } finally {
    fixture.cleanup();
  }
});

test('loadCartridge throws when weights file is missing', async () => {
  const fixture = createCartridgeFixture({ omitWeights: true });
  try {
    await assert.rejects(
      () => loadCartridge(fixture.dir, { fs }),
      (err: unknown) =>
        err instanceof CartridgeLoadError &&
        /Weights file missing/.test(err.message),
    );
  } finally {
    fixture.cleanup();
  }
});

test('loadCartridge surfaces manifest issues on an invalid manifest', async () => {
  const fixture = createCartridgeFixture({
    manifestOverrides: {
      weights: {
        format: 'gguf',
        path: '/absolute/path.gguf',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
      },
    },
  });
  try {
    await assert.rejects(
      () => loadCartridge(fixture.dir, { fs }),
      (err: unknown) => {
        if (!(err instanceof CartridgeLoadError)) return false;
        return err.issues.some((i) => i.path === 'weights.path');
      },
    );
  } finally {
    fixture.cleanup();
  }
});

test('loadCartridge throws when a declared projector file is missing', async () => {
  const fixture = createCartridgeFixture({ declareProjectorWithoutFile: true });
  try {
    await assert.rejects(
      () => loadCartridge(fixture.dir, { fs }),
      (err: unknown) =>
        err instanceof CartridgeLoadError &&
        /Projector file missing/.test(err.message),
    );
  } finally {
    fixture.cleanup();
  }
});
