'use strict'

// The dimension comparison behind "Refresh DEV from PROD". Getting this wrong
// either leaves DEV short of PROD (the deploy then deletes PROD's elements) or
// applies something PROD does not have.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { diffDimension } = require('../core/refresh-dev')

const dim = ({ elements = [], edges = [] } = {}) => ({
    elements: elements.map(([Name, Type = 'N']) => ({ Name, Type })),
    edges: edges.map(([p, c, w = 1]) => ({ ParentName: p, ComponentName: c, Weight: w })),
})

test('an element PROD has and DEV lacks is added', () => {
    const d = diffDimension(dim({ elements: [['A'], ['B']] }), dim({ elements: [['A']] }))
    assert.equal(d.differs, true)
    assert.deepEqual(d.addElements, [{ name: 'B', type: 'Numeric' }])
})

test('an edge PROD has and DEV lacks is added', () => {
    const d = diffDimension(dim({ edges: [['Total', 'A']] }), dim({}))
    assert.deepEqual(d.addEdges, [{ parent: 'Total', child: 'A', weight: 1 }])
})

test('a re-parent is a move, not a delete plus an add', () => {
    const prod = dim({ edges: [['Archive', 'A']] })
    const dev = dim({ edges: [['Total', 'A']] })
    const d = diffDimension(prod, dev)
    assert.deepEqual(d.moves, [{ child: 'A', toParent: 'Archive', toWeight: 1, fromParent: 'Total', fromWeight: 1 }])
    // And the new edge also appears as an add — the caller applies moves first and
    // skips those children when adding.
    assert.ok(d.addEdges.some(e => e.parent === 'Archive' && e.child === 'A'))
})

test('a weight change is a move', () => {
    const d = diffDimension(dim({ edges: [['Total', 'A', 0]] }), dim({ edges: [['Total', 'A', 1]] }))
    assert.equal(d.moves.length, 1)
    assert.equal(d.moves[0].toWeight, 0)
})

test('an element only DEV has is reported as a delete, never applied silently', () => {
    const d = diffDimension(dim({ elements: [['A']] }), dim({ elements: [['A'], ['Gone']] }))
    assert.deepEqual(d.removeElements, ['Gone'])
})

test('identical dimensions produce no difference', () => {
    const a = dim({ elements: [['A'], ['B']], edges: [['Total', 'A']] })
    assert.equal(diffDimension(a, a).differs, false)
})

test('a type change is reported separately', () => {
    const d = diffDimension(dim({ elements: [['A', 'S']] }), dim({ elements: [['A', 'N']] }))
    assert.deepEqual(d.typeChanges, [{ name: 'A', from: 'Numeric', to: 'String' }])
})
