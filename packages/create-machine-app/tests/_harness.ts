const pending: Promise<void>[] = [];
let failures = 0;

export function test(name: string, fn: () => void | Promise<void>): void {
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(() => {
        console.log(`ok - ${name}`);
      })
      .catch((error) => {
        failures += 1;
        console.error(`not ok - ${name}`);
        console.error(error);
      }),
  );
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
  await Promise.all(pending);
  if (failures > 0) {
    throw new Error(`${failures} test(s) failed.`);
  }
}
