'use strict'

// ── Per-target deploy protection settings ───────────────────────────────────
// What has to happen on a target before a deploy is allowed to overwrite it:
// a backup process to run (the site's admin writes it), or nothing automated —
// in which case the deploy asks the person when the last backup was taken.
//
// Stored with the other governance records: the target's own model when its
// deploy state is model-owned, the local file otherwise. One setting today;
// a document rather than a column so the next one does not need a migration.

const fs = require('fs')
const path = require('path')

const FILE = path.join(require('./data-dir').DATA_DIR, 'deploy-settings.json')
const AREA = 'lock'          // the Deployments folder, no fixed document name
const DOC = 'settings.json'
const EMPTY = { backupProcess: null }

function loadLocal() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}
function saveLocal(d) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(d, null, 2))
}

async function modelOwned(server, { ideToken } = {}) {
    try { return await require('./model-store').isMigrated(server, 'deployState', { ideToken }) } catch { return false }
}

function normalise(doc) {
    // Part N.5: the Protection attribute list is retired. Attributes are handled by
    // the release's own recorded plan (Part G.7); an old attributeValues field is
    // ignored rather than consulted.
    return { backupProcess: doc?.backupProcess ? String(doc.backupProcess) : null }
}

async function get(server, { ideToken } = {}) {
    if (!server) return { ...EMPTY }
    if (await modelOwned(server, { ideToken })) {
        const store = require('./model-store')
        const doc = await store.readOptional(server, AREA, DOC, { ideToken })
        if (doc) return normalise(doc)
    }
    return normalise(loadLocal()[server])
}

async function set(server, patch = {}, { ideToken } = {}) {
    if (!server) throw new Error('server required')
    const current = await get(server, { ideToken })
    // An omitted field keeps its value: saving one setting must not silently wipe
    // another (clearing attributeValues once nulled the backup process this way).
    const doc = normalise({
        backupProcess: patch.backupProcess === undefined ? current.backupProcess : patch.backupProcess,
    })
    const d = loadLocal()
    d[server] = { ...(d[server] ?? {}), ...doc }
    saveLocal(d)
    if (await modelOwned(server, { ideToken })) {
        const store = require('./model-store')
        await store.writeDoc(server, AREA, DOC, doc, { ideToken })
    }
    return doc
}

module.exports = { get, set, FILE, EMPTY }
