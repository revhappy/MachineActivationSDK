import { formatTokensPerSecond } from '../../src/core/formatTokensPerSecond';
import { assertEqual, test } from '../_harness';

test('formatTokensPerSecond: zero and non-finite', () => {
  assertEqual(formatTokensPerSecond(0), '0 tok/s');
  assertEqual(formatTokensPerSecond(-5), '0 tok/s');
  assertEqual(formatTokensPerSecond(Number.NaN), '0 tok/s');
});

test('formatTokensPerSecond: small values get two decimals', () => {
  assertEqual(formatTokensPerSecond(2.5), '2.50 tok/s');
  assertEqual(formatTokensPerSecond(9.87), '9.87 tok/s');
});

test('formatTokensPerSecond: large values round to integer', () => {
  assertEqual(formatTokensPerSecond(123), '123 tok/s');
  assertEqual(formatTokensPerSecond(99.4), '99.4 tok/s');
});
