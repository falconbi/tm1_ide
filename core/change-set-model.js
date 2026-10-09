'use strict'

// ── Change-set audit in the model ────────────────────────────────────────────
// On a migrated server, a CLOSED change set is an immutable record under
// Applications/Governance/ChangeSets/<id>.json holding a LIGHT audit
// (action, object, user, timestamp — NOT before/after copies; content history
// is TM1 Git's job) plus the close details (tests snapshot, closed by/at).
// Written ONCE at close, loudly — a write failure fails the close. Open change
// sets live in the local change log (a working cache); the before/after states
// stay local too, useful for undo / object history but they are not the record.

const store = require('./model-store')
const AREA = 'changeSets'

// Build the immutable closed record: session fields + close details + light audit.
function buildClosedRecord(session, { closedBy, tests, audit } = {}) {
    let closeTests = tests
    if (closeTests === null && session.close_tests) { try { closeTests = JSON.parse(session.close_tests) } catch { closeTests = null } }
    return {
        id: session.id, name: session.name, server: session.server, user: session.user,
        started_at: session.started_at, description: session.description ?? null,
        closed_at: session.closed_at ?? new Date().toISOString(),
        closed_by: closedBy ?? session.closed_by ?? null,
        close_tests: closeTests,
        entry_count: (audit ?? []).length,
        audit: audit ?? [],
    }
}

// The light audit for a change set (from the open local log). No before/after.
function lightAudit(sessionId) {
    try {
        return require('./change_log').getSessionLog(sessionId).map(e => ({
            action: e.action, object_type: e.object_type, object_name: e.object_name,
            detail: e.detail ?? null, user: e.user ?? null, timestamp: e.timestamp,
        }))
    } catch { return [] }
}

// Persist a closed change set to the model. On a migrated server this is the
// record and a failure THROWS (the close fails). On an unmigrated server it is
// a silent no-op — the local log is the truth until migration.
async function closeAndPersist(server, session, { closedBy, tests, ideToken } = {}) {
    if (!store.isMigrated(server, AREA)) return { ok: true, model: false }
    const closed = buildClosedRecord(session, { closedBy, tests, audit: lightAudit(session.id) })
    await store.writeDoc(server, AREA, `${session.id}.json`, closed, { ideToken })   // loud
    return { ok: true, model: true, id: session.id }
}

// On a migrated server, list change sets from the model; else null (fall back
// to the local working log).
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

module.exports = { closeAndPersist, buildClosedRecord, lightAudit, listSessions, AREA }