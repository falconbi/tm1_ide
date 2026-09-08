'use strict'

// ── Model assertions ─────────────────────────────────────────────────────────
//
// Expected results for a model, written once and checked on every build. This is
// the value-layer counterpart to rules-lint (which only checks that a rule is
// written correctly). An assertion is an MDX query plus the number it should
// return; run_assertions executes each and compares.
//
// Stored as config/assertions.json, keyed by server name. Plain JSON so it can
// be inspected, edited by hand, and version-controlled as part of the model spec.

const fs   = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const FILE = path.join(__dirname, '..', 'config', 'assertions.json')

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
}

function list(server) {
  return load()[server] ?? []
}

function add(server, { description, mdx, expected, tolerance, tags }) {
  const data = load()
  ;(data[server] ??= [])
  const rec = {
    id:          randomUUID().slice(0, 8),
    description: String(description ?? '').trim(),
    mdx:         String(mdx).trim(),
    expected:    Number(expected),
    tolerance:   tolerance == null ? 0.01 : Number(tolerance),
    tags:        Array.isArray(tags) ? tags : [],
    created:     new Date().toISOString(),
  }
  data[server].push(rec)
  save(data)
  return rec
}

function remove(server, id) {
  const data = load()
  if (!data[server]) return false
  const before = data[server].length
  data[server] = data[server].filter(a => a.id !== id)
  save(data)
  if (!data[server].length) delete data[server]
  save(data)
  return data[server] ? data[server].length < before : before > 0
}

// Run the assertions stored under `sourceServer` (their MDX), executing each
// against `targetServer` (default: the same). Used for post-deploy verification —
// the source Dev server's assertions run against the target after a deploy.
async function run(sourceServer, { targetServer, tags, ideToken } = {}) {
    const { makeClient } = require('./adapter_registry')
    const client = makeClient(targetServer ?? sourceServer, ideToken)
    const set = list(sourceServer).filter(a => !tags?.length || (a.tags ?? []).some(t => tags.includes(t)))

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
        target_server: targetServer ?? sourceServer,
        total:  results.length,
        passed: results.filter(r => r.pass).length,
        failed: results.filter(r => !r.pass),
        results,
    }
}

module.exports = { list, add, remove, load, save, run, FILE }
