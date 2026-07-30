// Minimal test harness. No Jest/Mocha — just `test(name, fn)` + `finish()`.
//
// Tests run SEQUENTIALLY, in registration order, each under a timeout.
//
// The earlier version pushed `Promise.resolve().then(fn)` at registration time,
// which started every test the moment its file was imported — so the whole
// suite ran concurrently with no isolation and no timeout. That interacts badly
// with the CLI tests: `runCli()` uses `spawnSync`, which blocks the shared event
// loop, while `tests/cli/{pull,search}.test.ts` need that same loop free to
// serve their in-process HTTP catalog server. The result was the long-standing
// "CLI pull/search localhost flake", and because nothing was time-bounded a
// stall hung forever instead of failing.

interface QueuedTest {
  name: string;
  fn: () => void | Promise<void>;
}

const queue: QueuedTest[] = [];
let failures = 0;

const DEFAULT_TIMEOUT_MS = 60_000;
const SLOW_TEST_MS = 5_000;

function testTimeoutMs(): number {
  const raw = process.env.MACHINE_TEST_TIMEOUT_MS;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function test(name: string, fn: () => void | Promise<void>): void {
  queue.push({ name, fn });
}

export async function finish(): Promise<void> {
  const limitMs = testTimeoutMs();
  let passed = 0;

  for (const { name, fn } of queue) {
    const started = Date.now();
    try {
      await runWithTimeout(fn, limitMs);
      passed += 1;
      const elapsed = Date.now() - started;
      const slow = elapsed >= SLOW_TEST_MS ? ` # ${elapsed}ms` : '';
      console.log(`ok - ${name}${slow}`);
    } catch (error) {
      failures += 1;
      console.error(`not ok - ${name}`);
      console.error(error);
    }
  }

  console.log(`# ${queue.length} test(s): ${passed} passed, ${failures} failed`);

  if (failures > 0) {
    throw new Error(`${failures} test(s) failed.`);
  }
}

async function runWithTimeout(
  fn: () => void | Promise<void>,
  limitMs: number,
): Promise<void> {
  const run = Promise.resolve().then(fn);
  // A timed-out test keeps running in the background; swallow its eventual
  // rejection so it can't surface later as an unhandled rejection and kill
  // the process mid-suite.
  run.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${limitMs}ms`));
    }, limitMs);
    // Don't let a pending timer hold the process open.
    timer.unref?.();
  });

  try {
    await Promise.race([run, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
