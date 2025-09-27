import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { preburnerPwaPlugin } from './scripts/pwaPlugin.ts';

export default defineConfig({
  base: './',
  plugins: [react(), preburnerPwaPlugin()],
});
