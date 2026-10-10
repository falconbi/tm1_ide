'use strict'

// ── Read-only (PROD posture) refusal ─────────────────────────────────────────
// One place for the refusal decision so the route (gateReadOnly), the sessions/
// start save gate and the tests share the exact same shape.

const { isReadOnly } = require('./adapter_registry')

const READ_ONLY_ERROR = 'This server is read-only (PROD posture) — no changes are allowed here. Switch to a writable server to edit.'

// Returns the 409 payload when the server is read-only, else null. The caller
// decides status + body so every refusal carries readOnly: true and the server
// name (the client surfaces a single toast from it).
function readOnlyRefusal(server) {
    return isReadOnly(server) ? { error: READ_ONLY_ERROR, readOnly: true, server } : null
}

module.exports = { READ_ONLY_ERROR, readOnlyRefusal }