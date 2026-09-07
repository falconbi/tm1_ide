'use strict'

// Deployment baselines.
//
// Append-only history per server:  .tm1baseline/<server>/<iso>.json  + a HEAD
// pointer file naming the current one. A `seed` writes a NEW snapshot and moves
// HEAD — nothing is overwritten, so a mistimed seed is recoverable (move HEAD
// back). `.tm1baseline/<server>.json` (single file) and `.tm1baseline/snapshot.json`
// (pre-split) are still read as fallbacks.

const fs   = require('fs')
const path = require('path')

const BASELINE_DIR         = path.resolve(__dirname, '../../../.tm1baseline')
const LEGACY_BASELINE_PATH = path.join(BASELINE_DIR, 'snapshot.json')

function safeServer(server) {
    return String(server ?? '').replace(/[^A-Za-z0-9_.-]/g, '_') || 'default'
}

// Legacy single-file location (kept in sync by seed() as a fallback for old readers).
function baselinePathFor(server) {
    return path.join(BASELINE_DIR, `${safeServer(server)}.json`)
}

// Append-only history directory + its HEAD pointer.
function baselineDirFor(server)  { return path.join(BASELINE_DIR, safeServer(server)) }
function baselineHeadPath(server) { return path.join(baselineDirFor(server), 'HEAD') }

// Timestamped snapshot files in the history dir, oldest → newest.
function listBaselineFiles(server) {
    const dir = baselineDirFor(server)
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
}

// Absolute path of the current baseline: HEAD → newest in the history dir → null.
function readHead(server) {
    const hp = baselineHeadPath(server)
    if (fs.existsSync(hp)) {
        const name = fs.readFileSync(hp, 'utf8').trim()
        const full = path.join(baselineDirFor(server), name)
        if (name && fs.existsSync(full)) return full
    }
    const files = listBaselineFiles(server)
    return files.length ? path.join(baselineDirFor(server), files[files.length - 1]) : null
}

function writeHead(server, absFile) {
    fs.mkdirSync(baselineDirFor(server), { recursive: true })
    fs.writeFileSync(baselineHeadPath(server), path.basename(absFile))
}

// The baseline a diff/release/drift should compare against:
// append-only HEAD → legacy single file → (caller checks snapshot.json).
function currentBaselinePath(server) {
    return readHead(server)
        ?? (fs.existsSync(baselinePathFor(server)) ? baselinePathFor(server) : null)
}

module.exports = {
    BASELINE_DIR, LEGACY_BASELINE_PATH,
    baselinePathFor, baselineDirFor, baselineHeadPath,
    listBaselineFiles, readHead, writeHead, currentBaselinePath,
}
