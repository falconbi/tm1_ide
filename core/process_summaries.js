'use strict'

// AI/human "what does this process do" summaries, kept OUTSIDE the TI code.
// Keyed by server + process, with a hash of the process code so a changed process
// shows as stale instead of silently using an old summary.
//
// data/process-summaries.json is runtime knowledge (like the lens prefs), not source.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const FILE = process.env.PROCESS_SUMMARIES_FILE || path.join(__dirname, '..', 'data', 'process-summaries.json')
const PROMPT_VERSION = 'v1'

function hashCode(code) {
    return crypto.createHash('sha256').update(PROMPT_VERSION + '\n' + String(code ?? '')).digest('hex').slice(0, 16)
}

function read() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) ?? {} } catch { return {} }
}

function write(all) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    const tmp = FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(all, null, 1))
    fs.renameSync(tmp, FILE)
}

function get(server, name, hash) {
    const e = read()?.[server]?.[name]
    if (!e) return null
    if (hash && e.hash !== hash) return null
    return e
}

function getLatest(server, name) {
    return read()?.[server]?.[name] ?? null
}

function put(server, name, entry) {
    const all = read()
    ;(all[server] ??= {})[name] = { ...entry, at: new Date().toISOString() }
    write(all)
    return all[server][name]
}

function remove(server, name) {
    const all = read()
    if (!all[server]?.[name]) return false
    delete all[server][name]
    if (!Object.keys(all[server]).length) delete all[server]
    write(all)
    return true
}

function list(server) {
    return read()?.[server] ?? {}
}

module.exports = { FILE, PROMPT_VERSION, hashCode, get, getLatest, put, remove, list }
