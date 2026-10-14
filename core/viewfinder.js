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

// The code a Lens runs, when only built-ins are known (no server to ask): its
// built-in template's, a model template's already looked up (doc._code), or
// its own.
function lensHtml(doc, dir = DIR) {
    if (doc?._code !== undefined) return doc._code
    if (!doc?.template) return doc?.html ?? ''
    try { return readTemplate(doc.template, dir) } catch { return '' }
}

// ── Model templates — a site's own, saved in the model next to its Lenses ────
// (Applications/Governance/Viewfinder/<name>.json: the code plus title,
// description, icon, settings help and example), so they travel with the model
// and are recorded in change sets like Lenses. Names never clash with built-ins.
const store = require('./model-store')
const AREA = 'viewfinder'
const isBuiltIn = name => listTemplates().some(t => t.name === name)

async function listModelTemplates(server, opts = {}) {
    let names = []
    try { names = (await store.listDocs(server, AREA, opts)).filter(n => n.endsWith('.json')) } catch { return [] }
    const out = []
    for (const n of names) {
        const doc = await store.readDoc(server, AREA, n, opts).catch(() => null)
        if (doc?.name && doc.html) out.push({ ...doc, source: 'model' })
    }
    return out
}

// Every template this server's Lenses can use: built-ins first, then the model's.
async function listAll(server, opts = {}) {
    const builtIn = listTemplates().map(t => ({ ...t, source: 'built-in', html: readTemplate(t.name) }))
    return [...builtIn, ...(await listModelTemplates(server, opts))]
}

async function findTemplate(server, name, opts = {}) {
    if (isBuiltIn(name)) return { name, source: 'built-in', html: readTemplate(name) }
    if (!/^[a-z0-9-]+$/.test(String(name ?? ''))) throw new Error(`Unknown Viewfinder template "${name}"`)
    const doc = await store.readDoc(server, AREA, `${name}.json`, opts).catch(() => null)
    if (!doc?.html) throw new Error(`Unknown Viewfinder template "${name}"`)
    return { ...doc, source: 'model' }
}

// The code a Lens runs, asking the server for a model template.
async function codeOf(server, doc, opts = {}) {
    if (!doc?.template) return doc?.html ?? ''
    return (await findTemplate(server, doc.template, opts)).html
}

async function saveModelTemplate(server, name, { html, title, description, icon, color, settings, example } = {}, owner, opts = {}) {
    if (!/^[a-z0-9-]+$/.test(String(name ?? ''))) throw new Error('Template names use lower-case letters, digits and -, e.g. pnl-review')
    if (isBuiltIn(name)) throw new Error(`"${name}" is a built-in template — choose another name`)
    if (typeof html !== 'string' || !html.trim()) throw new Error('A template needs its code')
    const existing = await store.readDoc(server, AREA, `${name}.json`, opts).catch(() => null)
    const doc = {
        name,
        title: String(title ?? existing?.title ?? name).slice(0, 120),
        description: String(description ?? existing?.description ?? '').slice(0, 500),
        icon: icon ?? existing?.icon ?? '',
        color: color ?? existing?.color ?? '',
        settings: settings ?? existing?.settings ?? {},
        example: example ?? existing?.example ?? {},
        html,
        version: (Number(existing?.version) || 0) + 1,
        updated: new Date().toISOString(),
        owner: owner ?? 'unknown',
    }
    await store.writeDoc(server, AREA, `${name}.json`, doc, opts)
    const { html: _h, ...details } = doc
    return details
}

async function deleteModelTemplate(server, name, opts = {}) {
    if (isBuiltIn(name)) throw new Error(`"${name}" is a built-in template and can't be deleted`)
    await store.deleteDoc(server, AREA, `${name}.json`, opts)
}

module.exports = { listTemplates, readTemplate, lensHtml, listAll, findTemplate, codeOf, saveModelTemplate, deleteModelTemplate, DIR }
