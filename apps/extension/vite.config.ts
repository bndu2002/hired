import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    rollupOptions: {
      // Suppress noisy warnings about Chrome extension globals
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION') return;
        warn(warning);
      },
    },
  },
});
