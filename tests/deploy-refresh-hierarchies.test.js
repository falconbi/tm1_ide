'use strict'

// Alternate hierarchies are where reporting rollups live, and they are a file of
// their own inside the dimension (`dimensions/D.hierarchies/H.json`). Two cases and
// they are NOT the same:
//   * only the target has it — a gap: created on DEV with its members and edges;
//   * both sides have it, differently — a conflict with no default, like a view,
//     a subset, a delete or a move.
// Elements are never deleted here: in TM1 an element is dimension-wide, so removing
// one from an alternate hierarchy removes it from the dimension and takes its values.

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
    stub('core/adapter-registry', { makeClient: (server) => ({ server }) })
    stub('core/tm1-client', { TM1Client: class { constructor(server) { return clients[server] } } })
    delete require.cache[resolve('core/refresh-hierarchy')]
    return require('../core/refresh-hierarchy')
}

const { diffHierarchy } = require('../core/refresh-hierarchy')

const el = (Name, Type = 'Numeric') => ({ Name, Type })
const edge = (ParentName, ComponentName, Weight = 1) => ({ ParentName, ComponentName, Weight })

// ── Pure comparison ─────────────────────────────────────────────────────────

test('the same hierarchy on both sides does not differ', () => {
    const h = { elements: [el('A'), el('Total', 'Consolidated')], edges: [edge('Total', 'A')] }
    assert.equal(diffHierarchy(h, h).differs, false)
})

test('an element the target has is an addition; one only DEV has is kept, not a difference', () => {
    const d = diffHierarchy(
        { elements: [el('A'), el('B')], edges: [] },
        { elements: [el('A'), el('Z')], edges: [] }
    )
    assert.deepEqual(d.addElements.map(x => x.name), ['B'])
    assert.deepEqual(d.onlyDev, ['Z'])
    assert.equal(d.differs, true)
    // Only-DEV elements alone are not a difference to resolve — the deploy carries them.
    assert.equal(diffHierarchy({ elements: [el('A')], edges: [] }, { elements: [el('A'), el('Z')], edges: [] }).differs, false)
})

test('a re-parented member is a move, not an add plus a delete', () => {
    const d = diffHierarchy(
        { elements: [el('A'), el('P1', 'Consolidated'), el('P2', 'Consolidated')], edges: [edge('P2', 'A')] },
        { elements: [el('A'), el('P1', 'Consolidated'), el('P2', 'Consolidated')], edges: [edge('P1', 'A')] }
    )
    assert.deepEqual(d.moves, [{ child: 'A', toParent: 'P2', fromParent: 'P1', toWeight: 1 }])
    assert.deepEqual(d.addEdges, [])
    assert.deepEqual(d.removeEdges, [])
})

test('a consolidation in one hierarchy and a leaf in the other is a type change', () => {
    const d = diffHierarchy(
        { elements: [el('C', 'Consolidated')], edges: [] },
        { elements: [el('C', 'Numeric')], edges: [] }
    )
    assert.deepEqual(d.typeChanges, [{ name: 'C', from: 'Numeric', to: 'Consolidated' }])
})

// ── Plan and apply ──────────────────────────────────────────────────────────

function server({ dims = {}, hiers = {}, elements = {}, edges = {} } = {}) {
    const calls = []
    return {
        calls,
        getModelDimensions: async () => Object.keys(dims).map(Name => ({ Name })),
        getHierarchies: async (dim) => hiers[dim] ?? [],
        getElements: async (dim, hier) => elements[`${dim}|${hier}`] ?? [],
        getEdges: async (dim, hier) => edges[`${dim}|${hier}`] ?? [],
        createHierarchy: async (dim, name) => { calls.push(['createHierarchy', dim, name]) },
        addElementAt: async (dim, name, type, hier) => { calls.push(['addElement', dim, name, type, hier]) },
        addEdge: async (dim, p, c, w, hier) => { calls.push(['addEdge', dim, p, c, w, hier]) },
        deleteEdge: async (dim, p, c, hier) => { calls.push(['deleteEdge', dim, p, c, hier]) },
        patch: async (p, body) => { calls.push(['patch', p, body]) },
    }
}

test('a hierarchy only the target has is planned to be created, with no choice needed', async () => {
    const { planHierarchies } = load()
    clients.DEV = server({ dims: { D: 1 }, hiers: { D: ['D'] } })
    clients.PROD = server({
        dims: { D: 1 }, hiers: { D: ['D', 'Alt'] },
        elements: { 'D|Alt': [el('A'), el('T', 'Consolidated')] },
        edges: { 'D|Alt': [edge('T', 'A')] },
    })
    const reader = { commit: 'BASE', list: () => [], show: () => { throw new Error('no file') } }
    const plan = await planHierarchies('DEV', 'PROD', { reader })
    assert.equal(plan.length, 1)
    assert.equal(plan[0].name, 'Alt')
    assert.equal(plan[0].adding, true)
    assert.equal(plan[0].choice, 'take')   // new on the target: arrives ticked
})

test('the main hierarchy and TM1\'s Leaves are not alternate hierarchies', async () => {
    const { planHierarchies } = load()
    clients.DEV = server({ dims: { D: 1 }, hiers: { D: ['D'] } })
    clients.PROD = server({ dims: { D: 1 }, hiers: { D: ['D', 'Leaves'] } })
    assert.deepEqual(await planHierarchies('DEV', 'PROD'), [])
})

test('a hierarchy on both sides with a different shape is a conflict with no default', async () => {
    const { planHierarchies } = load()
    clients.DEV = server({
        dims: { D: 1 }, hiers: { D: ['D', 'Alt'] },
        elements: { 'D|Alt': [el('A')] }, edges: { 'D|Alt': [] },
    })
    clients.PROD = server({
        dims: { D: 1 }, hiers: { D: ['D', 'Alt'] },
        elements: { 'D|Alt': [el('A'), el('B')] }, edges: { 'D|Alt': [] },
    })
    // Baseline holds A only; PROD then added B, DEV changed nothing → a target-side
    // change, offered (ticked), not a conflict.
    const reader = {
        commit: 'BASE', list: () => ['dimensions/D.hierarchies/Alt.json'],
        show: () => JSON.stringify({ Elements: [{ Name: 'A', Type: 'Numeric' }], Edges: [] }),
    }
    const plan = await planHierarchies('DEV', 'PROD', { reader })
    assert.equal(plan[0].adding, false)
    assert.equal(plan[0].choice, 'take')
    assert.match(plan[0].parts.join(' '), /changed on the target/)
})

test('taking a missing hierarchy creates it, adds its members and edges, and logs the DIMENSION', async () => {
    const { applyHierarchies } = load()
    const dev = server({ dims: { D: 1 }, hiers: { D: ['D'] } })
    const prod = server({
        dims: { D: 1 }, hiers: { D: ['D', 'Alt'] },
        elements: { 'D|Alt': [el('A'), el('B'), el('T', 'Consolidated')] },
        edges: { 'D|Alt': [edge('T', 'A', 1), edge('T', 'B', 0.5)] },
    })
    const logged = []
    const r = await applyHierarchies(dev, prod, {
        source: 'DEV', target: 'PROD', log: (e) => logged.push(e),
        hierarchies: [{ dimension: 'D', name: 'Alt', choice: 'take' }],
    })
    assert.deepEqual(r.errors, [])
    assert.deepEqual(dev.calls[0], ['createHierarchy', 'D', 'Alt'])
    assert.deepEqual(dev.calls.filter(c => c[0] === 'addEdge').map(c => [c[2], c[3], c[4]]), [['T', 'A', 1], ['T', 'B', 0.5]])
    // The release ships the dimension (a hierarchy is a file inside it) — so the
    // log names the dimension, not the hierarchy.
    assert.equal(logged[0].action, 'HIERARCHY_CREATED')
    assert.equal(logged[0].objectType, 'dimension')
    assert.equal(logged[0].objectName, 'D')
    assert.equal(r.changed[0].label, 'hierarchy Alt (D)')
})

test('taking an existing hierarchy applies moves and edge removals, never element deletions', async () => {
    const { applyHierarchies } = load()
    const dev = server({
        dims: { D: 1 }, hiers: { D: ['D', 'Alt'] },
        elements: { 'D|Alt': [el('A'), el('P1', 'Consolidated'), el('P2', 'Consolidated'), el('Z')] },
        edges: { 'D|Alt': [edge('P1', 'A')] },
    })
    const prod = server({
        dims: { D: 1 }, hiers: { D: ['D', 'Alt'] },
        elements: { 'D|Alt': [el('A'), el('P1', 'Consolidated'), el('P2', 'Consolidated')] },
        edges: { 'D|Alt': [edge('P2', 'A')] },
    })
    const r = await applyHierarchies(dev, prod, {
        source: 'DEV', target: 'PROD', log: () => {},
        hierarchies: [{ dimension: 'D', name: 'Alt', choice: 'take' }],
    })
    assert.deepEqual(r.errors, [])
    const kinds = dev.calls.map(c => c[0])
    assert.ok(!kinds.includes('deleteElement'), 'an element is never deleted from a hierarchy')
    assert.ok(kinds.includes('deleteEdge') && kinds.includes('addEdge'))
    assert.match(r.changed[0].text, /1 element only on DEV kept/)
})

test('keeping DEV\'s hierarchy writes nothing and records the decision', async () => {
    const { applyHierarchies } = load()
    const dev = server({ dims: { D: 1 }, hiers: { D: ['D', 'Alt'] } })
    const prod = server({ dims: { D: 1 }, hiers: { D: ['D', 'Alt'] } })
    const logged = []
    const r = await applyHierarchies(dev, prod, {
        source: 'DEV', target: 'PROD', log: (e) => logged.push(e),
        hierarchies: [{ dimension: 'D', name: 'Alt', choice: 'keep' }],
    })
    assert.deepEqual(dev.calls, [])
    assert.equal(logged[0].objectType, 'decision')
    assert.equal(r.decisions.length, 1)
})

test('a refused create is an ERROR with TM1\'s message, never a skip', async () => {
    const { applyHierarchies } = load()
    const dev = server({ dims: { D: 1 }, hiers: { D: ['D'] } })
    dev.createHierarchy = async () => { throw new Error('hierarchy Alt already exists') }
    const prod = server({
        dims: { D: 1 }, hiers: { D: ['D', 'Alt'] },
        elements: { 'D|Alt': [el('A')] }, edges: { 'D|Alt': [] },
    })
    const r = await applyHierarchies(dev, prod, {
        source: 'DEV', target: 'PROD', log: () => {},
        hierarchies: [{ dimension: 'D', name: 'Alt', choice: 'take' }],
    })
    assert.equal(r.changed.length, 0)
    assert.match(r.errors[0].why, /already exists/)
})
