import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import * as fs from 'node:fs';
import * as path from 'node:path';

function copyMediaPipeWasm(): Plugin {
  const srcDir = path.resolve(__dirname, 'node_modules/@mediapipe/tasks-genai/wasm');
  return {
    name: 'copy-mediapipe-wasm',
    apply: 'build',
    generateBundle() {
      if (!fs.existsSync(srcDir)) return;
      for (const file of fs.readdirSync(srcDir)) {
        const fullPath = path.join(srcDir, file);
        const buf = fs.readFileSync(fullPath);
        this.emitFile({
          type: 'asset',
          fileName: `mediapipe-wasm/${file}`,
          source: buf,
        });
      }
    },
    configureServer(server) {
      // Serve the wasm from node_modules during dev under /mediapipe-wasm/*
      server.middlewares.use('/mediapipe-wasm', (req, res, next) => {
        const reqPath = (req.url ?? '/').split('?')[0];
        const file = path.join(srcDir, reqPath);
        if (!file.startsWith(srcDir) || !fs.existsSync(file)) return next();
        res.setHeader(
          'Content-Type',
          file.endsWith('.wasm') ? 'application/wasm' : 'application/javascript',
        );
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), copyMediaPipeWasm()],
  base: './',
  root: 'src',
  resolve: {
    preserveSymlinks: true,
  },
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
