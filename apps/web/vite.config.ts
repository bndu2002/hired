/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite + Vitest config, merged.
 *
 * Dev server binds to 127.0.0.1 (never 0.0.0.0) so we don't accidentally
 * expose the dashboard on the local network. The server package also binds
 * loopback-only for the same reason — see design.md § 11.
 *
 * `/api` proxies to the Node server during dev so the browser treats
 * fetches as same-origin and no CORS dance is needed.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: false,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
});
