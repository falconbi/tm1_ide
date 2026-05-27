import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@':    path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, '../core'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8083',
    },
  },
})
