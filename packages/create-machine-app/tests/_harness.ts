// Minimal test harness. No Jest/Mocha — just `test(name, fn)` + `finish()`.
//
// Tests run SEQUENTIALLY, in registration order, each under a timeout. See the
// comment in the SDK root harness (`tests/_harness.ts`) for why: registering a
// test used to start it immediately, so the whole suite ran concurrently with
// no isolation and no time bound. It matters more here than anywhere — these
// tests scaffold real project trees onto disk, and overlapping runs share the
// filesystem.

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

export function assertEqual<T>(actual: T, expected: T, detail?: string): void {
  if (actual !== expected) {
    const msg = detail ? `${detail}: ` : '';
    throw new Error(
      `${msg}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function assert(cond: unknown, detail: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${detail}`);
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
  // rejection so it can't surface later as an unhandled rejection.
  run.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${limitMs}ms`));
    }, limitMs);
    timer.unref?.();
  });

  try {
    await Promise.race([run, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
