'use strict'

// ── Viewfinder — Lens templates ──────────────────────────────────────────────
// Proven Lens code that many Lenses share: a Lens built from a template stores
// only { template: 'input-form' } plus its config. Built-in templates ship with
// the IDE (shared/viewfinder/<name>.html + <name>.json: title, description,
// icon, what each setting means, and an example config to start from).
//
// Everything the model needs goes with the model: when a Lens using a built-in
// template is saved, that template is COPIED into the model (Applications/
// Governance/Viewfinder — like Bedrock in every TM1 server), and from then on
// the model's copy is what its Lenses run. So a Lens deploys with the exact
// template it was built on, and PROD only changes through a release. A newer
// built-in reaches the model only when someone deliberately updates the copy
// (updateBuiltInCopy), which is recorded in the change set like any change.
const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')

// Short fingerprint of a template's code — tells a model copy apart from a newer built-in.
const fingerprint = html => crypto.createHash('sha256').update(String(html ?? '')).digest('hex').slice(0, 12)

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

// Every template this server's Lenses can use: built-ins first, then the model's
// own. A built-in the model holds a copy of is shown once, with the code the
// model actually runs (its copy) and whether a newer built-in is available.
async function listAll(server, opts = {}) {
    const model = await listModelTemplates(server, opts)
    const copies = new Map(model.filter(d => d.builtIn).map(d => [d.name, d]))
    const builtIn = listTemplates().map(t => {
        const disk = readTemplate(t.name)
        const copy = copies.get(t.name)
        return copy
            ? { ...t, source: 'built-in', html: copy.html, inModel: true, copyVersion: copy.version, newerBuiltIn: copy.builtInFingerprint !== fingerprint(disk) }
            : { ...t, source: 'built-in', html: disk, inModel: false, newerBuiltIn: false }
    })
    return [...builtIn, ...model.filter(d => !d.builtIn)]
}

// The template a Lens runs: the model's copy when it has one (built-in copies and
// the site's own templates), else the built-in on disk (a Lens not yet saved
// since templates were copied into models).
async function findTemplate(server, name, opts = {}) {
    if (!/^[a-z0-9-]+$/.test(String(name ?? ''))) throw new Error(`Unknown Viewfinder template "${name}"`)
    const doc = await store.readDoc(server, AREA, `${name}.json`, opts).catch(() => null)
    if (doc?.html) return { ...doc, source: doc.builtIn ? 'built-in copy' : 'model' }
    if (isBuiltIn(name)) return { name, source: 'built-in', html: readTemplate(name) }
    throw new Error(`Unknown Viewfinder template "${name}"`)
}

// Copy a built-in template into the model (if it isn't there yet). Returns the
// copy's details and copied: true when this call wrote it, so the caller can
// record it in the change set.
async function copyBuiltInToModel(server, name, owner, opts = {}) {
    if (!isBuiltIn(name)) return null
    const existing = await store.readDoc(server, AREA, `${name}.json`, opts).catch(() => null)
    if (existing?.html) { const { html: _h, ...d } = existing; return { ...d, copied: false } }
    return { ...(await _writeCopy(server, name, owner, null, opts)), copied: true }
}

// Replace the model's copy with the current built-in — deliberately, because it
// changes every Lens in this model that uses the template.
async function updateBuiltInCopy(server, name, owner, opts = {}) {
    if (!isBuiltIn(name)) throw new Error(`"${name}" is not a built-in template`)
    const existing = await store.readDoc(server, AREA, `${name}.json`, opts).catch(() => null)
    return _writeCopy(server, name, owner, existing, opts)
}

async function _writeCopy(server, name, owner, existing, opts) {
    const meta = listTemplates().find(t => t.name === name)
    const html = readTemplate(name)
    const doc = {
        ...meta,
        html,
        builtIn: true,
        builtInFingerprint: fingerprint(html),
        version: (Number(existing?.version) || 0) + 1,
        updated: new Date().toISOString(),
        owner: owner ?? 'unknown',
    }
    await store.writeDoc(server, AREA, `${name}.json`, doc, opts)
    const { html: _h, ...details } = doc
    return details
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
    if (isBuiltIn(name)) throw new Error(`"${name}" is a built-in template — its copy in the model stays while Lenses use it`)
    await store.deleteDoc(server, AREA, `${name}.json`, opts)
}

module.exports = { listTemplates, readTemplate, lensHtml, listAll, findTemplate, codeOf, saveModelTemplate, deleteModelTemplate, copyBuiltInToModel, updateBuiltInCopy, isBuiltIn, fingerprint, DIR }
