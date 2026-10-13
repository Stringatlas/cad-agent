import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
const proxy = { '/datasets/': { target: 'http://127.0.0.1:3001' } };
export default defineConfig({
  plugins: [svelte()],
  server: { port: 5173, strictPort: true, proxy },
  preview: { proxy },
});
