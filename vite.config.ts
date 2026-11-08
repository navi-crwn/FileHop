import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: { port: 5179, strictPort: true },
  preview: { port: 4179, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200
  }
});
