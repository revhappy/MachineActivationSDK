export function formatTokensPerSecond(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 tok/s';
  if (value >= 100) return `${Math.round(value)} tok/s`;
  if (value >= 10) return `${value.toFixed(1)} tok/s`;
  return `${value.toFixed(2)} tok/s`;
}
