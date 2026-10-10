'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, exportsObj) => {
    const r = resolve(rel)
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exportsObj }
}

// In-memory change_log (a release change set is required for execute to deploy).
const realBsq = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBsq(':memory:') } }
const cl = require(path.join(__dirname, '..', 'core', 'change_log'))

// ── Fake TM1 client (routers on the OData route string) ──────────────────────
let incomingCommit = 'INCOMING1'
let planCommit = null
function fakeClient() {
    return {
        async post(route) {
            if (route === 'GitStatus') return { LocalCommit: { ID: incomingCommit }, DeployedCommit: { ID: incomingCommit } }
            if (route === 'GitPull')   return { ID: 'PLAN1', Commit: planCommit, Operations: [] }
            return {}
        },
        async get() { return {} }, async patch() { return {} }, async delete() { return {} },
    }
}

const arReal = require(resolve('core/adapter_registry'))
stub('core/adapter_registry', { ...arReal, makeClient: () => fakeClient() })

let acquireCount = 0, releaseCount = 0
stub('core/git-lock', {
    acquire: async () => { acquireCount++; return { by: 't', at: 'now' } },
    release: async () => { releaseCount++; return { ok: true } },
    current: async () => null, clear: async () => ({ ok: true }),
})
stub('core/git-state',   { recordDeploy: async () => ({ ok: true }), lastDeployed: () => null, load: () => ({}), FILE: '' })
stub('core/git-reconcile', { reconcile: async () => ({ restored: [], skipped: [], errors: [] }) })
// No repo URL → driftCheck returns "no deployed commit" clean; never a blocker here.
stub('core/git-drift', { driftCheck: async () => ({ entries: [] }), revert: async () => ({}), promote: async () => ({ ok: true }) })

const approvals = require(resolve('core/git-approvals'))
approvals.find = async () => ({ target: 'TM1_Test_PROD', commit: incomingCommit, approver: 'reviewer', approved_at: 'now', session: ctx?.sessionId })

const { execute } = require(resolve('core/git-deploy'))

let ctx = null

test('a pull plan with no commit id is refused (fails closed) and the lock is released', async () => {
    planCommit = null                       // GitPull returns no Commit.ID
    incomingCommit = 'INCOMING1'
    const s = cl.startSession('RC', 'DEV1', 'admin')
    cl.setSessionRelease(s.id, incomingCommit, 'TM1_Test_PROD')
    ctx = { sessionId: s.id }
    acquireCount = 0; releaseCount = 0
    const out = await execute('TM1_Test_PROD', { session: s.id, token: 'x', gitUser: 't' })
    assert.equal(out.refused, true)
    assert.equal(out.executed, false)
    assert.match(out.error, /cannot verify the commit/i)
    assert.equal(acquireCount, 1, 'lock acquired before verification')
    assert.equal(releaseCount, 1, 'lock released on refusal')
})

test('a moved commit is refused with refused: true', async () => {
    planCommit = { ID: 'OTHER99', Summary: 's' }   // branch head ≠ approved incoming
    incomingCommit = 'INCOMING1'
    const s = cl.startSession('RC2', 'DEV1', 'admin')
    cl.setSessionRelease(s.id, incomingCommit, 'TM1_Test_PROD')
    ctx = { sessionId: s.id }
    acquireCount = 0; releaseCount = 0
    const out = await execute('TM1_Test_PROD', { session: s.id, token: 'x', gitUser: 't' })
    assert.equal(out.refused, true)
    assert.equal(out.executed, false)
    assert.match(out.error, /commit moved/i)
    assert.equal(releaseCount, 1, 'lock released on refusal')
})