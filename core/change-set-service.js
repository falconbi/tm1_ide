'use strict'

// One close sequence for both the IDE route and the MCP: persist the immutable
// model-owned record first (loud on a migrated server), then mark the local
// change set closed. Keeping this in one place stops the two surfaces drifting.

const changeLog = require('./change-log')
const changeSetModel = require('./change-set-model')

async function closeChangeSet(id, { user, tests = null, ideToken, client } = {}) {
    const session = changeLog.getSession(id)
    if (!session) return null
    await changeSetModel.closeAndPersist(session.server, session, { closedBy: user, tests, ideToken, client })
    return changeLog.closeSession(id, { user, tests })
}

// Won't deploy: the set stays as a record but owns nothing and cannot be
// committed or released. Only a closed set can be marked, and a reason is
// required. The model record is updated first on a model-owned server.
async function markWontDeploy(id, { by, reason, ideToken, client } = {}) {
    const session = changeLog.getSession(id)
    if (!session) return null
    if (!session.closed_at) {
        const e = new Error(`Change set "${session.name}" is still open — close it before marking it won't deploy.`)
        e.code = 'OPEN_SET'
        throw e
    }
    const text = String(reason ?? '').trim()
    if (!text) {
        const e = new Error('A reason is required to mark a change set won\'t deploy.')
        e.code = 'REASON_REQUIRED'
        throw e
    }
    const at = new Date().toISOString()
    await changeSetModel.updateClosedRecord(session.server, id, {
        wont_deploy_at: at,
        wont_deploy_by: by ?? null,
        wont_deploy_reason: text,
    }, { ideToken, client })
    return changeLog.markSessionWontDeploy(id, { by, reason: text, at })
}

async function unmarkWontDeploy(id, { ideToken, client } = {}) {
    const session = changeLog.getSession(id)
    if (!session) return null
    await changeSetModel.updateClosedRecord(session.server, id, {
        wont_deploy_at: null,
        wont_deploy_by: null,
        wont_deploy_reason: null,
    }, { ideToken, client })
    return changeLog.unmarkSessionWontDeploy(id)
}

// After a catch-up deploy succeeds, every closed set it carried counts as
// released: covered_by the catch-up, covered_at when it shipped. An open set is
// never covered — its work may have shipped, but the set stays in play. Called
// only where markSessionDeployed runs, i.e. only after a clean deploy.
async function markCoveredAfterDeploy(catchUpId, { ideToken, client } = {}) {
    const session = changeLog.getSession(catchUpId)
    if (!session || session.kind !== 'catch-up') return []
    let ids
    try { ids = session.covered_sets ? JSON.parse(session.covered_sets) : [] } catch { ids = [] }
    const marked = []
    for (const id of Array.isArray(ids) ? ids : []) {
        if (id === catchUpId) continue
        const covered = changeLog.getSession(id)
        if (!covered || !covered.closed_at || covered.wont_deploy_at || covered.covered_by) continue
        const at = new Date().toISOString()
        await changeSetModel.updateClosedRecord(covered.server, id, { covered_by: catchUpId, covered_at: at }, { ideToken, client })
        changeLog.markSessionCovered(id, { by: catchUpId, at })
        marked.push(id)
    }
    return marked
}

module.exports = { closeChangeSet, markWontDeploy, unmarkWontDeploy, markCoveredAfterDeploy }
