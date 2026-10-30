'use strict'

const fs   = require('fs')
const path = require('path')

// ══════════════════════════════════════════════════════════════════════════════
// ORIENTATION
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { ok }) {
    server.tool(
        'read_build_guide',
        'Read docs/models/BUILDING_MODELS.md — the method for building a TM1 model: DESIGN FIRST (workflow table → design questions → screens → model, each signed off; one design doc per model, e.g. docs/models/WORKFORCE_MODEL.md), then the build rules (dimensionality first, verify every worked example with read_cells, native vs MDX views, the change-set workflow, v11 landmines). Call this FIRST when asked to build a model.',
        {},
        async () => {
            const p = path.join(__dirname, '../../../docs/models/BUILDING_MODELS.md')
            try { return ok(fs.readFileSync(p, 'utf8')) }
            catch (e) { return ok(`Build guide not found at ${p}: ${e.message}`) }
        }
    )
}

module.exports = { register }
