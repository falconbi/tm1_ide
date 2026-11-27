'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

// Stub the change log BEFORE requiring process-capture, so a captured run writes
// into an in-memory list instead of the real DB.
const written = []
const clPath = require.resolve(path.join(__dirname, '..', 'core', 'change-log'))
require.cache[clPath] = {
    id: clPath, filename: clPath, loaded: true,
    exports: {
        getActiveSession: () => ({ id: 's1', name: 'Capture' }),
        writeLog: (e) => {
            written.push({ ...e, object_type: e.objectType ?? e.object_type, object_name: e.objectName ?? e.object_name,
                before_state: e.beforeState ? JSON.stringify(e.beforeState) : e.before_state ?? null,
                after_state: e.afterState ? JSON.stringify(e.afterState) : e.after_state ?? null })
            return { hasSession: true }
        },
    },
}
const { recordDimensionDiff, requiresChangeSet } = require(path.join(__dirname, '..', 'core', 'process-capture'))
const { recordedChanges } = require(path.join(__dirname, '..', 'core', 'recorded-changes'))

function snapshot({ elements = [], edges = [], attrs = [], values = [] } = {}) {
    return {
        elements: new Map(elements),
        edges: new Map(edges),
        attrDefs: new Map(attrs),
        attrValues: new Map(values),
    }
}

test('a TI run that adds 2 elements and changes 3 values records both before and after', () => {
    written.length = 0
    const before = snapshot({
        elements: [['A', 'Numeric'], ['B', 'Numeric']],
        edges: [['Group::A', 1]],
        attrs: [['Code', 'String'], ['Grade', 'String']],
        values: [
            ['A', { Code: 'a', Grade: '1' }],
            ['B', { Code: 'b', Grade: '2' }],
        ],
    })
    const after = snapshot({
        elements: [['A', 'Numeric'], ['B', 'Numeric'], ['C', 'Numeric'], ['D', 'Numeric']],
        edges: [['Group::A', 1], ['Group::B', 1], ['Group::C', 1], ['Group::D', 1]],
        attrs: [['Code', 'String'], ['Grade', 'String']],
        values: [
            ['A', { Code: 'a', Grade: '4' }],
            ['B', { Code: 'b', Grade: '5' }],
            ['C', { Code: 'c', Grade: '6' }],
            ['D', { Code: 'd', Grade: '7' }],
        ],
    })
    recordDimensionDiff('DEV', 'Employee', before, after, { user: 'james' })

    const added = written.filter(e => e.action === 'ELEMENT_ADDED')
    assert.equal(added.length, 2)
    assert.deepEqual(added.map(e => e.afterState.element).sort(), ['C', 'D'])
    assert.ok(added.every(e => e.afterState.parent === 'Group'))

    const values = written.filter(e => e.action === 'ATTRIBUTE_VALUE_SET')
    assert.equal(values.length, 6, 'two changed existing values, three on the new elements')
    const a = values.find(v => v.detail.element === 'A' && v.detail.attribute === 'Grade')
    assert.equal(a.detail.before, '1')
    assert.equal(a.detail.after, '4')

    // And the release can replay them element by element.
    const records = recordedChanges(written)
    const rec = records.dimensions.get('Employee')
    assert.equal(rec.elements.filter(e => e.action === 'add').length, 2)
    assert.ok(rec.values.some(v => v.element === 'A' && v.attribute === 'Grade' && v.before === '1' && v.after === '4'))
})

test('a run that removes a parent and changes a weight records the before/after edge', () => {
    written.length = 0
    const before = snapshot({
        elements: [['A', 'Numeric'], ['B', 'Numeric']],
        edges: [['Group::A', 2]],
    })
    const after = snapshot({
        elements: [['A', 'Numeric'], ['B', 'Numeric']],
        edges: [['Group::A', 3]],
    })
    recordDimensionDiff('DEV', 'Employee', before, after, { user: 'james' })
    const w = written.find(e => e.action === 'EDGE_WEIGHT_CHANGED')
    assert.deepEqual(w.beforeState, { element: 'A', parent: 'Group', weight: 2, hierarchy: 'Employee' })
    assert.deepEqual(w.afterState, { element: 'A', parent: 'Group', weight: 3, hierarchy: 'Employee' })

    written.length = 0
    recordDimensionDiff('DEV', 'Employee', snapshot({ elements: [['A', 'Numeric']], edges: [['Group::A', 1]] }), snapshot({ elements: [['A', 'Numeric']] }), { user: 'james' })
    const removed = written.find(e => e.action === 'EDGE_REMOVED')
    assert.equal(removed.beforeState.parent, 'Group')
    assert.equal(removed.beforeState.element, 'A')
})


test('a TI run records a move in an alternate hierarchy with its hierarchy name', () => {
    written.length = 0
    const hier = (edges) => ({
        elements: new Map([['A', 'Numeric'], ['B', 'Numeric']]),
        edges: new Map(edges),
    })
    const before = {
        hierarchies: new Map([
            ['Employee', hier([['Total::B', 1]])],
            ['By Region', hier([['Region::B', 1]])],
        ]),
        attrDefs: new Map(), attrValues: new Map(),
    }
    const after = {
        hierarchies: new Map([
            ['Employee', hier([['Total::B', 1]])],
            ['By Region', hier([['Region::A', 1]])],
        ]),
        attrDefs: new Map(), attrValues: new Map(),
    }
    recordDimensionDiff('DEV', 'Employee', before, after, { user: 'james' })

    const linked = written.find(e => e.action === 'ELEMENT_LINKED')
    assert.equal(linked.afterState.hierarchy, 'By Region', 'the record names the hierarchy')
    const moved = written.find(e => e.action === 'EDGE_REMOVED')
    assert.equal(moved.beforeState.hierarchy, 'By Region')

    const rec = recordedChanges(written).dimensions.get('Employee')
    assert.ok(rec.elements.some(e => e.action === 'link' && e.name === 'A' && e.hierarchy === 'By Region'))
    assert.ok(rec.elements.some(e => e.action === 'unlink' && e.name === 'B' && e.hierarchy === 'By Region'))
})

test('a TI run on DEV with no open change set is refused; TEST/PROD and unknown are not', () => {
    assert.equal(requiresChangeSet('DEV', false).required, true)
    assert.match(requiresChangeSet('DEV', false).reason, /open a change set/)

    assert.equal(requiresChangeSet('DEV', true).required, false)
    assert.equal(requiresChangeSet('TEST', false).required, false)
    assert.equal(requiresChangeSet('PROD', false).required, false)
    assert.equal(requiresChangeSet(null, false).required, false, 'an unlinked server\'s type is unknown')
})
