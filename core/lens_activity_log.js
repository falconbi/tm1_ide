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

function logLensRun({ server, app, user, lens, process, params, status, message }, file = FILE) {
    append({ kind: 'run', server, app, user, lens, process, params, status, message }, file)
}

module.exports = { logLensWrite, logLensRun, FILE }
