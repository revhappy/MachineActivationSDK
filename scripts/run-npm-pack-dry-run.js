const { spawnSync } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Workspaces ordered the same way they should be published:
//   1. activation-sdk (root) — every other package transitively references it
//   2. ui — peer-depends on activation-sdk
//   3. create-machine-app — no runtime dep, scaffolder
//   4. activation-capacitor — peer-depends on activation-sdk
const workspaces = [
  { name: 'machineai-activation', cwd: rootDir },
  { name: 'machineai-activation-ui', cwd: path.join(rootDir, 'packages', 'ui') },
  { name: 'create-machineai-app', cwd: path.join(rootDir, 'packages', 'create-machine-app') },
  { name: 'machineai-activation-capacitor', cwd: path.join(rootDir, 'packages', 'activation-capacitor') },
];

const sharedEnv = {
  ...process.env,
  npm_config_cache: path.join(rootDir, '.npm-cache'),
};

let failures = 0;
for (const ws of workspaces) {
  console.log(`\n=== npm pack --dry-run for ${ws.name} ===`);
  const result = spawnSync(npmExecutable, ['pack', '--dry-run'], {
    cwd: ws.cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: sharedEnv,
  });
  if (result.error) {
    console.error(`error packing ${ws.name}:`, result.error);
    failures += 1;
    continue;
  }
  const status = result.status ?? 1;
  if (status !== 0) {
    console.error(`pack --dry-run for ${ws.name} exited with status ${status}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\n${failures} workspace(s) failed npm pack --dry-run.`);
  process.exit(1);
}

console.log(`\nAll ${workspaces.length} workspaces passed npm pack --dry-run.`);
process.exit(0);
