'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./_mcp-harness')
const guard = require('../tools/tm1mcp/guard')
const { assertionVisible } = guard

function assertionStore(records) {
    return {
        async list() { return { source: 'model', assertions: records } },
        async add(_server, rec) { return { ...rec, id: 'a1' } },
        async update(_server, id, patch) { const a = records.find(x => x.id === id); return a ? { ...a, ...patch } : null },
        async remove() { return true },
    }
}

test('add_assertion never executes MDX', async () => {
    const builder = {
        async executeMDX() { throw new Error('add_assertion must not execute MDX') },
    }
    const h = setup({ mode: 'build', assertions: assertionStore([]), builder })
    const r = await h.call('add_assertion', {
        description: 'check', mdx: "SELECT 1 ON 0 FROM [Secret]", expected: 1,
    })
    assert.equal(r.data.added, 'a1')
    assert.deepEqual(r.data.next, 'run_assertions with ids: [a1] to check it')
})

test('assertionVisible blocks a denied stored MDX', () => {
    const p = guard.buildPolicy({ '*': { cubes: { deny: ['Secret'] } } }, 'TestSrv')
    assert.equal(assertionVisible(p, "SELECT 1 ON 0 FROM [Secret]"), false)
    assert.equal(assertionVisible(p, "SELECT 1 ON 0 FROM [Open]"), true)
})

test('list_assertions redacts a denied stored MDX', async () => {
    const stored = [{ id: 'denied', description: 'secret', mdx: "SELECT 1 ON 0 FROM [Secret]", expected: 1, tags: [] }]
    const h = setup({ mode: 'readonly', policyRaw: { '*': { cubes: { deny: ['Secret'] } } }, assertions: assertionStore(stored) })
    const r = await h.call('list_assertions', {})
    assert.equal(r.data.assertions[0].status, 'not visible')
    assert.equal(r.data.assertions[0].mdx, null)
})

test('assertion writes are logged even though they are ungated', async () => {
    const h = setup({ mode: 'build', assertions: assertionStore([]) })
    await h.call('add_assertion', { description: 'check', mdx: 'SELECT 1 ON 0 FROM [Open]', expected: 1 })
    await h.call('remove_assertion', { id: 'a1' })
    assert.deepEqual(h.changes.map(c => c[0]), ['ASSERTION_ADDED', 'ASSERTION_REMOVED'])
    assert.equal(h.changes[0][2], 'a1')
})

test('update_assertion records the old and new expected value', async () => {
    const stored = [{ id: 'a1', description: 'Baseline check', mdx: 'SELECT 1 ON 0 FROM [Open]', expected: 10, tolerance: 0.01 }]
    const h = setup({ mode: 'build', assertions: assertionStore(stored) })
    const r = await h.call('update_assertion', { id: 'a1', expected: 12, why: 'headcount baseline moved' })
    assert.equal(r.data.from, 10)
    assert.equal(r.data.to, 12)
    assert.equal(r.isError, false)
    assert.equal(h.changes[0][0], 'ASSERTION_UPDATED')
    assert.equal(h.changes[0][3].detail.from, 10)
    assert.equal(h.changes[0][3].detail.to, 12)
    assert.equal(h.changes[0][3].detail.why, 'headcount baseline moved')
})
