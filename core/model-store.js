'use strict'

// ── Model governance store ───────────────────────────────────────────────────
// The model owns its governance records: change sets, approvals and deploy
// history live as documents under Applications/Governance, exactly the way
// assertions already do (v11 Application Documents — .blob / Document/Content).
// This generalises that mechanism so no second storage layer exists. On a
// migrated server the documents ARE the truth; missing ones THROW (never a
// silent gap — the migrated-marker pattern). Migration one-off imports the
// local records; the local files stay as a read fallback until proven, then retire.

const fs = require('fs')
const path = require('path')
const { makeClient } = require('./adapter_registry')

const GOVERNANCE = ['Applications', 'Governance']

// Field in the marker suggested for live ops (in-memory), not persisted.
const AREAS = {
    changeSets:  { folder: 'ChangeSets' },
    approvals:   { folder: 'Deployments', doc: 'approvals.json' },
    deployState: { folder: 'Deployments', doc: 'state.json' },
    lock:        { folder: 'Deployments' },
}

const MARKER_FILE = path.join(__dirname, '..', 'config', 'model-migration.json')
function loadMarkers() { try { return JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8')) } catch { return {} } }
function saveMarkers(m) { fs.mkdirSync(path.dirname(MARKER_FILE), { recursive: true }); fs.writeFileSync(MARKER_FILE, JSON.stringify(m, null, 2)) }
// Has this server's <area> been migrated to the model?
function isMigrated(server, area) {
    const e = loadMarkers()[server]
    return !!e && e[area] === 'model'
}
function markMigrated(server, area) {
    const m = loadMarkers()
    ;(m[server] ??= { at: new Date().toISOString() })[area] = 'model'
    saveMarkers(m)
}

function _clientFor(server, opts = {}) {
    if (opts.client) return opts.client
    return makeClient(server, opts.ideToken ?? null)
}

// ├─ folders ─
function folderFor(area) {
    const folder = AREAS[area]?.folder
    if (!folder) throw new Error(`unknown governance area: ${area}`)
    return [...GOVERNANCE, folder]
}
function docNameFor(area, name) {
    const d = AREAS[area]?.doc
    return d ?? name
}

function _isExistsError(e) {
    const status = e.response?.status
    const code = e.response?.data?.error?.code
    return status === 409 || (status === 400 && ['278', '226'].includes(String(code)))
}

// List document names in an area (e.g. every change-set document).
async function listDocs(server, area, { ideToken } = {}) {
    const c = _clientFor(server, { ideToken })
    const files = await c.listFiles(folderFor(area)).catch(e => {
        if (e.response?.status === 404) return []
        throw e
    })
    return files.filter(f => !f.isFolder).map(f => f.name)
}

// Read one governance document. Returns null when the document (or folder) is
// missing on an UNMIGRATED server; on a MIGRATED server missing is an error.
async function readDoc(server, area, name, { ideToken } = {}) {
    const c = _clientFor(server, { ideToken })
    const folder = folderFor(area)
    const doc = docNameFor(area, name)
    try {
        const files = await c.listFiles(folder).catch(e => (e.response?.status === 404 ? [] : (() => { throw e })()))
        if (!files.some(f => f.name === doc && !f.isFolder)) {
            if (isMigrated(server, area)) {
                throw new Error(`Server "${server}" is model-owned for ${area}, but ${folder.join('/')}/${doc} is missing. Restore it, or remove the migrated marker from config/model-migration.json.`)
            }
            return null
        }
        const raw = await c.getFileContent(folder, doc)
        return typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch (e) {
        if (e.message?.startsWith('Server "')) throw e
        throw e
    }
}

// Write a governance document (create-once + put content). Never silent: if a
// migrated server cannot be written, this throws so the caller stops loudly.
async function writeDoc(server, area, name, data, { ideToken } = {}) {
    const c = _clientFor(server, { ideToken })
    const folder = folderFor(area)
    const doc = docNameFor(area, name)
    await c.ensureFolderPath(folder)
    const files = await c.listFiles(folder).catch(e => (e.response?.status === 404 ? [] : (() => { throw e })()))
    if (!files.some(f => f.name === doc && !f.isFolder)) {
        try { await c.createFileDocument(folder, doc) } catch (e) { if (!_isExistsError(e)) throw e }
    }
    await c.putFileContent(folder, doc, JSON.stringify(data, null, 2))
    return data
}

// Read a governance document treating "missing" as null on ANY server (used for
// the deploy lock, which is ephemeral coordination, not a migrated record —
// no lock = free, whether or not the server is migrated).
async function readOptional(server, area, name, { ideToken } = {}) {
    const c = _clientFor(server, { ideToken })
    const folder = folderFor(area)
    const doc = docNameFor(area, name)
    try {
        const files = await c.listFiles(folder).catch(e => (e.response?.status === 404 ? [] : (() => { throw e })()))
        if (!files.some(f => f.name === doc && !f.isFolder)) return null
        const raw = await c.getFileContent(folder, doc)
        return typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch { return null }
}

module.exports = { listDocs, readDoc, readOptional, writeDoc, isMigrated, markMigrated, AREAS, GOVERNANCE }