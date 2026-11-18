'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, exportsObj) => {
    const r = resolve(rel)
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exportsObj }
}

// In-memory change log so the release/approval link is real.
const realBsq = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBsq(':memory:') } }
const cl = require(resolve('core/change-log'))

let approval = null
let reconcileResult = {}
let assertionsResult = { failed: [], results: [], total: 0, passed: 0 }

const arReal = require(resolve('core/adapter-registry'))
stub('core/adapter-registry', {
    ...arReal,
    makeClient: () => ({
        async post(route) {
            if (route === 'GitStatus') return { URL: 'https://repo', LocalCommit: { ID: 'C1' }, DeployedCommit: { ID: 'C1' } }
            if (route === 'GitPull') return { ID: 'PLAN', Commit: { ID: 'C1' }, Operations: ["Update Cubes('A')"] }
            return {}
        },
        async get() { return {} }, async patch() { return {} }, async delete() { return {} },
    }),
})
stub('core/git-lock', { acquire: async () => ({ by: 't' }), release: async () => ({ ok: true }) })
stub('core/git-state', { lastDeployed: () => ({ lastDeployedCommit: 'BASE' }), recordDeploy: async () => ({ ok: true }) })
stub('core/git-drift', { driftCheck: async () => ({ entries: [], deployed: 'BASE' }) })
stub('core/git-reconcile', { reconcile: async () => reconcileResult })
stub('core/git-release', {
    changedObjects: async () => ([{ type: 'cube', name: 'A' }]),
    objectKey: (type, name) => `${type}::${String(name).toLowerCase()}`,
    expectedPlanKeys: (objects) => new Set((objects ?? []).map(o => `${o.type}::${String(o.name).toLowerCase()}`)),
    applyReleaseComplement: async () => ({ errors: [] }),
    verifyRelease: async () => [],
})
stub('core/git-approvals', {
    find: async () => approval,
    sameCommit: (a, b) => a === b,
})
const realAssertions = require(resolve('core/assertions'))
stub('core/assertions', { ...realAssertions, run: async () => assertionsResult })

const { execute } = require(resolve('core/git-deploy'))

function releasedSession(server = 'DEV1') {
    const s = cl.startSession('release', server, 'admin')
    cl.setSessionCommit(s.id, 'C1')
    cl.setSessionRelease(s.id, 'C1', 'TG1')
    return s
}

test('release mode without a linked change set requires source', async () => {
    const s = releasedSession('DEV1')
    approval = { target: 'TG1', commit: 'C1', approver: 'u', session: null }
    const out = await execute('TG1', { session: s.id, token: 'x' })
    assert.equal(out.executed, false)
    assert.equal(out.missingSource, true)
    assert.match(out.error, /source is required/i)
})

test('a source that differs from the approved change set is refused', async () => {
    const s = releasedSession('DEV1')
    approval = { target: 'TG1', commit: 'C1', approver: 'u', session: s.id }
    const out = await execute('TG1', { session: s.id, source: 'OTHER_DEV', token: 'x' })
    assert.equal(out.executed, false)
    assert.equal(out.refused, true)
    assert.match(out.error, /source does not match/i)
})

test('a reconcile error makes controlOk false with a reason', async () => {
    const s = releasedSession('DEV1')
    approval = { target: 'TG1', commit: 'C1', approver: 'u', session: s.id }
    reconcileResult = { deletes: { error: 'delete api down' }, attributeValues: { errors: [] } }
    assertionsResult = { total: 1, passed: 1, failed: [], results: [{ id: 'a', pass: true }] }
    const out = await execute('TG1', { session: s.id, token: 'x' })
    assert.equal(out.executed, true)
    assert.equal(out.controlOk, false)
    assert.ok(out.controlReasons.some(r => /delete api down/.test(r)))
})

test('a skipped delete makes controlOk false with a reason', async () => {
    const s = releasedSession('DEV1')
    approval = { target: 'TG1', commit: 'C1', approver: 'u', session: s.id }
    reconcileResult = { deletes: { flagged: [{ type: 'subset', name: 'Old', error: 'not auto-applied' }] }, attributeValues: { errors: [] } }
    assertionsResult = { total: 1, passed: 1, failed: [], results: [{ id: 'a', pass: true }] }
    const out = await execute('TG1', { session: s.id, token: 'x' })
    assert.equal(out.executed, true)
    assert.equal(out.controlOk, false)
    assert.ok(out.controlReasons.some(r => /subset Old/.test(r)))
})
