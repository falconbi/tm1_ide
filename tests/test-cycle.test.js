'use strict'

// Part L — the TEST cycle is derived, not an admin list.
//
//   1. a re-clone starts a new cycle;
//   2. every change set deployed to TEST after it is in the cycle;
//   3. once one of them reaches PROD, a set outside the cycle is refused until
//      the next re-clone;
//   4. a set that reached TEST but never PROD may be retired.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))
const { deriveCycle, canDeployToTest, reachedTestOnly } = require(path.join(__dirname, '..', 'core', 'test-cycle'))

function closed(name, server) {
    const s = cl.startSession(name, server, 'dev')
    cl.closeSession(s.id, { user: 'dev', tests: { passed: 1, total: 1, blocking: 0 } })
    return s
}

test('a re-clone starts a cycle; a later TEST deploy is in it', () => {
    cl.recordTestReclone('C1-TEST', { by: 'admin', at: '2026-11-20T09:00:00.000Z' })
    const a = closed('rollup', 'C1')
    cl.recordSessionDeploy(a.id, { target: 'C1-TEST', status: 'complete', deployed_at: '2026-11-21T09:00:00.000Z' })

    const cyc = deriveCycle('C1-TEST')
    assert.equal(cyc.open, true)
    assert.equal(cyc.startedAt, '2026-11-20T09:00:00.000Z')
    assert.deepEqual(cyc.members, [a.id])
    assert.equal(canDeployToTest('C1-TEST', a.id).ok, true)
})

test('a set outside a closed cycle is refused and the re-clone is named', () => {
    cl.recordTestReclone('C2-TEST', { at: '2026-11-20T09:00:00.000Z' })
    const inCycle = closed('first', 'C2')
    cl.recordSessionDeploy(inCycle.id, { target: 'C2-TEST', status: 'complete', deployed_at: '2026-11-21T09:00:00.000Z' })
    cl.recordSessionDeploy(inCycle.id, { target: 'C2-PROD', status: 'complete', deployed_at: '2026-11-22T09:00:00.000Z' })

    const cyc = deriveCycle('C2-TEST')
    assert.equal(cyc.open, false)
    assert.equal(cyc.closedBy.target, 'C2-PROD')
    // A set already in the cycle may still be deployed to TEST (a retry).
    assert.equal(canDeployToTest('C2-TEST', inCycle.id).ok, true)

    const outsider = closed('later', 'C2')
    const r = canDeployToTest('C2-TEST', outsider.id)
    assert.equal(r.ok, false)
    assert.match(r.error, /cycle is closed/)
    assert.match(r.error, /Re-clone TEST from PROD/)
})

test('a new re-clone reopens the cycle for a new set', () => {
    cl.recordTestReclone('C3-TEST', { at: '2026-11-20T09:00:00.000Z' })
    const a = closed('old', 'C3')
    cl.recordSessionDeploy(a.id, { target: 'C3-TEST', status: 'complete', deployed_at: '2026-11-21T09:00:00.000Z' })
    cl.recordSessionDeploy(a.id, { target: 'C3-PROD', status: 'complete', deployed_at: '2026-11-22T09:00:00.000Z' })

    const b = closed('new', 'C3')
    assert.equal(canDeployToTest('C3-TEST', b.id).ok, false)

    cl.recordTestReclone('C3-TEST', { at: '2026-11-23T09:00:00.000Z' })
    const cyc = deriveCycle('C3-TEST')
    assert.equal(cyc.open, true)
    assert.deepEqual(cyc.members, [], 'the old deploy is before the new re-clone')
    assert.equal(canDeployToTest('C3-TEST', b.id).ok, true)
})

test('retire is allowed when a set reached TEST but never PROD', async () => {
    const onlyTest = closed('test only', 'C4')
    cl.recordSessionDeploy(onlyTest.id, { target: 'C4-TEST', status: 'complete' })
    assert.equal(await reachedTestOnly(onlyTest.id, { labelFn: () => 'TEST' }), true)

    const throughProd = closed('to prod', 'C4')
    cl.recordSessionDeploy(throughProd.id, { target: 'C4-TEST', status: 'complete' })
    cl.recordSessionDeploy(throughProd.id, { target: 'C4-PROD', status: 'complete' })
    assert.equal(await reachedTestOnly(throughProd.id, { labelFn: () => 'PROD' }), false)
})
