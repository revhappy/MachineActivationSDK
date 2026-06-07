import { formatBytes } from '../../src/core/formatBytes';
import { assertEqual, test } from '../_harness';

test('formatBytes: small values stay in bytes', () => {
  assertEqual(formatBytes(0), '0 B');
  assertEqual(formatBytes(512), '512 B');
});

test('formatBytes: kilobytes at the KB boundary', () => {
  assertEqual(formatBytes(1024), '1.0 KB');
  assertEqual(formatBytes(1024 * 500), '500 KB');
});

test('formatBytes: megabytes and gigabytes', () => {
  assertEqual(formatBytes(1024 * 1024), '1.0 MB');
  assertEqual(formatBytes(1024 * 1024 * 1024 * 3), '3.0 GB');
});

test('formatBytes: invalid input returns em dash', () => {
  assertEqual(formatBytes(Number.NaN), '—');
  assertEqual(formatBytes(-1), '—');
});
