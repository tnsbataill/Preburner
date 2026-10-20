/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { preburnerPwaPlugin } from './scripts/pwaPlugin.ts';

export default defineConfig({
  base: './',
  plugins: [react(), preburnerPwaPlugin()],
  // node_modules is a symlink to node_modules.nosync (kept out of iCloud).
  // Vite only skips folders named node_modules, so iCloud touching files in
  // the real folder forced full page reloads mid-session.
  server: { watch: { ignored: ['**/node_modules.nosync/**', '**/test-results/**'] } },
  test: { include: ['src/**/*.test.ts'] },
});
