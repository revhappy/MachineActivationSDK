import assert from 'node:assert/strict';
import { test } from '../_harness';
import { createMachine, generateText, loadCartridge } from '../../src/index';
import { createNodeCartridgeFileSystem } from '../../src/cartridge/nodeFs';
import { cartridgeToActivationInput } from '../../src/cartridge/toActivationInput';
import { createMockRuntime } from '../sdk/_mockRuntime';
import { createCartridgeFixture } from './_fixtures';

const fs = createNodeCartridgeFileSystem();

test('cartridgeToActivationInput maps manifest into activation input', async () => {
  const fixture = createCartridgeFixture({
    manifestOverrides: {
      requirements: { preferredAcceleration: ['gpu', 'cpu'] },
    },
  });
  try {
    const cartridge = await loadCartridge(fixture.dir, { fs });
    const input = cartridgeToActivationInput(cartridge);

    assert.equal(input.modelId, 'test.fixture.mini');
    assert.equal(input.filePath, cartridge.weightsPath);
    assert.equal(input.runtimeHint, 'llama');
    assert.equal(input.modelFormatHint, 'gguf');
    assert.equal(input.contextWindowTokens, 2048);
    assert.deepEqual(input.preferredAcceleration, ['gpu', 'cpu']);
    assert.equal(input.observedCapabilities?.source, 'probe-suite');
    assert.equal(input.observedCapabilities?.streaming, true);
  } finally {
    fixture.cleanup();
  }
});

test('cartridgeToActivationInput skips observedCapabilities when trust=false', async () => {
  const fixture = createCartridgeFixture();
  try {
    const cartridge = await loadCartridge(fixture.dir, { fs });
    const input = cartridgeToActivationInput(cartridge, {
      trustDeclaredCapabilities: false,
    });
    assert.equal(input.observedCapabilities, undefined);
  } finally {
    fixture.cleanup();
  }
});

test('machine.modelFromCartridge drives generateText end-to-end', async () => {
  const fixture = createCartridgeFixture();
  try {
    const cartridge = await loadCartridge(fixture.dir, { fs });
    const runtime = createMockRuntime({
      completeText: async (prompt) => `cartridge says: ${prompt}`,
    });
    const machine = createMachine({ runtimes: runtime });
    const model = machine.modelFromCartridge(cartridge);

    assert.equal(model.modelId, 'test.fixture.mini');

    const result = await generateText({
      model,
      prompt: 'ping',
      maxTokens: 10,
    });
    assert.equal(result.text, 'cartridge says: ping');
    assert.equal(result.finishReason, 'stop');

    await machine.close();
  } finally {
    fixture.cleanup();
  }
});

test('machine.modelFromCartridge caches identical cartridges', async () => {
  const fixture = createCartridgeFixture();
  try {
    const cartridge = await loadCartridge(fixture.dir, { fs });
    const runtime = createMockRuntime({
      completeText: async () => 'ok',
    });
    const machine = createMachine({ runtimes: runtime });

    const a = machine.modelFromCartridge(cartridge);
    const b = machine.modelFromCartridge(cartridge);
    assert.equal(a, b);

    await machine.close();
  } finally {
    fixture.cleanup();
  }
});

test('machine.model({ cartridge }) resolves via cartridgeResolver end-to-end', async () => {
  const fixture = createCartridgeFixture();
  try {
    const cartridge = await loadCartridge(fixture.dir, { fs });
    let resolverCalls = 0;
    const resolver = async (spec: { id: string; version?: string }) => {
      resolverCalls += 1;
      assert.equal(spec.id, 'test.fixture.mini');
      return cartridge;
    };

    const runtime = createMockRuntime({
      completeText: async (prompt) => `resolved: ${prompt}`,
    });
    const machine = createMachine({ runtimes: runtime, cartridgeResolver: resolver });
    const model = machine.model({ cartridge: 'test.fixture.mini' });

    assert.equal(model.modelId, 'test.fixture.mini');

    const result = await generateText({ model, prompt: 'hi', maxTokens: 5 });
    assert.equal(result.text, 'resolved: hi');
    assert.equal(resolverCalls, 1);

    // second call on same model must hit the cached session, not re-resolve.
    await generateText({ model, prompt: 'again', maxTokens: 5 });
    assert.equal(resolverCalls, 1);

    await machine.close();
  } finally {
    fixture.cleanup();
  }
});

test('machine.model({ cartridge }) throws without a resolver', async () => {
  const runtime = createMockRuntime({ completeText: async () => 'x' });
  const machine = createMachine({ runtimes: runtime });
  const model = machine.model({ cartridge: 'com.example.whatever' });
  await assert.rejects(
    generateText({ model, prompt: 'p', maxTokens: 1 }),
    (err: unknown) => err instanceof Error && /requires a cartridgeResolver/.test(err.message),
  );
  await machine.close();
});
