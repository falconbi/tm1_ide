/* global __dirname */
// Builds the Lens toolkit (shared/lens-kit) into one self-contained script,
// static/lens-kit/lens-kit.js, served by the IDE and the Lens app. Runs after
// the main build (which empties static/), so the kit is never wiped.
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: {
    // the kit lives outside client/, but its libraries are installed here
    alias: {
      echarts: path.resolve(__dirname, 'node_modules/echarts'),
      'ag-grid-community': path.resolve(__dirname, 'node_modules/ag-grid-community'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      '@xyflow/react': path.resolve(__dirname, 'node_modules/@xyflow/react'),
      '@dagrejs/dagre': path.resolve(__dirname, 'node_modules/@dagrejs/dagre'),
      '@alpinejs/csp': path.resolve(__dirname, 'node_modules/@alpinejs/csp'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../static/lens-kit'),
    emptyOutDir: true,
    copyPublicDir: false,
    lib: {
      entry: path.resolve(__dirname, '../shared/lens-kit/index.js'),
      name: 'LensKit',
      formats: ['iife'],
      fileName: () => 'lens-kit.js',
    },
  },
})
