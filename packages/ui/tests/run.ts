import './core/formatBytes.test';
import './core/formatTokensPerSecond.test';
import './core/useCartridgeFilter.test';
import { finish } from './_harness';

void finish().then(
  () => {
    process.exitCode = 0;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
