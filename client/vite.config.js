import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API server runs separately (see /server); dev proxy keeps the client
// talking to relative /api paths in both dev and the production Docker image.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
