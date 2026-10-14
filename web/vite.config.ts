import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'serve-the-exported-deployment-in-development',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0];
        if (!/^\/(?:imd-deployment\.json|history-start\.json|abi\/[A-Za-z0-9_-]+\.json)$/.test(pathname)) return next();
        try {
          const bytes = await readFile(resolve(import.meta.dirname, '../dist', pathname.slice(1)));
          res.setHeader('Content-Type', 'application/json');
          res.end(bytes);
        } catch { res.statusCode = 503; res.end('Build the static export before starting development.'); }
      });
    },
  }],
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1100 },
});
