// Removes symlinked workspace deps before electron-builder packages the app.
// Main process is bundled with esbuild, so the @machine/* deps are inlined into
// dist/electron/main.js. The symlinks would otherwise point outside the app
// root and trip electron-builder's path-must-be-under-app-root assertion.

const fs = require('node:fs');
const path = require('node:path');

const targets = [
  path.join(__dirname, '..', 'node_modules', '@machine', 'activation-sdk'),
  path.join(__dirname, '..', 'node_modules', '@machine', 'ui'),
];

for (const target of targets) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(target);
      console.log(`[prepackage] removed symlink: ${target}`);
    } else if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[prepackage] removed directory: ${target}`);
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') continue;
    throw err;
  }
}

const machineDir = path.join(__dirname, '..', 'node_modules', '@machine');
try {
  const entries = fs.readdirSync(machineDir);
  if (entries.length === 0) {
    fs.rmdirSync(machineDir);
    console.log(`[prepackage] removed empty directory: ${machineDir}`);
  }
} catch (err) {
  if (err && err.code === 'ENOENT') {
    /* already gone */
  } else {
    throw err;
  }
}
