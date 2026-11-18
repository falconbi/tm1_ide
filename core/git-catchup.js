'use strict'

// ── Catch-up release ─────────────────────────────────────────────────────────
// One explicit exception to "one change set per release, in order". A catch-up
// brings a target level with DEV in a single built release, for a target whose
// history predates change-set releases. It is still a change set (kind
// 'catch-up') with a commit_ref and a built release, so prepare, approve,
// execute, verify and history work unchanged.
//
// Starting it needs: a TM1 admin, a target with a recorded deployed commit, a
// source with a pushed commit, and the exact typed sentence. It creates a
// closed, empty change set named after the direction and date.

const { makeClient } = require('./adapter-registry')
const { lastDeployed } = require('./git-state')
const { sanitize } = require('./git-repo')
const cl = require('./change-log')
const { NO_BASE_ERROR } = require('./git-release')
const { closeChangeSet } = require('./change-set-service')

const sentenceFor = (source, target) => `I understand this brings ${target} level with ${source}`

// The source's current pushed commit, read from GitStatus. TM1 reports a local
// commit whether or not a push has happened; when it reports pending local
// changes (or no local commit at all) DEV is not ready and must be committed
// first. Returns { ok, commit } or { ok: false, error }.
function sourcePushedCommit(status) {
    // Some TM1 v11 builds return no LocalCommit; GitStatus.DeployedCommit is the
    // pushed head of the source's branch in that case.
    const local = status?.LocalCommit?.ID ?? status?.DeployedCommit?.ID ?? null
    const pending = status?.HasLocalChanges === true
        || status?.UnpushedChanges === true
        || status?.LocalCommit?.HasChanges === true
        || (Array.isArray(status?.Changes) && status.Changes.length > 0)
        || (Array.isArray(status?.LocalChanges) && status.LocalChanges.length > 0)
    if (!local || local === '-') return { ok: false, error: 'Commit DEV first — its Git has no pushed commit yet.' }
    if (pending) return { ok: false, error: 'Commit DEV first — it has changes that are not pushed.' }
    return { ok: true, commit: local }
}

function catchUpName(source, target, date = new Date()) {
    return `Catch-up: ${target} level with ${source} (${date.toISOString().slice(0, 10)})`
}

// Create the closed, empty catch-up change set. The route has already checked
// the caller is a TM1 admin on the source.
async function startCatchUp({ source, target, confirm, user, token, gitUser, ideToken } = {}) {
    if (!source || !target) return { ok: false, refused: true, error: 'source and target are required.' }
    if (source === target) return { ok: false, refused: true, error: 'A catch-up needs two different servers.' }
    const base = lastDeployed(target)?.lastDeployedCommit
    if (!base) return { ok: false, refused: true, error: NO_BASE_ERROR(target) }

    let status
    try {
        status = await makeClient(source, ideToken).post('GitStatus', { Username: gitUser, Password: token })
    } catch (e) {
        return { ok: false, refused: true, error: `Could not read ${source}'s Git status: ${sanitize(e.response?.data?.error?.message ?? e.message, token)}` }
    }
    const pushed = sourcePushedCommit(status)
    if (!pushed.ok) return { ok: false, refused: true, error: pushed.error }

    const expected = sentenceFor(source, target)
    if (String(confirm ?? '').trim() !== expected) {
        return { ok: false, refused: true, error: `Type exactly: ${expected}` }
    }

    const session = cl.startSession(catchUpName(source, target), source, user, 'catch-up')
    cl.setSessionCommit(session.id, pushed.commit)
    const closed = await closeChangeSet(session.id, { user, ideToken })
    return { ok: true, session: closed, commit: pushed.commit, sentence: expected }
}

module.exports = { sourcePushedCommit, catchUpName, sentenceFor, startCatchUp }
