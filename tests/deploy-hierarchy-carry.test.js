'use strict'

// A hierarchy file carried only because of a subset may differ from the base only
// in `Subsets@Code.links`. Anything else is somebody else's dimension work and must
// not ship unreviewed with a subset — the order check catches *older* sets, this
// catches everything else (a newer set, or an edit made in PAW or by a TI run).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { hierarchyDiffBeyondSubsets } = require('../core/git-release')

const file = ({ elements = ['A', 'B'], links = ['D.subsets/S.json'], extra = {} } = {}) => ({
    Name: 'D',
    HierarchyType: { Name: 'User Defined' },
    Elements: elements.map(n => ({ Name: n, Type: 'Numeric' })),
    Edges: [],
    'Subsets@Code.links': links,
    ...extra,
})

test('a subset-only difference passes', () => {
    const base = file({ elements: ['A', 'B'] })
    const dev  = file({ elements: ['A', 'B'], links: ['D.subsets/S.json', 'D.subsets/New.json'] })
    const d = hierarchyDiffBeyondSubsets(base, dev)
    assert.equal(d.differs, false)
    assert.deepEqual(d.elementsAdded, [])
})

test('an element added on DEV is refused and named', () => {
    const base = file({ elements: ['A', 'B'] })
    const dev  = file({ elements: ['A', 'B', 'C'] })
    const d = hierarchyDiffBeyondSubsets(base, dev)
    assert.equal(d.differs, true)
    assert.deepEqual(d.elementsAdded, ['C'])
})

test('an element removed on DEV is refused and named', () => {
    const d = hierarchyDiffBeyondSubsets(file({ elements: ['A', 'B'] }), file({ elements: ['A'] }))
    assert.equal(d.differs, true)
    assert.deepEqual(d.elementsRemoved, ['B'])
})

test('an element change carries no notion of who made it — newer undeployed set or PAW/TI edit alike', () => {
    // Exactly the gap: a newer, undeployed change set adding an element rides along
    // with somebody else's subset. The comparison is content-only, which is what
    // makes it catch that case as well as edits the log never saw.
    const d = hierarchyDiffBeyondSubsets(file({ elements: ['A', 'B'] }), file({ elements: ['A', 'B', 'FromNewerSet'] }))
    assert.equal(d.differs, true)
    assert.deepEqual(d.elementsAdded, ['FromNewerSet'])
})

test('a changed non-element field is refused and named', () => {
    const base = file()
    const dev  = file({ extra: { DefaultMember: { Name: 'A' } } })
    const d = hierarchyDiffBeyondSubsets(base, dev)
    assert.equal(d.differs, true)
    assert.ok(d.otherFields.includes('DefaultMember'))
})

test('identical files pass', () => {
    assert.equal(hierarchyDiffBeyondSubsets(file(), file()).differs, false)
})
