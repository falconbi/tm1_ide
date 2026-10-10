'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, o) => { const r = resolve(rel); require.cache[r] = { id: r, filename: r, loaded: true, exports: o } }

let fakeReadOnly = false
function fakeClient() {
    return {
        async post(route) {
            if (route === 'GitStatus') return { URL: 'https://x', Deployment: 'DEV' }
            if (route === 'GitInit')   return { ID: 'PLAN1' }
            return {}
        },
        async get() { return {} }, async patch() { return {} }, async delete() { return {} },
    }
}

const arReal = require(resolve('core/adapter_registry'))
stub('core/adapter_registry', { ...arReal, makeClient: () => fakeClient(), isReadOnly: () => fakeReadOnly })

const { init } = require(resolve('core/git-setup'))
const OPTS = { repo: 'https://github.com/x/y.git', deployment: 'DEV', gitUser: 't', token: 'x' }

test('init (force:false) is refused on a read-only server', async () => {
    fakeReadOnly = true
    try {
        const r = await init('PROD01', { ...OPTS, force: false })
        assert.equal(r.refused, true)
        assert.match(r.error, /read-only/i)
    } finally { fakeReadOnly = false }
})

test('init (force:true) is still refused on a read-only server', async () => {
    fakeReadOnly = true
    try {
        const r = await init('PROD01', { ...OPTS, force: true })
        assert.equal(r.refused, true)
        assert.match(r.error, /read-only/i)
    } finally { fakeReadOnly = false }
})