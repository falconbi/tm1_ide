'use strict'

// ── Lens store — Lenses live in the model ─────────────────────────────────────
// One JSON document per Lens under Applications/Governance/Lenses/<name>.json,
// holding the HTML and its details together (one source of truth — no second
// metadata copy). Reuses core/model-store.js, the same storage as tests, change
// sets and approvals. There is no local storage: a private model's Lenses stay
// with the model and can never land in the IDE's (public) repo.

const store = require('./model-store')

const AREA = 'lenses'

// Bumped when the bridge/toolkit contract changes, so the Lens app can refuse a
// Lens it can't run (LENS_APP_PLAN.md — version check).
const TOOLKIT_VERSION = 1

function safeName(name) {
    const n = String(name ?? '').trim()
    if (!/^[a-zA-Z0-9_-]+$/.test(n)) throw new Error(`Invalid lens name "${n}" — use letters, digits, - or _`)
    return n
}

const docName = name => `${safeName(name)}.json`

// Details only (no HTML) for every Lens in this server's model, sorted by name.
async function listLenses(server, { ideToken } = {}) {
    const names = (await store.listDocs(server, AREA, { ideToken })).filter(n => n.endsWith('.json'))
    const out = []
    for (const n of names) {
        const doc = await store.readDoc(server, AREA, n, { ideToken })
        if (!doc) continue
        const { html: _html, ...details } = doc
        out.push(details)
    }
    return out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

// One Lens, HTML included. Missing is an error.
async function readLens(server, name, { ideToken } = {}) {
    const doc = await store.readDoc(server, AREA, docName(name), { ideToken })
    if (!doc) throw new Error(`Lens "${safeName(name)}" not found on ${server}`)
    return doc
}

// Create or update a Lens. The version counts up on every save; created/createdBy
// are kept from the first save. Throws if the model can't be written.
async function saveLens(server, name, html, owner, { publish = false, description, ideToken } = {}) {
    const safe = safeName(name)
    const existing = await store.readDoc(server, AREA, docName(safe), { ideToken })
    const now = new Date().toISOString()
    const doc = {
        name:           safe,
        status:         publish ? 'published' : 'draft',
        owner:          owner ?? 'unknown',
        version:        (Number(existing?.version) || 0) + 1,
        updated:        now,
        description:    description ?? existing?.description ?? '',
        created:        existing?.created ?? now,
        createdBy:      existing?.createdBy ?? owner ?? 'unknown',
        toolkitVersion: TOOLKIT_VERSION,
        html,
    }
    await store.writeDoc(server, AREA, docName(safe), doc, { ideToken })
    const { html: _html, ...details } = doc
    return details
}

async function deleteLens(server, name, { ideToken } = {}) {
    await store.deleteDoc(server, AREA, docName(name), { ideToken })
}

module.exports = { safeName, listLenses, readLens, saveLens, deleteLens, TOOLKIT_VERSION }
