'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { syncSelection } = require('../core/sync-dev')

const plan = {
    dimensions: [
        {
            dimension: 'Employee', offered: true,
            removeElements: ['Old'], removeEdges: [{ parent: 'Group', child: 'Gone' }],
            moves: [{ child: 'Sarah', toParent: 'Group' }],
            attributes: { add: [{ name: 'Code', type: 'S' }], typeChanges: [{ name: 'Grade', from: 'S', to: 'N' }] },
        },
        { dimension: 'Other', offered: true, removeElements: [], removeEdges: [], moves: [], attributes: { add: [], typeChanges: [] } },
        { dimension: 'OnlyDev', offered: false },
    ],
    chores: [{ name: 'Nightly', fields: ['StartTime'], onDev: true }],
    subsets: [{ type: 'subset', name: 'Default', dimension: 'Employee', removing: false }],
    views: [{ type: 'view', name: 'V', cube: 'Employee', removing: true }],
    hierarchies: [{ name: 'By Manager', dimension: 'Employee', removing: false }],
}

test('the sync takes PROD by default: deletes, moves and type changes are decided', () => {
    const s = syncSelection(plan)
    assert.deepEqual(s.accept.map(a => a.dimension), ['Employee', 'Other'])
    const emp = s.accept[0]
    assert.equal(emp.deletes.Old, 'delete')
    assert.equal(emp.deletes['Group::Gone'], 'delete')
    assert.equal(emp.moves.Sarah, 'take')
    assert.equal(emp.attributeTypes.Grade, 'take')
    assert.deepEqual(emp.attributeCreates, ['Code'])
    assert.equal(emp.allowTypeChanges, true)
    assert.deepEqual(s.chores, [{ name: 'Nightly', takeSchedule: true }])
    assert.deepEqual(s.covers.find(c => c.type === 'view' && c.name === 'V').choice, 'delete')
    assert.deepEqual(s.covers.find(c => c.type === 'subset' && c.name === 'Default').choice, 'take')
    assert.deepEqual(s.hierarchies, [{ dimension: 'Employee', name: 'By Manager', choice: 'take' }])
})

test('an unticked item is skipped this time — it shows again next sync', () => {
    const s = syncSelection(plan, { untick: ['dimension:Employee', 'view:V:Employee', 'chore:Nightly'] })
    assert.deepEqual(s.accept.map(a => a.dimension), ['Other'])
    assert.equal(s.chores.length, 0)
    assert.ok(!s.covers.some(c => c.type === 'view'))
    assert.ok(s.covers.some(c => c.type === 'subset'))
})
