'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, exportsObj) => {
    const r = resolve(rel)
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exportsObj }
}

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

// Stub the registry BEFORE requiring git-deploy (it captures makeClient at load).
const arReal = require(resolve('core/adapter_registry'))
stub('core/adapter_registry', { ...arReal, makeClient: () => fakeClient() })

// Lock is required at call time — track acquire/release.
let acquireCount = 0, releaseCount = 0
stub('core/git-lock', {
    acquire: async () => { acquireCount++; return { by: 't', at: 'now' } },
    release: async () => { releaseCount++; return { ok: true } },
    current: async () => null, clear: async () => ({ ok: true }),
})
stub('core/git-state',   { recordDeploy: async () => ({ ok: true }), lastDeployed: () => null, load: () => ({}), FILE: '' })
stub('core/git-reconcile', { reconcile: async () => ({ restored: [], skipped: [], errors: [] }) })

// An approval always exists — we are testing only the commit-verification gate.
const approvals = require(resolve('core/git-approvals'))
approvals.find = async () => ({ target: 'TM1_Test_PROD', commit: incomingCommit, approver: 'reviewer', approved_at: 'now', session: null })

const { execute } = require(resolve('core/git-deploy'))

test('a pull plan with no commit id is refused (fails closed) and the lock is released', async () => {
    planCommit = null                       // GitPull returns no Commit.ID
    incomingCommit = 'INCOMING1'
    acquireCount = 0; releaseCount = 0
    const out = await execute('TM1_Test_PROD', { source: 'TM1_Test_DEV', gitUser: 't', token: 'x' })
    assert.equal(out.refused, true)
    assert.equal(out.executed, false)
    assert.match(out.error, /cannot verify the commit/i)
    assert.equal(acquireCount, 1, 'lock acquired before verification')
    assert.equal(releaseCount, 1, 'lock released on refusal')
})

test('a moved commit is refused with refused: true', async () => {
    planCommit = { ID: 'OTHER99', Summary: 's' }   // branch head ≠ approved incoming
    incomingCommit = 'INCOMING1'
    acquireCount = 0; releaseCount = 0
    const out = await execute('TM1_Test_PROD', { source: 'TM1_Test_DEV', gitUser: 't', token: 'x' })
    assert.equal(out.refused, true)
    assert.equal(out.executed, false)
    assert.match(out.error, /commit moved/i)
    assert.equal(releaseCount, 1, 'lock released on refusal')
})