'use strict'

// ── change_log.db retention (IMPROVEMENTS 1.4) ─────────────────────────────────
//
// The audit DB only grows; this is the manual, opt-in archive/prune path — no
// silent deletion. Export always happens before delete (a failed write never
// loses data), and pruning never crosses `retentionFloor`: the oldest baseline
// still on disk for that server. A release-window diff can be requested
// between any two baselines that exist, so nothing at or after the oldest
// one's change-log position may ever be pruned.

const fs   = require('fs')
const path = require('path')
const cl   = require('../../../core/change_log')
const { listBaselines } = require('./diff')

const ARCHIVE_DIR = path.resolve(__dirname, '../../../config/archives/change-log')
const DEFAULT_RETENTION_DAYS = Number(process.env.CHANGE_LOG_RETENTION_DAYS) || 365

function retentionFloor(server) {
    const baselines = listBaselines(server)
    return baselines.length ? (baselines[0].last_entry_id ?? 0) : 0
}

function archiveChangeLog(server, { olderThanDays = DEFAULT_RETENTION_DAYS, dryRun = false } = {}) {
    const cutoffIso = new Date(Date.now() - olderThanDays * 86400000).toISOString()
    const floorId   = retentionFloor(server)
    const entries   = cl.findArchivableEntries(server, cutoffIso, floorId)
    if (!entries.length) return { archived: 0, file: null, cutoffIso, floorId, dryRun }

    // Dry run previews the count only — no file, no delete, zero footprint.
    if (dryRun) return { archived: entries.length, file: null, cutoffIso, floorId, dryRun: true }

    fs.mkdirSync(ARCHIVE_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file  = path.join(ARCHIVE_DIR, `${stamp}_${server}.json`)
    fs.writeFileSync(file, JSON.stringify({ server, cutoffIso, floorId, entries }, null, 2))

    const deleted = cl.pruneEntries(entries.map(e => e.id))
    return { archived: deleted, file, cutoffIso, floorId, dryRun: false }
}

module.exports = { archiveChangeLog, retentionFloor, DEFAULT_RETENTION_DAYS, ARCHIVE_DIR }
