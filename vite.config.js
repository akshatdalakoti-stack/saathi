import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The React app lives in /client. In development, API calls are forwarded to the Node server on port 3000.
export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/act': 'http://localhost:3000',
      '/card': 'http://localhost:3000',
    },
  },
});
