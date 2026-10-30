import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const modules = fileURLToPath(new URL('./node_modules', import.meta.url))
const monacoDir = join(modules, 'monaco-editor')
const monacoVimDir = join(modules, 'monaco-vim')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // monaco-vim imports Monaco's files by their old paths (monaco-editor/esm/vs/...), which
      // Monaco's package exports no longer map; point them at the files. Its "browser" build
      // is an old bundle, so use its ES module build.
      { find: /^monaco-editor\/esm\/(.*?)(\.js)?$/, replacement: join(monacoDir, 'esm/$1.js') },
      { find: /^monaco-vim$/, replacement: join(monacoVimDir, 'dist/index.mjs') },
    ],
  },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 8000 },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
    // For working on the UI in a browser: server/ answers what the Wails runtime would.
    proxy: { '/api': { target: 'http://127.0.0.1:34115', changeOrigin: true } },
  },
})
