/* global __dirname */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Dev only. Some shared helpers are CommonJS modules the client also imports:
// `shared/catalog-arity.cjs` (with a thin ESM shim) and `shared/lens-bridge.js`
// (which sets `module.exports` for Node, `window.LensBridge` for a plain
// <script>, and is imported by the IDE client). The production build resolves
// both — Rolldown applies CommonJS interop — but the dev server serves them
// verbatim, so the browser sees `module.exports` and no ESM exports. The import
// then fails ("does not provide an export named …") and the app renders blank.
//
// Wrap such a file in a CommonJS scope and re-export its exports the way Node
// and the build do: `module.exports` as the default, plus named exports for the
// keys we can read statically. Anything we cannot parse still gets the default.
const projectRoot = path.resolve(__dirname, '..')

function namedExportsFor(code) {
  const assign = code.match(/module\.exports\s*=\s*(\{[\s\S]*?\}|[A-Za-z_$][\w$]*)/)
  if (!assign) return ''
  let literal = assign[1]
  if (!literal.startsWith('{')) {
    const obj = code.match(new RegExp(`(?:const|let|var)\\s+${literal}\\s*=\\s*\\{([\\s\\S]*?)\\}`))
    if (!obj) return ''
    literal = `{${obj[1]}}`
  }
  const keys = literal.slice(1, -1)
    .split(',')
    .map(s => s.trim().split(':')[0].trim())
    .filter(k => /^[A-Za-z_$][\w$]*$/.test(k))
  const unique = [...new Set(keys)]
  return unique.map(k => `export const ${k} = module.exports.${k};`).join('\n')
}

function cjsInteropForDev() {
  return {
    name: 'cjs-interop-dev',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file.startsWith(projectRoot)) return null
      // A `.cjs` file, or a `.js` file that is plainly CommonJS (writes
      // module.exports and has no ESM export of its own).
      const isCjs = file.endsWith('.cjs')
      const isCjsJs = /\bmodule\.exports\b/.test(code) && !/^\s*export\s/m.test(code)
      if (!isCjs && !isCjsJs) return null
      return {
        code: [
          'const module = { exports: {} };',
          'const exports = module.exports;',
          ';(function () {',
          code,
          '})();',
          'export default module.exports;',
          namedExportsFor(code),
        ].join('\n'),
        map: null,
      }
    },
  }
}

export default defineConfig({
  plugins: [cjsInteropForDev(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@':      path.resolve(__dirname, './src'),
      '@core':  path.resolve(__dirname, '../core'),
      '@shared': path.resolve(__dirname, '../shared'),
      // the shared pivot (shared/pivot) imports AG Grid — resolve it from here, one copy
      'ag-grid-community': path.resolve(__dirname, 'node_modules/ag-grid-community'),
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
