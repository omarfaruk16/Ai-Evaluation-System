import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// Built into console/dist and served by the API at /console. In development the console runs on
// :5180 and proxies /admin-api to the API on :4200 (override with AMS_API_URL).
export default defineConfig({
  base: '/console/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5180,
    strictPort: true,
    proxy: { '/admin-api': { target: process.env.AMS_API_URL ?? 'http://localhost:4200', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
