import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  appType: 'spa',
  plugins: [react()],
  resolve: {
    alias: [{ find: '@', replacement: '/src' }]
  },
  server: {
    port: 5173,
    proxy: {
      // REST and WebSocket (/api/v1/ws/*) both go to the FastAPI backend
      '/api': {
        target: 'http://127.0.0.1:8000',
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
