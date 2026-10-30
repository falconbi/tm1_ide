'use strict'
// create_chore must let the caller choose the commit mode: SingleCommit (default,
// one transaction) or MultipleCommit (commits after each step, so a long
// multi-step job never holds one long lock). It used to hardcode SingleCommit —
// a trap for any future snapshot-style chore.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./_mcp-harness')

function choreTm1() {
    const calls = []
    return { who: 'builder', calls, async createChore(payload) { calls.push(payload); return {} } }
}

test('create_chore defaults to SingleCommit (existing callers unchanged)', async () => {
    const b = choreTm1()
    const h = setup({ mode: 'build', builder: b })
    const r = await h.call('create_chore', { name: 'Nightly', steps: [{ process: 'Load Sales' }] })
    assert.equal(r.isError, false, r.text)
    assert.equal(b.calls.length, 1)
    assert.equal(b.calls[0].ExecutionMode, 'SingleCommit')
})

test('create_chore honours execution_mode: MultipleCommit', async () => {
    const b = choreTm1()
    const h = setup({ mode: 'build', builder: b })
    const r = await h.call('create_chore', { name: 'Nightly', steps: [{ process: 'Load Sales' }], execution_mode: 'MultipleCommit' })
    assert.equal(r.isError, false, r.text)
    assert.equal(b.calls[0].ExecutionMode, 'MultipleCommit')
})
