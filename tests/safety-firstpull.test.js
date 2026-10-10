'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, o) => { const r = resolve(rel); require.cache[r] = { id: r, filename: r, loaded: true, exports: o } }

// ── Controllable fake TM1 client + read-only flag ────────────────────────────
let fakeReadOnly = false
let gitStatus = {}
let recordedDeployed = null
function fakeClient() {
    return {
        async post(route) {
            if (route === 'GitStatus') return gitStatus
            if (route === 'GitPull')   return { ID: 'PLAN1', Commit: { ID: 'C1' }, Operations: ['create', 'update'] }
            return {}
        },
        async get() { return {} }, async patch() { return {} }, async delete() { return {} },
    }
}

const arReal = require(resolve('core/adapter_registry'))
stub('core/adapter_registry', { ...arReal, makeClient: () => fakeClient(), isReadOnly: () => fakeReadOnly })
stub('core/git-state', { lastDeployed: () => (recordedDeployed ? { lastDeployedCommit: recordedDeployed } : null), load: () => ({}), FILE: '' })

const { firstPull } = require(resolve('core/git-setup'))
const OK = (s) => `I understand this overwrites ${s}`

test('first-pull is refused on a read-only server', async () => {
    fakeReadOnly = true
    try {
        const r = await firstPull('PROD01', { confirm: OK('PROD01'), gitUser: 't', token: 'x' })
        assert.equal(r.refused, true)
        assert.match(r.error, /read-only/i)
    } finally { fakeReadOnly = false }
})

test('first-pull is refused when the server has a deployed commit on GitStatus', async () => {
    gitStatus = { DeployedCommit: { ID: 'C9' } }
    const r = await firstPull('FRESH01', { confirm: OK('FRESH01'), gitUser: 't', token: 'x' })
    assert.equal(r.refused, true)
    assert.match(r.error, /already has a deployed commit/i)
})

test('first-pull is refused when a deploy was recorded for the server', async () => {
    gitStatus = {}
    recordedDeployed = 'C9'
    try {
        const r = await firstPull('FRESH01', { confirm: OK('FRESH01'), gitUser: 't', token: 'x' })
        assert.equal(r.refused, true)
        assert.match(r.error, /already has a deployed commit/i)
    } finally { recordedDeployed = null }
})

test('first-pull is allowed on a fresh, writable server', async () => {
    gitStatus = {}
    recordedDeployed = null
    const r = await firstPull('FRESH01', { confirm: OK('FRESH01'), gitUser: 't', token: 'x' })
    assert.equal(r.ok, true)
    assert.ok(!r.refused, 'not refused')
    assert.equal(r.overwritten, 2, 'two operations applied')
})