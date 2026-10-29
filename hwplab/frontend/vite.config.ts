import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/katex/.test(id)) return 'katex'
          if (/@tiptap|prosemirror|orderedmap|rope-sequence|w3c-keyname/.test(id)) return 'editor'
          return undefined
        },
      },
    },
  },
  server: {
    port: 5177,
    strictPort: true,
    // 127.0.0.1, not localhost: on Windows "localhost" tries IPv6 first and adds ~200 ms per request.
    proxy: { '/api': { target: 'http://127.0.0.1:8004', changeOrigin: false } },
  },
})
