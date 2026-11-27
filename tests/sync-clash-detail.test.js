'use strict'

// Sync clash detail (Fix 4).
//
// The sync preview must show, for each clash, PROD's value, the developer's value
// on DEV and the developer's change set (name, owner). When PROD's value replaces
// the developer's change, that developer gets a note on their change set.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, exportsObj) => {
    const r = resolve(rel)
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exportsObj }
}

const clients = {}
const load = () => {
    for (const m of ['core/refresh-dev', 'core/refresh-covers', 'core/refresh-hierarchy']) {
        delete require.cache[resolve(m)]
    }
    stub('core/adapter-registry', { makeClient: (server) => ({ server }) })
    stub('core/tm1-client', { TM1Client: class { constructor(server) { return clients[server] } } })
    stub('core/deploy-base', {
        resolveBase: async () => ({ ok: true, repoUrl: 'https://example.invalid/repo.git', commit: 'BASE' }),
        openBase: () => ({ commit: 'BASE', list: () => [], show: () => null }),
        baseHierarchy: () => ({ elements: new Map(), edges: new Map() }),
        baseChore: () => null,
    })
    stub('core/refresh-covers', {
        planCovers: async () => ({
            subsets: [{
                type: 'subset', name: 'S', dimension: 'D', origin: 'conflict',
                prodValue: 'static:A', devValue: 'static:B',
            }],
            views: [], skipped: [],
        }),
    })
    stub('core/refresh-hierarchy', { planHierarchies: async () => [] })
    return require('../core/refresh-dev')
}

function side() {
    return {
        getModelDimensions: async () => [{ Name: 'D' }],
        getElements: async () => [{ Name: 'X' }],
        getEdges: async () => [],
        getElementAttributes: async () => [],
        getChores: async () => [],
        getChore: async () => null,
    }
}

test('a clash shows both values and the developer\'s change set (name, owner)', async () => {
    const cl = require('../core/change-log')
    const s = cl.startSession('Jo UI work', 'DEV', 'jo')
    cl.writeLog({ server: 'DEV', action: 'SUBSET_SAVED', objectType: 'subset', objectName: 'S', detail: 'D', user: 'jo' })

    clients.DEV = side()
    clients.PROD = side()
    const { planRefresh } = load()
    const plan = await planRefresh('DEV', 'PROD', {})

    const clash = (plan.clashes ?? []).find(c => c.type === 'subset' && c.name === 'S')
    assert.ok(clash, JSON.stringify(plan.clashes))
    assert.equal(clash.prodValue, 'static:A')
    assert.equal(clash.devValue, 'static:B')
    assert.deepEqual(clash.changeSet, { id: s.id, name: 'Jo UI work', user: 'jo' })
    assert.equal(clash.key, 'subset:S:D')
    // The plan row carries it too, so the screen can annotate the row itself.
    assert.equal(plan.subsets[0].clash?.key, 'subset:S:D')
})

test('a replaced developer change gets a note naming the item, both values and the sync set', () => {
    const cl = require('../core/change-log')
    const s = cl.startSession('Sam rules', 'DEV', 'sam')
    const { notifyClashOwners } = require('../core/sync-dev')
    const clashes = [{
        key: 'subset:S:D', type: 'subset', name: 'S', parent: 'D',
        item: 'subset S (D)', kind: 'content',
        prodValue: 'static:A', devValue: 'static:B',
        changeSet: { id: s.id, name: s.name, user: 'sam' },
    }]
    const noted = notifyClashOwners(clashes, { target: 'PROD', syncName: 'Sync DEV from PROD 2026-11-26' })
    assert.equal(noted.length, 1)
    const desc = cl.getSession(s.id).description
    assert.match(desc, /subset S \(D\)/)
    assert.match(desc, /PROD's value static:A/)
    assert.match(desc, /your old value static:B/)
    assert.match(desc, /Sync DEV from PROD 2026-11-26/)

    // Running the same sync again must not duplicate the note.
    notifyClashOwners(clashes, { target: 'PROD', syncName: 'Sync DEV from PROD 2026-11-26' })
    assert.equal(cl.getSession(s.id).description.split('Sync from PROD').length - 1, 1)
})
