'use strict'

// The "Contractor rollup" change set, exactly as the IDE recorded it on DEV:
//
//   ELEMENT_ADDED    WFP Employee   Contractors before All Employees
//   ELEMENT_LINKED   WFP Employee   E10001 under Contractors
//   ELEMENT_LINKED   WFP Employee   E10002 under Contractors
//   EDGE_REMOVED     WFP Employee   All Employees · removed E10001
//   EDGE_REMOVED     WFP Employee   All Employees · removed E10002
//
// Five log rows, ONE change: the dimension is the object the deploy ships. This
// test pins that shape so a row that no longer parses (or a sixth entry that
// drifts in) cannot silently turn the deploy into something else — and so the
// recorded ops stay replayable element-by-element (not a whole-dimension swap).

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { recordedChanges, summariseDimension, touched } = require('../core/recorded-changes')

const DIM = 'WFP Employee'
const state = (o) => JSON.stringify(o)

const entries = () => [
    {
        action: 'ELEMENT_ADDED', object_type: 'dimension', object_name: DIM,
        detail: 'Contractors before All Employees',
        after_state: state({ element: 'Contractors', type: 'Consolidated', parent: null, weight: 1, hierarchy: DIM }),
    },
    {
        action: 'ELEMENT_LINKED', object_type: 'dimension', object_name: DIM,
        detail: 'E10001 under Contractors',
        after_state: state({ element: 'E10001', parent: 'Contractors', weight: 1, hierarchy: DIM }),
    },
    {
        action: 'ELEMENT_LINKED', object_type: 'dimension', object_name: DIM,
        detail: 'E10002 under Contractors',
        after_state: state({ element: 'E10002', parent: 'Contractors', weight: 1, hierarchy: DIM }),
    },
    {
        action: 'EDGE_REMOVED', object_type: 'dimension', object_name: DIM,
        detail: 'All Employees · removed E10001',
    },
    {
        action: 'EDGE_REMOVED', object_type: 'dimension', object_name: DIM,
        detail: 'All Employees · removed E10002',
    },
]

test('moving two elements into a new consolidation is one dimension change', () => {
    const c = recordedChanges(entries())

    assert.equal(c.dimensions.size, 1, 'exactly one dimension is touched')
    assert.ok(c.dimensions.has(DIM))
    assert.equal(c.objects.subset.size + c.objects.view.size + c.objects.cube.size + c.objects.process.size + c.objects.chore.size, 0, 'no other object type is carried')
    assert.deepEqual(c.deletes, [], 'nothing is deleted — the elements stay in the dimension')

    const d = c.dimensions.get(DIM)
    assert.equal(d.whole, false, 'replayable element-by-element, not a whole-dimension replacement')
    assert.deepEqual(d.elements.map(o => o.action), ['add', 'link', 'link', 'unlink', 'unlink'])
    assert.deepEqual(
        d.elements.map(o => [o.action, o.name, o.parent, o.weight]),
        [
            ['add', 'Contractors', null, 1],
            ['link', 'E10001', 'Contractors', 1],
            ['link', 'E10002', 'Contractors', 1],
            ['unlink', 'E10001', 'All Employees', null],
            ['unlink', 'E10002', 'All Employees', null],
        ]
    )
})

test('the change is "1 added, 2 placed, 2 unplaced" against one object', () => {
    const c = recordedChanges(entries())
    assert.equal(summariseDimension(c.dimensions.get(DIM)), '1 added, 2 placed, 2 unplaced')
    assert.equal(touched(c, 'dimension', DIM), true)
    assert.equal(touched(c, 'dimension', 'WFP Position'), false, 'no other dimension is dragged in')
})
