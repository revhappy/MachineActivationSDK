import { strict as assert } from 'node:assert';

import { stubRuntime } from '../../src/runtime/stubRuntime';
import { test } from '../_harness';

test('stub runtime streams the canned reply in chunks', async () => {
  const runtime = stubRuntime({ respond: () => 'one two three' });
  const session = await runtime.createSession({ filePath: 'stub' });

  const deltas: string[] = [];
  const result = await session.complete('anything', { onToken: (t) => deltas.push(t) });

  assert.equal(result.text, 'one two three');
  assert.ok(deltas.length > 1, 'expected the stub to stream more than one chunk');
  assert.equal(deltas.join(''), 'one two three');
});

test('stub runtime can emit the reply as a single chunk', async () => {
  const runtime = stubRuntime({ respond: () => 'one two three', chunked: false });
  const session = await runtime.createSession({ filePath: 'stub' });

  const deltas: string[] = [];
  await session.complete('anything', { onToken: (t) => deltas.push(t) });

  assert.deepEqual(deltas, ['one two three']);
});

test('stub runtime sees the messages and options it was called with', async () => {
  let sawGrammar: string | undefined;
  let sawRole: string | undefined;
  const runtime = stubRuntime({
    respond: (messages, options) => {
      sawGrammar = options?.grammar;
      sawRole = messages[0]?.role;
      return 'ok';
    },
  });
  const session = await runtime.createSession({ filePath: 'stub' });

  await session.completeChat([{ role: 'user', content: 'hi' }], { grammar: 'root ::= "x"' });

  assert.equal(sawRole, 'user');
  assert.equal(sawGrammar, 'root ::= "x"');
});

test('stub runtime resolves a compatible contract so tests need no special-casing', async () => {
  const runtime = stubRuntime();
  const session = await runtime.createSession({
    filePath: 'stub',
    appRequirements: { structuredJsonOutput: true, toolCalling: true, streaming: true },
  });

  assert.equal(session.resolvedContract.compatible, true);
  assert.deepEqual(session.resolvedContract.reasons, []);

  // `degraded` is expected to be true: with no device-memory figures the
  // contract cannot assess fit and records an advisory warning. That is the
  // permissive-by-default shape — soft concerns become warnings, and only
  // `reasons` block activation. An adapter reporting over HTTP can never know
  // the host's RAM, so treating this as a failure would gate every remote
  // session on a question it cannot answer.
  assert.equal(session.resolvedContract.compatibility, 'degraded');
  assert.ok(
    session.resolvedContract.warnings.some((w) => /memory/i.test(w)),
    'expected the unknown-memory advisory',
  );
});

test('stub runtime rejects with AbortError on an aborted signal', async () => {
  const runtime = stubRuntime({ respond: () => 'a b c' });
  const session = await runtime.createSession({ filePath: 'stub' });

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => session.complete('hi', { abortSignal: controller.signal }),
    (error: Error) => error.name === 'AbortError',
  );
});

test('stub runtime handles an empty reply without emitting a chunk', async () => {
  const runtime = stubRuntime({ respond: () => '' });
  const session = await runtime.createSession({ filePath: 'stub' });

  const deltas: string[] = [];
  const result = await session.complete('hi', { onToken: (t) => deltas.push(t) });

  assert.equal(result.text, '');
  assert.equal(deltas.length, 0);
});
