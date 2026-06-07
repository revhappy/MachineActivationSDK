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

export async function finish(): Promise<void> {
  await Promise.all(pending);

  if (failures > 0) {
    throw new Error(`${failures} test(s) failed.`);
  }
}
