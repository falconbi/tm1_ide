'use strict'

// ── Change sets in the model ─────────────────────────────────────────────────
// Change sets are governance, so on a migrated server each one is a document
// under Applications/Governance/ChangeSets/<id>.json, mirrored on every write
// (start / close / commit / deploy). Reads fall back to the local change log
// until the migration is proven; a mirror write that fails THROWS loud.

const store = require('./model-store')
const AREA = 'changeSets'

async function mirrorSession(server, session, { ideToken } = {}) {
    if (!store.isMigrated(server, AREA)) return
    const rec = { ...session }
    try { rec.entry_count = require('./change_log').getSessionLog(session.id).length } catch { rec.entry_count = session.entry_count ?? 0 }
    await store.writeDoc(server, AREA, `${session.id}.json`, rec, { ideToken })
    return rec
}

// On a migrated server, list change sets from the model; else null (fall back
// to the local log).
async function listSessions(server, { ideToken, limit = 50 } = {}) {
    if (!store.isMigrated(server, AREA)) return null
    const names = await store.listDocs(server, AREA, { ideToken })
    const sessions = []
    for (const n of names.filter(x => x.endsWith('.json'))) {
        try {
            const s = await store.readDoc(server, AREA, n, { ideToken })
            if (s) sessions.push(s)
        } catch { /* skip unreadable */ }
    }
    sessions.sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
    return sessions.slice(0, limit)
}

module.exports = { mirrorSession, listSessions, AREA }