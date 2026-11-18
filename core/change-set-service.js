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

module.exports = { closeChangeSet, markWontDeploy, unmarkWontDeploy }
