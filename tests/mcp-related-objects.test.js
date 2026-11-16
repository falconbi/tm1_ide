'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup, fakeTm1 } = require('./_mcp-harness')

function readerWith(overrides) {
    return Object.assign(fakeTm1('reader'), overrides)
}

test('get_cube_dimensions honours the dimension policy', async () => {
    const reader = readerWith({
        async get() { return { value: [{ Name: 'Region' }, { Name: 'Secret' }] } },
    })
    const h = setup({ mode: 'readonly', builder: reader, policyRaw: { '*': { dimensions: { deny: ['Secret'] } } } })
    const { data } = await h.call('get_cube_dimensions', { cube: 'Sales' })
    assert.deepEqual(data, ['Region'])
})

test('get_chore masks denied process names in its steps', async () => {
    const reader = readerWith({
        async getChore() {
            return {
                Name: 'Nightly', Active: true, Frequency: 'D', StartTime: '01:00',
                Tasks: [
                    { Step: 1, Process: { Name: 'AllowedProc' } },
                    { Step: 2, ProcessName: 'SecretProc' },
                ],
            }
        },
    })
    const h = setup({ mode: 'readonly', builder: reader, policyRaw: { '*': { processes: { deny: ['SecretProc'] } } } })
    const { data } = await h.call('get_chore', { chore: 'Nightly' })
    assert.deepEqual(data.steps.map(s => s.process), ['AllowedProc', '(not visible)'])
})

test('get_active_threads masks denied process and function names', async () => {
    const reader = readerWith({
        async getThreads() {
            return { value: [
                { Name: '1', Process: { Name: 'AllowedProc' }, Function: 'AllowedProc' },
                { Name: '2', ProcessName: 'SecretProc', Function: 'SecretProc' },
            ] }
        },
    })
    const h = setup({ mode: 'readonly', builder: reader, policyRaw: { '*': { processes: { deny: ['SecretProc'] } } } })
    const { data } = await h.call('get_active_threads')
    assert.equal(data[0].Process.Name, 'AllowedProc')
    assert.equal(data[1].ProcessName, '(not visible)')
    assert.equal(data[1].Function, '(not visible)')
})
