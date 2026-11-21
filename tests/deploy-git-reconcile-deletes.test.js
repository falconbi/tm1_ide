'use strict'

// A change set can delete something the target never had — an object added and
// removed since the last deploy. That used to be flagged as a failure, which set
// controlOk false, so a perfectly clean deploy was never marked deployed and the
// change set stayed "ready to ship" for ever.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))
const arReal = require(resolve('core/adapter-registry'))

const calls = []
const target = {
    async getProcesses() { return ['Existing Process'] },
    async getDimensions() { return [{ Name: 'Account' }] },
    async getCubes() { return [{ Name: 'Cube A' }] },
    async getChores() { return [{ Name: 'Chore A' }] },
    async deleteDimension(name) { calls.push(`dimension:${name}`) },
    async deleteProcess(name) { calls.push(`process:${name}`) },
}

require.cache[resolve('core/adapter-registry')] = {
    id: resolve('core/adapter-registry'),
    filename: resolve('core/adapter-registry'),
    loaded: true,
    exports: { ...arReal, makeClient: () => target },
}

const { reconcileDeletes } = require(resolve('core/git-reconcile'))

test('deleting an object the target never had is success, not a failure', async () => {
    calls.length = 0
    const out = await reconcileDeletes('SRC', 'TGT', {
        deletes: [
            { type: 'dimension', name: 'Already Gone' },
            { type: 'dimension', name: 'Account' },
            { type: 'process', name: 'Also Gone' },
            { type: 'process', name: 'Existing Process' },
        ],
    })

    assert.deepEqual(out.flagged, [], 'nothing is flagged')
    // Deletes run in dependency order: processes before dimensions.
    assert.deepEqual(out.alreadyGone, [
        { type: 'process', name: 'Also Gone' },
        { type: 'dimension', name: 'Already Gone' },
    ])
    assert.deepEqual(out.deleted, [
        { type: 'process', name: 'Existing Process' },
        { type: 'dimension', name: 'Account' },
    ])
    assert.deepEqual(calls.sort(), ['dimension:Account', 'process:Existing Process'])
    assert.equal(out.error, undefined)
})
