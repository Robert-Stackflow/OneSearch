import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5178,
    strictPort: true,
    watch: {
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    },
    proxy: { '/api': { target: 'http://127.0.0.1:7800', changeOrigin: false } },
  },
  build: { outDir: '../dist/web', emptyOutDir: true },
});
