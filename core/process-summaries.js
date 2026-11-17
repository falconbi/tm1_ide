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

// Serialise read-modify-write cycles. put/remove are async by contract so two
// callers cannot both read the same base and overwrite each other's entry.
let writeQueue = Promise.resolve()
function enqueueWrite(fn) {
    const next = writeQueue.then(fn, fn)
    writeQueue = next.then(() => {}, () => {})
    return next
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
    return enqueueWrite(() => {
        const all = read()
        ;(all[server] ??= {})[name] = { ...entry, at: new Date().toISOString() }
        write(all)
        return all[server][name]
    })
}

function remove(server, name) {
    return enqueueWrite(() => {
        const all = read()
        if (!all[server]?.[name]) return false
        delete all[server][name]
        if (!Object.keys(all[server]).length) delete all[server]
        write(all)
        return true
    })
}

function list(server) {
    return read()?.[server] ?? {}
}


// The process code used for hashing and the prompt shared by the IDE and MCP.
function processCode(p) {
    return [p.PrologProcedure, p.MetaDataProcedure ?? p.MetadataProcedure, p.DataProcedure, p.EpilogProcedure]
        .filter(Boolean).join('\n')
}

function summaryPrompt(p, f, includeCode) {
    const writes = f.writes.map(w => {
        const what = w.measures?.length ? w.measures.join(', ')
            : w.kinds?.includes('clear') ? 'cleared'
            : w.kinds?.includes('feeders') ? 'feeders recalculated'
            : 'written'
        return `- ${w.cube}: ${what}`
    }).join('\n')
    const params = (p.Parameters ?? []).map(x =>
        `${x.Name}${x.Value !== '' && x.Value != null ? ` (default ${x.Value})` : ''}${x.Prompt ? ` — ${x.Prompt}` : ''}`
    ).join('; ')
    const system = 'You document IBM TM1 TurboIntegrator processes for a data-lineage tooltip. Write plain English for an admin. ' +
        'Return ONLY: one or two sentences on what the process does and when it runs, then one line starting "Writes:" listing cube -> measures (or "clears"/"feeders"), ' +
        'then one line "Reads:" with the source cubes if any. No headings, no bullets, no code fences, no invented facts, no permissions unless they change what it does. Max 90 words.'
    const user = [
        `Process: ${p.Name}`,
        `Author's header:\n${f.header || '(none)'}`,
        `Parameters: ${params || '(none)'}`,
        `Datasource: ${f.source}`,
        `Writes (scanned from the code):\n${writes || '(no cube writes)'}`,
        `Reads (scanned): ${f.reads.join(', ') || '(none)'}`,
        `Called by: ${f.calledBy.join(', ') || '(nothing)'}`,
        includeCode ? `Code:\n${processCode(p).slice(0, 12000)}` : '',
    ].filter(Boolean).join('\n\n')
    return { system, user }
}

module.exports = { FILE, PROMPT_VERSION, hashCode, get, getLatest, put, remove, list, processCode, summaryPrompt }
