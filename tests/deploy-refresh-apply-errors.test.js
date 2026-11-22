'use strict'

// The refresh APPLY must never present a failure as "nothing to do" or as a skip.
// Two paths were doing exactly that:
//   * a failed dimension READ came back as an empty dimension, which is
//     indistinguishable from "PROD has nothing new" — a hidden failure;
//   * a refused element-type PATCH was pushed into `skipped` with TM1's message.
// Both are errors now.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, exportsObj) => {
    const r = resolve(rel)
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exportsObj }
}

const clients = {}
// A baseline that holds element B as Numeric, so PROD's String is a TARGET-side
// type change (the only kind the refresh may offer).
const fakeBase = {
    resolveBase: async () => ({ ok: true, repoUrl: 'https://repo', commit: 'BASE', source: 'release-branch' }),
    openBase: () => ({ commit: 'BASE', list: () => [], show: () => { throw new Error('no file') }, has: () => false }),
    baseHierarchy: () => ({ elements: new Map([['B', 'Numeric']]), edges: new Map() }),
    baseChore: () => null,
    baseSubset: () => null,
    baseView: () => null,
}
const load = () => {
    stub('core/adapter-registry', { makeClient: (server) => ({ server }) })
    stub('core/deploy-base', fakeBase)
    stub('core/tm1-client', { TM1Client: class { constructor(server) { return clients[server] } } })
    stub('core/change-log', {
        getSession: () => ({ id: 's1', server: 'DEV', closed_at: null }),
        writeLog: () => ({ hasSession: true }),
    })
    stub('core/deploy-settings', { get: async () => ({}) })
    delete require.cache[resolve('core/refresh-dev')]
    delete require.cache[resolve('core/refresh-covers')]
    return require('../core/refresh-dev')
}

function server({ elements = [], edges = [], throws = null } = {}) {
    const calls = []
    const base = {
        calls,
        getElements: async () => { if (throws) throw new Error(throws); return elements },
        getEdges: async () => edges,
        getElementAttributes: async () => [],
        getModelDimensions: async () => [],
        getModelCubes: async () => [],
        addElementAt: async () => {}, addEdge: async () => {}, deleteEdge: async () => {}, deleteElement: async () => {},
        patch: async (p, body) => { calls.push(['patch', p, body]) },
    }
    return base
}

test('a failed read is reported, not treated as "nothing to refresh"', async () => {
    const { applyRefresh } = load()
    clients.DEV = server({ elements: [{ Name: 'A', Type: 'Numeric' }] })
    clients.PROD = server({ throws: 'PROD is not responding' })
    await assert.rejects(
        applyRefresh('DEV', 'PROD', { session: 's1', accept: [{ dimension: 'D' }], chores: [], covers: [] }),
        /PROD is not responding/
    )
})

test('a refused element-type patch is an ERROR, not a skip', async () => {
    const { applyRefresh } = load()
    const dev = server({ elements: [{ Name: 'B', Type: 'Numeric' }] })
    dev.patch = async () => { throw new Error('element B has children') }
    clients.DEV = dev
    clients.PROD = server({ elements: [{ Name: 'B', Type: 'String' }] })
    const r = await applyRefresh('DEV', 'PROD', {
        session: 's1', accept: [{ dimension: 'D', allowTypeChanges: true }], chores: [], covers: [],
    })
    assert.equal(r.errors.length, 1)
    assert.match(r.errors[0].why, /element B has children/)
    assert.equal((r.skipped ?? []).length, 0)
})
