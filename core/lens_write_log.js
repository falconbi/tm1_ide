'use strict'

// Every cell a Lens saves, one JSON line per save: who, when, which Lens, which
// cells, old and new values. Kept beside the app (data/lens-writes.jsonl, not in
// git); TM1's own transaction log records the same change under the user's name.
const fs   = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'data', 'lens-writes.jsonl')

function logLensWrite({ server, app, user, lens, cube, changes }, file = FILE) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), server, app, user, lens, cube, changes }) + '\n')
}

module.exports = { logLensWrite, FILE }
