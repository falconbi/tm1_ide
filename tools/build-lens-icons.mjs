// Builds shared/lens-icons.json — the icon set Lenses can use on the Lens app
// home page — from Lucide (ISC licence, already the IDE's icon set), so the
// Lens app draws them itself and nothing loads from the internet.
// Run from the repo root:  node tools/build-lens-icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ICONS = ['chart-column', 'chart-line', 'chart-pie', 'gauge', 'trending-up', 'presentation', 'layers', 'table',
  'pencil-line', 'square-pen', 'circle-check', 'shield-check', 'workflow', 'target', 'scale', 'sparkles',
  'wallet', 'dollar-sign', 'coins', 'briefcase', 'users', 'building-2', 'store', 'truck', 'package',
  'map', 'globe', 'calendar', 'clock', 'file-text', 'rocket']

const dir = path.resolve('client/node_modules/lucide-react/dist/esm/icons')
const version = JSON.parse(fs.readFileSync(path.resolve('client/node_modules/lucide-react/package.json'), 'utf8')).version
const out = { _about: `Lens icons — from Lucide (lucide-react ${version}), ISC licence (see THIRD_PARTY_LICENSES.md). 24×24, stroke icons. Rebuild with node tools/build-lens-icons.mjs.` }
for (const name of ICONS) {
  const mod = await import(pathToFileURL(path.join(dir, name + '.mjs')).href)
  out[name] = mod.__iconNode.map(([tag, attrs]) => { const { key: _k, ...rest } = attrs; return [tag, rest] })
}
fs.writeFileSync(path.resolve('shared/lens-icons.json'), JSON.stringify(out, null, 1) + '\n')
console.log(`shared/lens-icons.json: ${ICONS.length} icons`)
