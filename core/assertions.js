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

module.exports = { list, add, remove, load, save, FILE }
