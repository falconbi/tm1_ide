'use strict'

// ── IDE modes set from the UI ─────────────────────────────────────────────────
// Simple mode switched on in Server Admin is kept here, in config/ide-modes.json,
// not in servers.json: servers.json holds passwords and the IDE never rewrites it.
// A server can also be marked simple in servers.json ("simpleServers" or
// "simple": true) — adapter_registry.isSimple() honours both.
//
//   { "simpleServers": ["SANDBOX", ...] }

const fs = require('fs')
const path = require('path')

const MODES_PATH = path.join(__dirname, '..', 'config', 'ide-modes.json')

function readModes() {
    try {
        const j = JSON.parse(fs.readFileSync(MODES_PATH, 'utf8'))
        return { simpleServers: Array.isArray(j?.simpleServers) ? j.simpleServers.map(String) : [] }
    } catch { return { simpleServers: [] } }
}

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

function isSimpleInModes(server) {
    if (!server) return false
    return readModes().simpleServers.some(s => same(s, server))
}

// Write via a temp file + rename so a crash mid-write never leaves broken JSON
function setSimpleInModes(server, simple) {
    if (!server) throw new Error('server required')
    const modes = readModes()
    const rest = modes.simpleServers.filter(s => !same(s, server))
    modes.simpleServers = simple ? [...rest, server] : rest
    const tmp = `${MODES_PATH}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(modes, null, 2) + '\n')
    fs.renameSync(tmp, MODES_PATH)
    return modes
}

module.exports = { MODES_PATH, readModes, isSimpleInModes, setSimpleInModes }
