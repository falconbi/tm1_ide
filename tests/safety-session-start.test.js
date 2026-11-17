'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, o) => { const r = resolve(rel); require.cache[r] = { id: r, filename: r, loaded: true, exports: o } }

let fakeReadOnly = false
const arReal = require(resolve('core/adapter-registry'))
stub('core/adapter-registry', { ...arReal, isReadOnly: () => fakeReadOnly })
const { readOnlyRefusal } = require(resolve('core/readonly'))
const { createStartSessionRoute } = require(resolve('core/session_routes'))

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

test('the start route refuses through gateReadOnly before starting a session', () => {
    const res = () => {
        const r = { statusCode: 200, body: null }
        r.status = code => { r.statusCode = code; return r }
        r.json = body => { r.body = body; return r }
        return r
    }
    let started = null
    const route = createStartSessionRoute({
        gateReadOnly: (r) => { r.status(409).json({ error: 'read-only', readOnly: true }); return false },
        startSession: (...a) => { started = a },
    })
    const denied = res()
    route({ body: { name: 'Set A', server: 'PROD01' }, user: 'me' }, denied)
    assert.equal(denied.statusCode, 409)
    assert.equal(started, null)

    const allowed = res()
    const writable = createStartSessionRoute({
        gateReadOnly: () => true,
        startSession: (...a) => { started = a; return { id: 's1' } },
    })
    writable({ body: { name: ' Set A ', server: 'DEV01' }, user: 'me' }, allowed)
    assert.deepEqual(started, ['Set A', 'DEV01', 'me'])
    assert.deepEqual(allowed.body, { id: 's1' })
})