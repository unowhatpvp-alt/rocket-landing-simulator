import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/work/**', '**/.cache/**', '**/.pnpm-store/**', '**/assets/**', '**/docs/**'] },
  },
  preview: { host: '127.0.0.1', port: 4287, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
});
