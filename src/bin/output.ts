/** Output helpers for the `machine` CLI. */

const NO_COLOR = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '';

function colorEnabled(stream: NodeJS.WriteStream): boolean {
  if (NO_COLOR) return false;
  return Boolean(stream.isTTY);
}

function paint(stream: NodeJS.WriteStream, code: string, text: string): string {
  return colorEnabled(stream) ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function println(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function errorln(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function bold(text: string, stream: NodeJS.WriteStream = process.stdout): string {
  return paint(stream, '1', text);
}

export function dim(text: string, stream: NodeJS.WriteStream = process.stdout): string {
  return paint(stream, '2', text);
}

export function red(text: string, stream: NodeJS.WriteStream = process.stderr): string {
  return paint(stream, '31', text);
}

export function green(text: string, stream: NodeJS.WriteStream = process.stdout): string {
  return paint(stream, '32', text);
}

export function yellow(text: string, stream: NodeJS.WriteStream = process.stdout): string {
  return paint(stream, '33', text);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Format bytes as human-readable. 1234 → "1.21 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}
