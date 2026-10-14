import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { preburnerPwaPlugin } from './scripts/pwaPlugin.ts';

const devSnapshotPlugin = {
  name: 'preburner-dev-snapshot-writer',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__dev/save-snapshot', (req, res, next) => {
      if (req.method !== 'POST') {
        next();
        return;
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body) as { fileName?: string; data: unknown };
          const fileName = payload.fileName?.replace(/[^\w.-]/g, '-') || `planner-snapshot-${Date.now()}.json`;
          const dir = path.resolve(server.config.root ?? process.cwd(), 'src/samples/snapshots');
          fs.mkdirSync(dir, { recursive: true });
          const filePath = path.join(dir, fileName);
          fs.writeFileSync(filePath, JSON.stringify(payload.data, null, 2), 'utf-8');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, path: path.relative(server.config.root ?? process.cwd(), filePath) }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Failed to save snapshot' }));
        }
      });
    });
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), preburnerPwaPlugin(), devSnapshotPlugin],
});
