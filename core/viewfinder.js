'use strict'

// ── Viewfinder — Lens templates ──────────────────────────────────────────────
// Proven Lens code that many Lenses share: a Lens built from a template stores
// only { template: 'input-form' } plus its config; its code is the template's,
// fetched when it opens — so improving a template improves every Lens built
// from it. Templates ship with the IDE and Lens app (shared/viewfinder/<name>.
// html + <name>.json: title, description, icon, what each setting means, and
// an example config to start from).
const fs   = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'shared', 'viewfinder')

function listTemplates(dir = DIR) {
    let files = []
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return [] }
    return files.map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } })
        .filter(t => t && t.name && fs.existsSync(path.join(dir, t.name + '.html')))
        .sort((a, b) => String(a.title).localeCompare(String(b.title)))
}

function readTemplate(name, dir = DIR) {
    if (!/^[a-z0-9-]+$/.test(String(name ?? ''))) throw new Error(`Unknown Viewfinder template "${name}"`)
    const file = path.join(dir, `${name}.html`)
    if (!fs.existsSync(file)) throw new Error(`Unknown Viewfinder template "${name}"`)
    return fs.readFileSync(file, 'utf8')
}

// The code a Lens runs: its template's, or its own.
function lensHtml(doc, dir = DIR) {
    return doc?.template ? readTemplate(doc.template, dir) : (doc?.html ?? '')
}

module.exports = { listTemplates, readTemplate, lensHtml, DIR }
