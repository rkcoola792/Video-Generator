import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  cacheDir: '.data/vite-cache',
  server: { proxy: { '/api': 'http://localhost:4174' } },
});
