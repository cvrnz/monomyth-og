import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 8000 },
  server: {
    // For working on the UI in a browser: cmd/devserver answers what the Wails runtime would.
    proxy: { '/api': { target: 'http://127.0.0.1:34115', changeOrigin: true } },
  },
})
