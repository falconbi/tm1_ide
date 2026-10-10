'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, o) => { const r = resolve(rel); require.cache[r] = { id: r, filename: r, loaded: true, exports: o } }

let fakeReadOnly = false
function fakeClient() {
    return { async post() { return {} }, async get() { return {} }, async patch() { return {} }, async delete() { return {} } }
}

const arReal = require(resolve('core/adapter_registry'))
stub('core/adapter_registry', { ...arReal, makeClient: () => fakeClient(), isReadOnly: () => fakeReadOnly })
const { promote } = require(resolve('core/git-drift'))

test('promote is refused when source === target', async () => {
    const r = await promote('TG1', { source: 'TG1', token: 'x', gitUser: 't' })
    assert.equal(r.refused, true)
    assert.match(r.error, /same server/i)
})

test('promote is refused when the source (the server that pulls) is read-only', async () => {
    fakeReadOnly = true
    try {
        const r = await promote('TG1', { source: 'PROD01', token: 'x', gitUser: 't' })
        assert.equal(r.refused, true)
        assert.match(r.error, /read-only/i)
    } finally { fakeReadOnly = false }
})