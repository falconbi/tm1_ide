'use strict'

// Part A — a change set's deploy record is per server. TEST and PROD each get
// their own row, release and outcome; the old single `deployed_target` column is
// still written but is no longer what decisions read.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

// In-memory change log.
const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))

function open(name = 'set') {
    return cl.startSession(name, 'DEV1', 'admin')
}

test('one deploy row per target; the old column keeps the last target', () => {
    const s = open()
    cl.recordSessionDeploy(s.id, { target: 'TEST', release_commit: 'r-test', status: 'complete' })
    cl.recordSessionDeploy(s.id, { target: 'PROD', release_commit: 'r-prod', status: 'complete' })

    const rows = cl.getSessionDeploys(s.id)
    assert.equal(rows.length, 2, 'TEST and PROD are two records')
    assert.deepEqual(rows.map(r => r.target).sort(), ['PROD', 'TEST'])
    assert.deepEqual(cl.deployTargets(s.id).sort(), ['PROD', 'TEST'])
    assert.equal(cl.getSession(s.id).deployed_target, 'PROD', 'compat column = last target')
    assert.equal(cl.hasCompleteDeploy(s.id, 'PROD'), true)
})

test('recording the same target again updates its row instead of adding one', () => {
    const s = open()
    cl.recordSessionDeploy(s.id, { target: 'PROD', status: 'incomplete', status_reason: 'subset failed' })
    cl.recordSessionDeploy(s.id, { target: 'PROD', release_commit: 'r2', status: 'complete' })
    const rows = cl.getSessionDeploys(s.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'complete')
    assert.equal(rows[0].release_commit, 'r2')
})

test('markSessionDeployed keeps its old signature and writes a complete record', () => {
    const s = open()
    cl.markSessionDeployed(s.id, 'TEST')
    const row = cl.getSessionDeploy(s.id, 'TEST')
    assert.equal(row.status, 'complete')
    assert.equal(cl.getSession(s.id).deployed_target, 'TEST')
})

test('a reverted deploy stops counting as reached and clears the compat column', () => {
    const s = open()
    cl.recordSessionDeploy(s.id, { target: 'PROD', status: 'complete' })
    assert.equal(cl.hasAnyDeploy(s.id), true)
    cl.setSessionDeployStatus(s.id, 'PROD', 'reverted', 'restored from backup')
    assert.equal(cl.hasAnyDeploy(s.id), false, 'a reverted set is waiting again')
    assert.equal(cl.hasCompleteDeploy(s.id, 'PROD'), false)
    assert.equal(cl.getSession(s.id).deployed_target, null)
    assert.equal(cl.getSessionDeploy(s.id, 'PROD').status_reason, 'restored from backup')
})

test('a build for PROD does not overwrite the release already built for TEST', () => {
    const s = open()
    cl.setSessionRelease(s.id, 'r-test', 'TEST')
    cl.setSessionRelease(s.id, 'r-prod', 'PROD')
    assert.equal(cl.getSessionRelease(s.id, 'TEST').release_commit, 'r-test')
    assert.equal(cl.getSessionRelease(s.id, 'PROD').release_commit, 'r-prod')
    assert.equal(cl.getSessionReleases(s.id).length, 2)
    assert.equal(cl.getSession(s.id).release_target, 'PROD', 'compat column = last build')
})

test('ownerOf is per target: a set deployed to TEST still owns its work for PROD', () => {
    const { ownerOf } = require(path.join(__dirname, '..', 'core', 'git-release'))
    const logs = [{
        name: 'Contractor rollup', user: 'james',
        deployed_target: 'TEST', deployed_targets: ['TEST'],
        entries: [{ object_type: 'dimension', object_name: 'Employee', action: 'ELEMENT_ADDED' }],
    }]
    const obj = { type: 'dimension', name: 'Employee' }
    assert.deepEqual(ownerOf(logs, obj, 'PROD'), { sessionName: 'Contractor rollup', user: 'james' },
        'still the owner for PROD')
    assert.equal(ownerOf(logs, obj, 'TEST'), null, 'owns nothing more on TEST')
    // No target keeps the old any-target meaning.
    assert.equal(ownerOf(logs, obj), null)
})

test('readyForTarget: a TEST deploy is still ready for PROD', async () => {
    const { readyForTarget, deployedTo } = await import('../client/src/lib/deploy/change-sets.js')
    const set = {
        id: 'x', closed_at: '2026-11-24T10:00:00Z', started_at: '2026-11-24T09:00:00Z',
        entry_count: 2, wont_deploy_at: null, covered_by: null, phantom: false,
        no_change_at: null, kind: 'change', deployed_target: 'TEST',
        deploys: [{ target: 'TEST', status: 'complete', deployed_at: '2026-11-24T12:00:00Z' }],
    }
    assert.equal(deployedTo(set, 'TEST'), true)
    assert.equal(deployedTo(set, 'PROD'), false)
    assert.equal(readyForTarget([set], 'PROD').length, 1, 'waiting for PROD')
    assert.equal(readyForTarget([set], 'TEST').length, 0, 'already on TEST')
})

test('readyForTarget excludes sync everywhere, and carry-back only from PROD', async () => {
    const { readyForTarget } = await import('../client/src/lib/deploy/change-sets.js')
    const base = {
        closed_at: '2026-11-24T10:00:00Z', entry_count: 1, deploys: [], deployed_target: null,
    }
    const rows = [
        { ...base, id: 'a', name: 'sync', kind: 'sync' },
        { ...base, id: 'b', name: 'carry', kind: 'carry-back' },
        { ...base, id: 'c', name: 'real', kind: 'change' },
    ]
    assert.deepEqual(readyForTarget(rows, 'PROD').map(s => s.name), ['real'])
    // D.4.5 — a carry-back is deployed to TEST normally.
    assert.deepEqual(readyForTarget(rows, 'TEST').map(s => s.name).sort(), ['carry', 'real'])
})
