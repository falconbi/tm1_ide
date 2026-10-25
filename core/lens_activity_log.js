'use strict'

// What people did through Lenses, one JSON line each (data/lens-activity.jsonl,
// not in git): cells saved (who, when, which Lens, old and new values) and
// processes run (parameters and outcome). TM1's own logs record the same under
// the user's name; this one also says which Lens did it.
const fs   = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'data', 'lens-activity.jsonl')

function append(entry, file) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
}

function logLensWrite({ server, app, user, lens, cube, changes }, file = FILE) {
    append({ kind: 'write', server, app, user, lens, cube, changes }, file)
}

function logLensNote({ server, app, user, lens, cube, coordinates, text }, file = FILE) {
    append({ kind: 'note', server, app, user, lens, cube, coordinates, text }, file)
}

function logLensRun({ server, app, user, lens, process, params, status, message, detail }, file = FILE) {
    append({ kind: 'run', server, app, user, lens, process, params, status, message, detail }, file)
}

// Recent activity for one Lens, newest first: its saves and runs on this server.
// match = { dimension: element } narrows to one slice (e.g. a store and year):
// a save keeps only the cells inside it; a run is kept when every match value
// appears among its parameters. The caller checks the person may see the slice.
// skip: process names left out (e.g. the reservation checks a Lens runs on every load).
function readLensActivity({ server, lens, match = {}, limit = 50, skip = [] }, file = FILE) {
    const skipped = new Set(skip.map(p => String(p).toLowerCase()))
    let text = ''
    try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
    const want = Object.entries(match).filter(([, v]) => v !== undefined && v !== null && v !== '')
    const out = []
    const lines = text.trim().split('\n')
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        let e
        try { e = JSON.parse(lines[i]) } catch { continue }
        if (e.server !== server || String(e.lens || '').toLowerCase() !== String(lens).toLowerCase()) continue
        if (e.kind === 'note') {
            if (want.every(([d, v]) => String(e.coordinates?.[d]) === String(v))) out.push(e)
        } else if (e.kind === 'run') {
            if (skipped.has(String(e.process || '').toLowerCase())) continue
            const vals = Object.values(e.params ?? {}).map(String)
            if (want.every(([, v]) => vals.includes(String(v)))) out.push(e)
        } else {
            const changes = (e.changes ?? []).filter(c => want.every(([d, v]) => String(c.coordinates?.[d]) === String(v)))
            if (changes.length) out.push({ ...e, kind: 'write', changes })
        }
    }
    return out
}

module.exports = { logLensWrite, logLensRun, logLensNote, readLensActivity, FILE }
