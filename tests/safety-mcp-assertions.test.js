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
