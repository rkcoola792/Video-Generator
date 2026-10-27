import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  cacheDir: '.data/vite-cache',
  server: { proxy: { '/api': 'http://127.0.0.1:4174' } },
});
