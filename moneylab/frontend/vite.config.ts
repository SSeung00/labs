import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// One id per build. The app compares it with /version.json to notice a newer build
// (e.g. a phone that kept MoneyLab open while the PC rebuilt it).
const BUILD_ID = new Date().toISOString()

function versionFile(): Plugin {
  return {
    name: 'moneylab-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
    },
  }
}

export default defineConfig({
  // Explicit root so the dev server works when launched from the repo root.
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // dist/.vite/manifest.json lists every bundle; the service worker precaches them for offline use.
  build: { manifest: true },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8001',
    },
  },
})
