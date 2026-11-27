'use strict'

// Fix 2 — the MCP whole-dimension update records per element, like a TI capture,
// instead of one "dimension changed" row.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./_mcp-harness')

test('build_dimension on an existing dimension records each element, never a whole row', async () => {
    const els = []
    const eds = []
    const builder = {
        async createDimension() { throw new Error('already exists') },
        async getHierarchies() { return ['Region'] },
        async getElements() { return els },
        async getEdges() { return eds },
        async getElementAttributes() { return [] },
        async addElement(_dim, name, type) { els.push({ Name: name, Type: type === 'C' ? 'Consolidated' : type === 'S' ? 'String' : 'Numeric' }) },
        async addEdge(_dim, parent, child, weight) { eds.push({ ParentName: parent, ComponentName: child, Weight: weight }) },
    }
    const h = setup({ mode: 'build', builder })
    await h.call('build_dimension', {
        name: 'Region',
        elements: [{ name: 'North' }, { name: 'South' }, { name: 'Total', type: 'C' }],
        edges: [{ parent: 'Total', child: 'North' }, { parent: 'Total', child: 'South' }],
    })
    const added = h.changes.filter(c => c[0] === 'ELEMENT_ADDED')
    const linked = h.changes.filter(c => c[0] === 'ELEMENT_LINKED')
    assert.equal(added.length, 3, `changes: ${JSON.stringify(h.changes)}`)
    assert.equal(linked.length, 2, `changes: ${JSON.stringify(h.changes)}`)
    assert.ok(!h.changes.some(c => c[0] === 'DIMENSION_UPDATED'), 'no whole-dimension row')
    assert.ok(added.every(c => c[3].after.hierarchy === 'Region'))
})
