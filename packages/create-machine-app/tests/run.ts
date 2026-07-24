import './scaffold.test';
import './node-script.test';
import './expo-local-chat.test';
import './rn-cli-local-chat.test';
import './next-local-chat.test';
import './electron-local-chat.test';
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
