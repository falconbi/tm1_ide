'use strict'

// Where deployment baselines live. One file per server —
// `.tm1baseline/<server>.json` — so several Dev→Prod loops can run without
// stepping on each other. `snapshot.json` is the pre-split legacy location,
// still read as a fallback when its _meta.server matches (see diff.loadBaseline).

const path = require('path')

const BASELINE_DIR         = path.resolve(__dirname, '../../../.tm1baseline')
const LEGACY_BASELINE_PATH = path.join(BASELINE_DIR, 'snapshot.json')

function baselinePathFor(server) {
    const safe = String(server ?? '').replace(/[^A-Za-z0-9_.-]/g, '_') || 'default'
    return path.join(BASELINE_DIR, `${safe}.json`)
}

module.exports = { BASELINE_DIR, LEGACY_BASELINE_PATH, baselinePathFor }
