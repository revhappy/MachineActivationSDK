import assert from 'node:assert/strict';
import { test } from '../_harness';
import {
  defaultSha256Hasher,
  validateCartridge,
} from '../../src/cartridge/validateCartridge';
import { createNodeCartridgeFileSystem } from '../../src/cartridge/nodeFs';
import { createCartridgeFixture } from './_fixtures';

const fs = createNodeCartridgeFileSystem();

test('validateCartridge passes when sha256 and size match', async () => {
  const fixture = createCartridgeFixture();
  try {
    const result = await validateCartridge(fixture.dir, { fs });
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.cartridge.manifest.id, 'test.fixture.mini');
    }
  } finally {
    fixture.cleanup();
  }
});

test('validateCartridge fails on sha256 mismatch', async () => {
  const fixture = createCartridgeFixture({
    manifestSha256Override: 'b'.repeat(64),
  });
  try {
    const result = await validateCartridge(fixture.dir, { fs });
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.issues.some((i) => i.path === 'weights.sha256'));
    }
  } finally {
    fixture.cleanup();
  }
});

test('validateCartridge fails on size mismatch', async () => {
  const fixture = createCartridgeFixture({ manifestSizeOverride: 999 });
  try {
    const result = await validateCartridge(fixture.dir, { fs });
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.issues.some((i) => i.path === 'weights.sizeBytes'));
    }
  } finally {
    fixture.cleanup();
  }
});

test('validateCartridge can skip sha256 verification', async () => {
  const fixture = createCartridgeFixture({
    manifestSha256Override: 'c'.repeat(64),
  });
  try {
    const result = await validateCartridge(fixture.dir, {
      fs,
      verifySha256: false,
    });
    assert.equal(result.valid, true);
  } finally {
    fixture.cleanup();
  }
});

test('validateCartridge reports manifest issues when the manifest itself is invalid', async () => {
  const fixture = createCartridgeFixture({ malformedManifest: true });
  try {
    const result = await validateCartridge(fixture.dir, { fs });
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.issues.length > 0);
    }
  } finally {
    fixture.cleanup();
  }
});

test('defaultSha256Hasher matches known vectors', async () => {
  // sha256 of the UTF-8 string "abc" — a well-known test vector.
  const abc = new TextEncoder().encode('abc');
  assert.equal(
    await defaultSha256Hasher(abc),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );

  const empty = new Uint8Array(0);
  assert.equal(
    await defaultSha256Hasher(empty),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});
