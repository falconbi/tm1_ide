/* global __dirname */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@':      path.resolve(__dirname, './src'),
      '@core':  path.resolve(__dirname, '../core'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  // Build straight into the folder the server serves, clearing it first —
  // copying bundles in by hand left every old build behind.
  build: {
    outDir: '../static',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8083',
    },
  },
})
