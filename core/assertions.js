'use strict'

// ── Model assertions ─────────────────────────────────────────────────────────
//
// Expected results for a model, written once and checked on every build. This is
// the value-layer counterpart to rules-lint (which only checks that a rule is
// written correctly). An assertion is an MDX query plus the number it should
// return; run_assertions executes each and compares.
//
// Storage (Phase 1 — the model owns its tests, see docs/MODEL_OWNED_HISTORY_PLAN.md):
// - A migrated server keeps its assertions in the model: the TM1 server's own
//   Applications/Governance/Tests/assertions.json document (an array of records,
//   same shape as ever). The IDE/MCP read and write that document.
// - A server with no such document falls back to config/assertions.json (the
//   pre-Phase-1 home) so unmigrated servers keep working unchanged.

const fs   = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const FILE = path.join(__dirname, '..', 'config', 'assertions.json')

// Where assertions live inside a migrated model (v11 Applications container).
const GOVERNANCE_PATH = ['Applications', 'Governance', 'Tests']
const MODEL_DOC_NAME  = 'assertions.json'

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
}

function _clientFor(server, opts = {}) {
  if (opts.client) return opts.client
  const { makeClient } = require('./adapter_registry')
  return makeClient(server, opts.ideToken ?? null)
}

// ── Migrated-server marker ──────────────────────────────────────────────────
// A migrated server's entry in config/assertions.json is replaced with a marker
// `{ "migrated": "model", "at": "<iso>" }` instead of being deleted. If the
// server's document ever goes missing (folder deleted, restored from an old
// backup), falling back to the central file would find nothing and run zero
// assertions silently — the exact silent-pass we closed. A marker makes the
// store throw "migrated server's document is missing" instead.

function _configEntry(server) {
  return load()[server]
}

function _isMigratedMarker(entry) {
  return !!entry && typeof entry === 'object' && !Array.isArray(entry) && entry.migrated === 'model'
}

function _missingModelError(server) {
  return new Error(
    `Server "${server}" is marked as migrated (model-owned) in config/assertions.json, but its document ${_targetPath()} is missing on the server. ` +
    `Restore the document (or remove the "migrated" marker from config/assertions.json) before using assertions.`
  )
}

// ── Model document helpers ──────────────────────────────────────────────────

function _targetPath() {
  return `${GOVERNANCE_PATH.join('/')}/${MODEL_DOC_NAME}`
}

// Is this the "document already exists" error from creating a document?
// v11 returns HTTP 400 with error code 278; v12 returns HTTP 409.
function _isExistsError(e) {
  const status = e.response?.status
  const code = e.response?.data?.error?.code
  return status === 409 || (status === 400 && String(code) === '278')
}

// Read the model's assertion array, or null when the server has no such
// document (missing folder or missing file both mean "not migrated").
// A document that exists but is not a JSON array (or won't parse) THROWS — never
// return [] silently, which would skip close_change_set assertions and pass
// deploy verification.
async function _readModel(client) {
  let files
  try {
    files = await client.listFiles(GOVERNANCE_PATH)
  } catch (e) {
    if (e.response?.status === 404) return null
    throw e
  }
  if (!files.some(f => f.name === MODEL_DOC_NAME && !f.isFolder)) return null
  const raw = await client.getFileContent(GOVERNANCE_PATH, MODEL_DOC_NAME)
  // TM1 returns JSON documents already parsed (axios); tolerate a raw string too.
  const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!Array.isArray(arr)) {
    throw new Error(
      `Model assertions document ${_targetPath()} on "${client.server}" is not a JSON array (got ${arr === null ? 'null' : typeof arr}). Refusing to treat it as an empty list.`
    )
  }
  return arr
}

async function _writeModel(client, records) {
  await client.ensureFolderPath(GOVERNANCE_PATH)
  try {
    await client.createFileDocument(GOVERNANCE_PATH, MODEL_DOC_NAME)
  } catch (e) {
    // Only swallow "already exists"; anything else is a real failure.
    if (!_isExistsError(e)) throw e
  }
  await client.putFileContent(GOVERNANCE_PATH, MODEL_DOC_NAME, JSON.stringify(records, null, 2))
}

// Write the existing model document to a timestamped backup before --force
// overwrites it. Returns the backup document name.
async function _writeBackup(client, records) {
  const iso = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `assertions.backup-${iso}.json`
  await client.ensureFolderPath(GOVERNANCE_PATH)
  try {
    await client.createFileDocument(GOVERNANCE_PATH, name)
  } catch (e) {
    if (!_isExistsError(e)) throw e
  }
  await client.putFileContent(GOVERNANCE_PATH, name, JSON.stringify(records, null, 2))
  return name
}

// ── Store API (async; callers updated) ──────────────────────────────────────

// The assertions stored for a server: its model document if present, else the
// config/assertions.json fallback. Always reports which store the set came from.
async function list(server, opts = {}) {
  const client = _clientFor(server, opts)
  const model = await _readModel(client)
  if (model) return { source: 'model', assertions: model }
  const entry = _configEntry(server)
  if (_isMigratedMarker(entry)) throw _missingModelError(server)
  return { source: 'config', assertions: entry ?? [] }
}

async function add(server, { description, mdx, expected, tolerance, tags }, opts = {}) {
  const rec = {
    id:          randomUUID().slice(0, 8),
    description: String(description ?? '').trim(),
    mdx:         String(mdx).trim(),
    expected:    Number(expected),
    tolerance:   tolerance == null ? 0.01 : Number(tolerance),
    tags:        Array.isArray(tags) ? tags : [],
    created:     new Date().toISOString(),
  }
  const client = _clientFor(server, opts)
  const model = await _readModel(client)
  if (model) {
    model.push(rec)
    await _writeModel(client, model)
  } else {
    if (_isMigratedMarker(_configEntry(server))) throw _missingModelError(server)
    const data = load()
    ;(data[server] ??= []).push(rec)
    save(data)
  }
  return rec
}

async function remove(server, id, opts = {}) {
  const client = _clientFor(server, opts)
  const model = await _readModel(client)
  if (model) {
    const before = model.length
    const next = model.filter(a => a.id !== id)
    if (next.length < before) {
      await _writeModel(client, next)
      return true
    }
    return false
  }
  if (_isMigratedMarker(_configEntry(server))) throw _missingModelError(server)
  const data = load()
  if (!data[server]) return false
  const before = data[server].length
  data[server] = data[server].filter(a => a.id !== id)
  if (!data[server].length) delete data[server]
  save(data)
  return data[server] ? data[server].length < before : before > 0
}

// Does this server already own its assertions in the model?
async function isModelStored(server, opts = {}) {
  return (await _readModel(_clientFor(server, opts))) !== null
}

// Copy a server's config/assertions.json entries into its model document.
// Copy only — config/assertions.json is left untouched. Refuses to overwrite an
// existing model document unless `force`. After writing, reads the document back
// so the caller sees the count the server actually holds.
async function migrate(server, { dryRun = false, force = false, ideToken, client: injected } = {}) {
  const client = injected ?? _clientFor(server, { ideToken })
  const target = `${GOVERNANCE_PATH.join('/')}/${MODEL_DOC_NAME}`
  const cfgEntry = _configEntry(server)
  if (_isMigratedMarker(cfgEntry)) {
    throw new Error(
      `Server "${server}" is already migrated — config/assertions.json holds the "migrated" marker, so there is nothing to copy from it. ` +
      `Its assertions live at ${target} on the server.`
    )
  }
  const existing = await _readModel(client)
  let backup = null
  if (existing && force && !dryRun) {
    backup = await _writeBackup(client, existing)
  }
  if (existing && !force) {
    throw new Error(
      `Server "${server}" already has ${target} (${existing.length} records). Use --force to overwrite (a backup is written first).`
    )
  }
  const entries = load()[server] ?? []
  if (!entries.length) {
    throw new Error(`No assertions for "${server}" in config/assertions.json to migrate.`)
  }
  if (dryRun) {
    return {
      dryRun: true,
      server,
      count: entries.length,
      target,
      source: 'config',
      existing: existing?.length ?? 0,
      will_backup: !!(existing && force),
    }
  }
  await _writeModel(client, entries)
  const readBack = await _readModel(client)
  return {
    server,
    count: entries.length,
    read_back: readBack?.length ?? 0,
    target,
    source: 'model',
    backup,
    matches: readBack?.length === entries.length,
  }
}

// Run the assertions stored under `sourceServer` (their MDX), executing each
// against `targetServer` (default: the same). Used for post-deploy verification —
// the source Dev server's assertions run against the target after a deploy.
// Reports which store the assertions came from (source: 'model' | 'config').
async function run(sourceServer, { targetServer, tags, ideToken, client: injected } = {}) {
    const { makeClient } = require('./adapter_registry')
    const target = targetServer ?? sourceServer
    const client = injected ?? makeClient(target, ideToken)
    const { source, assertions: stored } = await list(sourceServer, target === sourceServer ? { client, ideToken } : { ideToken })
    const set = stored.filter(a => !tags?.length || (a.tags ?? []).some(t => tags.includes(t)))

    const results = []
    for (const a of set) {
        let actual = null, error = null
        try {
            const r = await client.executeMDX(a.mdx, 5000)
            actual = (r.Cells ?? []).reduce((s, x) => s + (x.Value ?? 0), 0)
        } catch (e) {
            error = e.response?.data?.error?.message ?? e.message
        }
        const tol  = a.tolerance ?? 0.01
        const pass = error == null && Math.abs(actual - a.expected) <= tol
        results.push({ id: a.id, description: a.description, expected: a.expected, actual, diff: error ? null : actual - a.expected, pass, error })
    }
    return {
        source_server: sourceServer,
        target_server: target,
        source,
        total:  results.length,
        passed: results.filter(r => r.pass).length,
        failed: results.filter(r => !r.pass),
        results,
    }
}

module.exports = { list, add, remove, load, save, run, migrate, isModelStored, FILE, GOVERNANCE_PATH, MODEL_DOC_NAME }