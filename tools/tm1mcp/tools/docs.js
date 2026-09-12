'use strict'

const fs   = require('fs')
const path = require('path')

// ══════════════════════════════════════════════════════════════════════════════
// ORIENTATION
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { ok }) {
    server.tool(
        'read_build_guide',
        'Read docs/BUILDING_MODELS.md — the method for building a TM1 model from a requirements document (dimensionality first, verify every worked example with read_cells, native vs MDX views, the change-set workflow, v11 landmines). Call this FIRST when asked to build a model.',
        {},
        async () => {
            const p = path.join(__dirname, '../../../docs/BUILDING_MODELS.md')
            try { return ok(fs.readFileSync(p, 'utf8')) }
            catch (e) { return ok(`Build guide not found at ${p}: ${e.message}`) }
        }
    )
}

module.exports = { register }
