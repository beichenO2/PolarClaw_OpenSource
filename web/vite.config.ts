import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const polarClawPort = process.env.POLARCLAW_WEB_PORT || '3910'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/mc/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5181,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${polarClawPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-worker': ['pdfjs-dist'],
        },
      },
    },
  },
}))
