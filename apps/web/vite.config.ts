import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
const proxy = {
  '^/auth/status$': { target: 'http://127.0.0.1:3001', changeOrigin: false },
  '^/auth/logout$': { target: 'http://127.0.0.1:3001', changeOrigin: false },
  '/datasets/': { target: 'http://127.0.0.1:3001' },
  '/project': { target: 'http://127.0.0.1:3001' },
  '/chat/': { target: 'http://127.0.0.1:3001' },
};
export default defineConfig({
  plugins: [svelte()],
  server: { port: 5173, strictPort: true, proxy },
  preview: { proxy },
});
