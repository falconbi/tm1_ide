'use strict'

// TM1 refuses to delete a process a chore still holds. The reconcile used to try
// the process first, swallow the refusal into "skipped", and leave it on the
// target — the deploy then said it was clean. Two things are pinned here:
//   - deletes run in dependency order (chore before its process, and so on);
//   - a delete that fails is a FAILURE, reported with TM1's message.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, exportsObj) => {
    const r = resolve(rel)
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exportsObj }
}

test('a chore is deleted before the process it holds', async () => {
    const calls = []
    const client = {
        getProcesses: async () => ['P'],
        getDimensions: async () => [],
        getCubes: async () => [],
        getChores: async () => ['C'],
        deleteProcess: async (n) => { calls.push(`process ${n}`) },
        deleteChore: async (n) => { calls.push(`chore ${n}`) },
    }
    stub('core/adapter-registry', { makeClient: () => client })
    delete require.cache[resolve('core/git-reconcile')]
    const { reconcileDeletes } = require('../core/git-reconcile')
    const r = await reconcileDeletes('DEV', 'PROD', { deletes: [{ type: 'process', name: 'P' }, { type: 'chore', name: 'C' }] })
    assert.deepEqual(calls, ['chore C', 'process P'])
    assert.equal(r.deleted.length, 2)
    assert.equal(r.failed.length, 0)
})

test('a start-time view is deleted before its cube, a subset before its dimension', async () => {
    const calls = []
    const client = {
        getProcesses: async () => [], getChores: async () => [], getDimensions: async () => ['D'], getCubes: async () => ['C'],
        deleteView: async (c, n) => { calls.push(`view ${c}/${n}`) },
        deleteCube: async (n) => { calls.push(`cube ${n}`) },
        deleteSubset: async (d, n) => { calls.push(`subset ${d}/${n}`) },
        deleteDimension: async (n) => { calls.push(`dimension ${n}`) },
    }
    stub('core/adapter-registry', { makeClient: () => client })
    delete require.cache[resolve('core/git-reconcile')]
    const { reconcileDeletes } = require('../core/git-reconcile')
    await reconcileDeletes('DEV', 'PROD', { deletes: [
        { type: 'dimension', name: 'D' },
        { type: 'cube', name: 'C' },
        { type: 'subset', name: 'S', parent: 'D' },
        { type: 'view', name: 'V', parent: 'C' },
    ] })
    assert.deepEqual(calls, ['view C/V', 'subset D/S', 'cube C', 'dimension D'])
})

test('a refused delete is a FAILURE with TM1\'s message, not a skip', async () => {
    const client = {
        getProcesses: async () => ['P'], getChores: async () => [], getDimensions: async () => [], getCubes: async () => [],
        deleteProcess: async () => { throw new Error('chore C is still using process P') },
    }
    stub('core/adapter-registry', { makeClient: () => client })
    delete require.cache[resolve('core/git-reconcile')]
    const { reconcileDeletes } = require('../core/git-reconcile')
    const r = await reconcileDeletes('DEV', 'PROD', { deletes: [{ type: 'process', name: 'P' }] })
    assert.equal(r.deleted.length, 0)
    assert.equal(r.failed.length, 1)
    assert.match(r.failed[0].error, /still using/)
})

test('an object already gone is a success, not a failure', async () => {
    const client = {
        getProcesses: async () => [], getChores: async () => [], getDimensions: async () => [], getCubes: async () => [],
    }
    stub('core/adapter-registry', { makeClient: () => client })
    delete require.cache[resolve('core/git-reconcile')]
    const { reconcileDeletes } = require('../core/git-reconcile')
    const r = await reconcileDeletes('DEV', 'PROD', { deletes: [{ type: 'process', name: 'Gone' }] })
    assert.deepEqual(r.alreadyGone, [{ type: 'process', name: 'Gone' }])
    assert.equal(r.failed.length, 0)
})
