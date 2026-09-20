import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  appType: 'spa',
  plugins: [react()],
  resolve: {
    alias: [{ find: '@', replacement: '/src' }]
  },
  build: {
    rollupOptions: {
      output: {
        // The map engine is by far the heaviest dependency and changes far less often than the
        // app. Splitting it (and the React runtime) out keeps both in the browser cache across
        // deploys instead of re-downloading them with every app change -- it matters on the
        // mobile connections this PWA is used on.
        manualChunks: {
          maplibre: ['maplibre-gl'],
          react: ['react', 'react-dom', 'react-router-dom']
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      // REST and WebSocket (/api/v1/ws/*) both go to the FastAPI backend.
      // start.sh / start.cmd set VITE_DEV_API_TARGET when they move the API off its default port.
      '/api': {
        target: process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: true
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts']
  }
} as any)
