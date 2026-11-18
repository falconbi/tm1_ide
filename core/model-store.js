'use strict'

// ── Model governance store ───────────────────────────────────────────────────
// The model owns its governance records: change sets, approvals and deploy
// history live as documents under Applications/Governance, exactly the way
// assertions already do (v11 Application Documents — .blob / Document/Content).
// This generalises that mechanism so no second storage layer exists. The
// server's own Applications/Governance/manifest.json says which areas it owns;
// on a model-owned area the documents ARE the truth and missing ones THROW
// (never a silent gap). The manifest is read here, never written.

const crypto = require('crypto')
const { makeClient } = require('./adapter-registry')

const GOVERNANCE = ['Applications', 'Governance']
const MANIFEST_DOC = 'manifest.json'
const MANIFEST_VERSION = 1
const MANIFEST_AREAS = ['changeSets', 'approvals', 'deployState', 'assertions']
const MANIFEST_TTL_MS = 30_000
const MANIFEST_MAX_CACHE = 50

// Folders for every governance area (lock and lenses are not manifest areas).
const AREAS = {
    changeSets:  { folder: 'ChangeSets' },
    approvals:   { folder: 'Deployments', doc: 'approvals.json' },
    deployState: { folder: 'Deployments', doc: 'state.json' },
    lock:        { folder: 'Deployments' },
    lenses:      { folder: 'Lenses' },
    lensDeploys: { folder: 'LensDeploys' },
}

// ── Governance manifest ─────────────────────────────────────────────────────
// The model says which areas it owns. Nothing in core/ or routes/ writes this
// document — only tools/migrate-governance.js. A missing or unreadable manifest
// is never treated as "unmigrated": it throws so a fresh IDE cannot silently
// start writing local copies beside a model that owns them.

class GovernanceManifestError extends Error {
    constructor(server, detail) {
        super(`Server "${server}" has no usable governance manifest (${detail}). ` +
            `Fix it with: node tools/migrate-governance.js --manifest ${server} --local (or --model).`)
        this.name = 'GovernanceManifestError'
        this.code = 'GOVERNANCE_MANIFEST'
        this.server = server
    }
}

const _manifestCache = new Map()
const _manifestIdentity = (opts) => opts.identity ?? (opts.ideToken
    ? crypto.createHash('sha256').update(String(opts.ideToken)).digest('hex').slice(0, 16)
    : '')

function _validateManifest(server, manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new GovernanceManifestError(server, 'the document is not a JSON object')
    }
    if (manifest.version !== MANIFEST_VERSION) {
        throw new GovernanceManifestError(server, `unsupported version ${JSON.stringify(manifest.version)} (expected ${MANIFEST_VERSION})`)
    }
    if (!manifest.areas || typeof manifest.areas !== 'object' || Array.isArray(manifest.areas)) {
        throw new GovernanceManifestError(server, '"areas" is missing or is not an object')
    }
    for (const area of MANIFEST_AREAS) {
        const value = manifest.areas[area]
        if (value !== 'model' && value !== 'local') {
            throw new GovernanceManifestError(server, `area "${area}" must be "model" or "local" (got ${JSON.stringify(value)})`)
        }
    }
    return manifest
}

// Read and validate the manifest. Cached per server + identity for 30 seconds;
// a failed read is never cached, so the next caller retries.
async function readManifest(server, opts = {}) {
    const key = `${server}::${_manifestIdentity(opts)}`
    const hit = _manifestCache.get(key)
    if (hit && Date.now() - hit.at <= MANIFEST_TTL_MS) return hit.manifest
    if (hit) _manifestCache.delete(key)

    const c = _clientFor(server, opts)
    let manifest
    try {
        let files
        try {
            files = await c.listFiles(GOVERNANCE)
        } catch (e) {
            if (e.response?.status === 404) throw new GovernanceManifestError(server, 'Applications/Governance/manifest.json is missing')
            throw e
        }
        if (!files.some(f => f.name === MANIFEST_DOC && !f.isFolder)) {
            throw new GovernanceManifestError(server, 'Applications/Governance/manifest.json is missing')
        }
        const raw = await c.getFileContent(GOVERNANCE, MANIFEST_DOC)
        manifest = _validateManifest(server, typeof raw === 'string' ? JSON.parse(raw) : raw)
    } catch (e) {
        if (e instanceof GovernanceManifestError) throw e
        throw new GovernanceManifestError(server, `could not be read: ${e.response?.data?.error?.message ?? e.message}`)
    }

    _manifestCache.set(key, { at: Date.now(), manifest })
    if (_manifestCache.size > MANIFEST_MAX_CACHE) {
        const oldest = _manifestCache.keys().next().value
        if (oldest !== undefined) _manifestCache.delete(oldest)
    }
    return manifest
}

// Does this server own <area> in its model? Reads the manifest (async, cached).
async function isMigrated(server, area, opts = {}) {
    if (!MANIFEST_AREAS.includes(area)) throw new Error(`unknown governance manifest area: ${area}`)
    const manifest = await readManifest(server, opts)
    return manifest.areas[area] === 'model'
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
async function listDocs(server, area, opts = {}) {
    const c = _clientFor(server, opts)
    const files = await c.listFiles(folderFor(area)).catch(e => {
        if (e.response?.status === 404) return []
        throw e
    })
    return files.filter(f => !f.isFolder).map(f => f.name)
}

// Read one governance document. Returns null when the document (or folder) is
// missing on an UNMIGRATED server; on a MIGRATED server missing is an error.
async function readDoc(server, area, name, opts = {}) {
    const c = _clientFor(server, opts)
    const folder = folderFor(area)
    const doc = docNameFor(area, name)
    try {
        const files = await c.listFiles(folder).catch(e => (e.response?.status === 404 ? [] : (() => { throw e })()))
        if (!files.some(f => f.name === doc && !f.isFolder)) {
            if (!opts.missingOk && MANIFEST_AREAS.includes(area) && await isMigrated(server, area, opts)) {
                throw new Error(`Server "${server}" is model-owned for ${area} (its governance manifest says so), but ${folder.join('/')}/${doc} is missing. Restore it, or change that area to "local" with: node tools/migrate-governance.js --manifest ${server} --local`)
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
async function writeDoc(server, area, name, data, opts = {}) {
    const c = _clientFor(server, opts)
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
async function readOptional(server, area, name, opts = {}) {
    const c = _clientFor(server, opts)
    const folder = folderFor(area)
    const doc = docNameFor(area, name)
    try {
        const files = await c.listFiles(folder).catch(e => (e.response?.status === 404 ? [] : (() => { throw e })()))
        if (!files.some(f => f.name === doc && !f.isFolder)) return null
        const raw = await c.getFileContent(folder, doc)
        return typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch { return null }
}

// Delete one governance document. Missing is an error (the caller asked to delete
// something that isn't there) — never a silent no-op.
async function deleteDoc(server, area, name, opts = {}) {
    const c = _clientFor(server, opts)
    const folder = folderFor(area)
    const doc = docNameFor(area, name)
    const files = await c.listFiles(folder).catch(e => (e.response?.status === 404 ? [] : (() => { throw e })()))
    if (!files.some(f => f.name === doc && !f.isFolder)) {
        throw new Error(`${folder.join('/')}/${doc} not found on ${server}`)
    }
    await c.deleteFile(folder, doc)
}

module.exports = {
    listDocs, readDoc, readOptional, writeDoc, deleteDoc,
    readManifest, isMigrated, GovernanceManifestError,
    AREAS, GOVERNANCE, MANIFEST_AREAS, MANIFEST_DOC, MANIFEST_VERSION,
}