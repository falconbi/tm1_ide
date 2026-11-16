'use strict'

// One close sequence for both the IDE route and the MCP: persist the immutable
// model-owned record first (loud on a migrated server), then mark the local
// change set closed. Keeping this in one place stops the two surfaces drifting.

const changeLog = require('./change_log')
const changeSetModel = require('./change-set-model')

async function closeChangeSet(id, { user, tests = null, ideToken, client } = {}) {
    const session = changeLog.getSession(id)
    if (!session) return null
    await changeSetModel.closeAndPersist(session.server, session, { closedBy: user, tests, ideToken, client })
    return changeLog.closeSession(id, { user, tests })
}

module.exports = { closeChangeSet }
