'use strict'

// TM1 refuses Type=Consolidated on an element with no components. The refresh
// applies edges first and then types — and an element whose new edge already made
// it a consolidation is not patched at all. This is the rule, extracted.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { typeChangesToApply } = require('../core/refresh-dev')

const tc = (name, from, to) => ({ name, from, to })

test('an element a taken move made a rollup is not patched', () => {
    const diff = { moves: [{ child: 'F', toParent: 'E', fromParent: 'G' }], addEdges: [], typeChanges: [tc('E', 'Numeric', 'Consolidated')] }
    const { patch } = typeChangesToApply(diff, { moves: { F: 'take' }, allowTypeChanges: true })
    assert.equal(patch.length, 0, 'the edge already made E a consolidation')
})

test('the same element IS patched when the move is kept (no edge lands)', () => {
    const diff = { moves: [{ child: 'F', toParent: 'E', fromParent: 'G' }], addEdges: [], typeChanges: [tc('E', 'Numeric', 'Consolidated')] }
    const { patch } = typeChangesToApply(diff, { moves: { F: 'keep' }, allowTypeChanges: true })
    assert.deepEqual(patch.map(p => p.name), ['E'])
})

test('a plain added edge counts as gaining components too', () => {
    const diff = { moves: [], addEdges: [{ parent: 'E', child: 'F' }], typeChanges: [tc('E', 'Numeric', 'Consolidated')] }
    assert.equal(typeChangesToApply(diff, { allowTypeChanges: true }).patch.length, 0)
})

test('a consolidation going back to a leaf still needs its patch', () => {
    const diff = { moves: [], addEdges: [], typeChanges: [tc('E', 'Consolidated', 'Numeric')] }
    assert.deepEqual(typeChangesToApply(diff, { allowTypeChanges: true }).patch.map(p => p.name), ['E'])
})

test('without permission every remaining type change is skipped, not applied', () => {
    const diff = { moves: [], addEdges: [], typeChanges: [tc('E', 'Consolidated', 'Numeric')] }
    const { patch, skip } = typeChangesToApply(diff, {})
    assert.equal(patch.length, 0)
    assert.deepEqual(skip.map(s => s.name), ['E'])
})

test('a settled element is not reported as skipped either — it needs nothing', () => {
    const diff = { moves: [{ child: 'F', toParent: 'E' }], addEdges: [], typeChanges: [tc('E', 'Numeric', 'Consolidated')] }
    const { patch, skip } = typeChangesToApply(diff, { moves: { F: 'take' }, allowTypeChanges: true })
    assert.equal(patch.length + skip.length, 0)
})
