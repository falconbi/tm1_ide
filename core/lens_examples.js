'use strict'

// ── Lens examples — reference code for building Lenses ──────────────────────
// Every client's Lenses are built to fit their own process from the shared
// toolkit components (shared/lens-kit) — there are no prebuilt templates. These
// examples (shared/lens-examples/<name>.html + <name>.json: what it shows and an
// example config) are working Lenses for the AI and developers to learn from
// and copy ideas out of. A Lens never points at an example: its code is its own,
// stored in the model with it.
const fs   = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'shared', 'lens-examples')

function listExamples(dir = DIR) {
    let files = []
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return [] }
    return files.map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } })
        .filter(t => t && t.name && fs.existsSync(path.join(dir, t.name + '.html')))
        .sort((a, b) => String(a.title).localeCompare(String(b.title)))
}

function readExample(name, dir = DIR) {
    if (!/^[a-z0-9-]+$/.test(String(name ?? ''))) throw new Error(`Unknown Lens example "${name}"`)
    const file = path.join(dir, `${name}.html`)
    if (!fs.existsSync(file)) throw new Error(`Unknown Lens example "${name}"`)
    return fs.readFileSync(file, 'utf8')
}

module.exports = { listExamples, readExample, DIR }
