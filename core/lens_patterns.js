'use strict'

// ── Lens patterns — reference code for building Lenses ──────────────────────
// Every client's Lenses are built to fit their own process from the shared
// toolkit components (shared/lens-kit) — there are no prebuilt templates. These
// patterns (shared/lens-patterns/<name>.html + <name>.json: what it shows and a
// sample config) are worked demonstrations for the AI and developers to learn
// from. A Lens never points at a pattern: its code is its own, stored in the
// model with it.
const fs   = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'shared', 'lens-patterns')

function listPatterns(dir = DIR) {
    let files
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return [] }
    return files.map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } })
        .filter(t => t && t.name && fs.existsSync(path.join(dir, t.name + '.html')))
        .sort((a, b) => String(a.title).localeCompare(String(b.title)))
}

function readPattern(name, dir = DIR) {
    if (!/^[a-z0-9-]+$/.test(String(name ?? ''))) throw new Error(`Unknown Lens pattern "${name}"`)
    const file = path.join(dir, `${name}.html`)
    if (!fs.existsSync(file)) throw new Error(`Unknown Lens pattern "${name}"`)
    return fs.readFileSync(file, 'utf8')
}

module.exports = { listPatterns, readPattern, DIR }
