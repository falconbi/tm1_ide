'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, o) => { const r = resolve(rel); require.cache[r] = { id: r, filename: r, loaded: true, exports: o } }

let fakeReadOnly = false
const arReal = require(resolve('core/adapter_registry'))
stub('core/adapter_registry', { ...arReal, isReadOnly: () => fakeReadOnly })
const { readOnlyRefusal } = require(resolve('core/readonly'))

test('start-change-set refusal fires on a read-only server (readOnly: true)', () => {
    fakeReadOnly = true
    try {
        const refusal = readOnlyRefusal('PROD01')
        assert.ok(refusal, 'a refusal must be produced')
        assert.equal(refusal.readOnly, true)
        assert.equal(refusal.server, 'PROD01')
        assert.match(refusal.error, /read-only/i)
    } finally { fakeReadOnly = false }
})

test('no refusal on a writable server', () => {
    fakeReadOnly = false
    assert.equal(readOnlyRefusal('DEV01'), null)
})

test('POST /api/sessions/start is wired to the read-only gate', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
    const route = src.slice(src.indexOf("app.post('/api/sessions/start'"), src.indexOf("app.post('/api/sessions/close'"))
    assert.match(route, /gateReadOnly/, 'the sessions/start route must refuse via gateReadOnly')
})