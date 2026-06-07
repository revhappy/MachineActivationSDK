#!/usr/bin/env node
import { run } from '../run';
import { errorln, red } from '../output';

run(process.argv.slice(2)).then(
  (code) => {
    process.exit(code);
  },
  (err: unknown) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    errorln(red(`create-machine-app: unexpected error\n${msg}`));
    process.exit(1);
  },
);
