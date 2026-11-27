'use strict'

// A sync writes PROD's changes into DEV. If a change set is open on DEV, that
// moves the data under in-flight work — so the sync is refused, naming the sets.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { syncDevFromProd } = require('../core/sync-dev')

test('a sync with an open change set is refused and names every set', async () => {
    const open = [
        { id: '1', name: 'Contractor rollup', user: 'admin' },
        { id: '2', name: 'Rates v2', user: 'jdoe' },
    ]
    const r = await syncDevFromProd('TM1_Test_DEV', 'TM1_Test_PROD', {
        deps: { openChangeSets: () => open },
    })

    assert.equal(r.refused, true)
    assert.match(r.error, /2 open change sets/)
    assert.match(r.error, /Contractor rollup, Rates v2/)
    assert.match(r.error, /Close or retire them first/)
    assert.deepEqual(r.openChangeSets, open)
})

test('the guard runs before the idle check and the plan', async () => {
    let idleCalled = false
    const r = await syncDevFromProd('DEV', 'PROD', {
        idleCheck: async () => { idleCalled = true; return { running: [] } },
        deps: { openChangeSets: () => [{ id: '1', name: 'One', user: 'admin' }] },
    })
    assert.equal(r.refused, true)
    assert.equal(idleCalled, false)
})
