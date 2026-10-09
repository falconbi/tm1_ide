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
  return status === 409 || (status === 400 && ['278', '226'].includes(String(code)))
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
  // Create the document only when it isn't there. Checking first is more reliable than
  // matching TM1's "already exists" error: v11 answers a duplicate create with 400 code 226
  // ("Failed to add document into folder"), not 278/409 — which made every add fail once
  // a server's document existed.
  const files = await client.listFiles(GOVERNANCE_PATH)
  if (!files.some(f => f.name === MODEL_DOC_NAME && !f.isFolder)) {
    try {
      await client.createFileDocument(GOVERNANCE_PATH, MODEL_DOC_NAME)
    } catch (e) {
      // Only swallow "already exists" (a concurrent create); anything else is a real failure.
      if (!_isExistsError(e)) throw e
    }
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

async function add(server, { description, mdx, expected, tolerance, tags, kind, severity, why, author, changeSet }, opts = {}) {
  const rec = {
    id:          randomUUID().slice(0, 8),
    description: String(description ?? '').trim(),
    why:         why ? String(why).trim() : null,
    mdx:         String(mdx).trim(),
    expected:    Number(expected),
    tolerance:   tolerance == null ? 0.01 : Number(tolerance),
    tags:        Array.isArray(tags) ? tags : [],
    kind:        kind === 'control' ? 'control' : 'behaviour',
    severity:    severity === 'warn' ? 'warn' : 'block',
    author:      author ? String(author).trim() : null,
    changeSet:   changeSet ?? null,
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
// Copy the config assertions into the model, then mark the server model-owned
// (config entry → "migrated" marker) so a lost model document throws instead of
// silently falling back. Refuses to overwrite an existing model document unless
// `force`. After writing, reads the document back so the caller sees the count
// the server actually holds.
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
  // Mark the server model-owned: the config entry becomes the "migrated" marker,
  // so a lost model document THROWS (never a silent fall back to config).
  const data = load()
  data[server] = { migrated: 'model', at: new Date().toISOString() }
  save(data)
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
async function run(sourceServer, { targetServer, tags, kind, severity, ideToken, client: injected } = {}) {
    const { makeClient } = require('./adapter_registry')
    const target = targetServer ?? sourceServer
    const client = injected ?? makeClient(target, ideToken)
    const { source, assertions: stored } = await list(sourceServer, target === sourceServer ? { client, ideToken } : { ideToken })
    const set = stored.filter(a =>
        (!tags?.length || (a.tags ?? []).some(t => tags.includes(t))) &&
        (!kind || (a.kind ?? 'behaviour') === kind) &&
        (!severity || (a.severity ?? 'block') === severity)
    )

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
        results.push({ id: a.id, description: a.description, mdx: a.mdx, tags: a.tags ?? [], kind: a.kind ?? 'behaviour', severity: a.severity ?? 'block', expected: a.expected, actual, diff: error ? null : actual - a.expected, pass, error })
    }
    const result = {
        source_server: sourceServer,
        target_server: target,
        source,
        total:  results.length,
        passed: results.filter(r => r.pass).length,
        failed: results.filter(r => !r.pass),
        results,
    }
    // Record run history to the target's }TestResults — best-effort, never fails a run.
    try {
        const { recordRun } = require('./test-results')
        await recordRun(client, result)
    } catch { /* history is best-effort */ }
    return result
}

module.exports = { list, add, update, remove, run, runOne, load, save, migrate, isModelStored, FILE, GOVERNANCE_PATH, MODEL_DOC_NAME }

// Update an assertion's fields (description, mdx, expected, tolerance, tags) by id.
// Model store on migrated servers, config file otherwise.
function _cleanPatch(patch = {}) {
    const out = {}
    if (patch.description !== undefined) out.description = String(patch.description).trim()
    if (patch.why !== undefined)        out.why         = patch.why ? String(patch.why).trim() : null
    if (patch.mdx !== undefined)        out.mdx        = String(patch.mdx).trim()
    if (patch.expected !== undefined)   out.expected   = Number(patch.expected)
    if (patch.tolerance !== undefined)  out.tolerance  = Number(patch.tolerance)
    if (patch.tags !== undefined)       out.tags       = Array.isArray(patch.tags) ? patch.tags : []
    if (patch.kind !== undefined)       out.kind       = patch.kind === 'control' ? 'control' : 'behaviour'
    if (patch.severity !== undefined)   out.severity   = patch.severity === 'warn' ? 'warn' : 'block'
    return out
}

// Append an expected-value change to the record's history (who/when/from→to/why).
function _noteExpectedChange(prev, rec, by) {
    if (rec.expected === undefined || Number(prev.expected) === Number(rec.expected)) return null
    return {
        at: new Date().toISOString(),
        by: by ?? null,
        from: Number(prev.expected),
        to: Number(rec.expected),
        why: rec.why ?? prev.why ?? null,
    }
}

async function update(server, id, patch = {}, opts = {}) {
    const rec = _cleanPatch(patch)
    const client = _clientFor(server, opts)
    const model = await _readModel(client)
    if (model) {
        const idx = model.findIndex(a => a.id === id)
        if (idx === -1) return null
        const hist = _noteExpectedChange(model[idx], rec, opts.by)
        model[idx] = { ...model[idx], ...rec }
        if (hist) model[idx].history = [...(model[idx].history ?? []), hist]
        await _writeModel(client, model)
        return model[idx]
    }
    if (_isMigratedMarker(_configEntry(server))) throw _missingModelError(server)
    const data = load()
    const arr = data[server] ?? []
    const idx = arr.findIndex(a => a.id === id)
    if (idx === -1) return null
    const hist = _noteExpectedChange(arr[idx], rec, opts.by)
    arr[idx] = { ...arr[idx], ...rec }
    if (hist) arr[idx].history = [...(arr[idx].history ?? []), hist]
    save(data)
    return arr[idx]
}

// Run a single assertion (by id) on the same server — for the assertions screen.
async function runOne(server, id, opts = {}) {
    const { source, assertions: stored } = await list(server, opts)
    const a = stored.find(x => x.id === id)
    if (!a) return { source, error: `No assertion ${id} for "${server}".` }
    const client = _clientFor(server, opts)
    let actual = null, error = null
    try {
        const r = await client.executeMDX(a.mdx, 5000)
        actual = (r.Cells ?? []).reduce((s, x) => s + (x.Value ?? 0), 0)
    } catch (e) {
        error = e.response?.data?.error?.message ?? e.message
    }
    const pass = error == null && Math.abs(actual - a.expected) <= (a.tolerance ?? 0.01)
    return { source, id: a.id, description: a.description, mdx: a.mdx, tags: a.tags ?? [], kind: a.kind ?? 'behaviour', severity: a.severity ?? 'block', expected: a.expected, actual, pass, error }
}