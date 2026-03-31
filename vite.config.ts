import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      '/api/kalshi': {
        target: 'https://api.elections.kalshi.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kalshi/, '/trade-api/v2'),
      },
      '/api/market': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/orders': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/portfolio': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/health': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/ws': { target: 'http://localhost:3001', changeOrigin: true, ws: true },
    },
  },
})
