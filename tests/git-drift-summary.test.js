'use strict'

// The pre-deploy check names the object; these summaries say what actually
// differs, so the screen can show the elements instead of only the dimension.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { describeDimension, describeSubset } = require('../core/git-drift')

const hier = (elements, edges = []) => JSON.stringify({
    Elements: elements.map(n => ({ Name: n, Type: 'Numeric' })),
    Edges: edges.map(([ParentName, ComponentName]) => ({ ParentName, ComponentName, Weight: 1 })),
})

test('names the elements the target added', () => {
    const before = hier(['E10001', 'E10002'])
    const after = hier(['E10001', 'E10002', 'ZZ_TEST_EMP_A', 'ZZ_TEST_EMP_B'])
    assert.equal(describeDimension(before, after), '+2 elements: ZZ_TEST_EMP_A, ZZ_TEST_EMP_B')
})

test('names elements removed and edges added or removed', () => {
    const before = hier(['A', 'B', 'C'], [['All Employees', 'A']])
    const after = hier(['A', 'B'], [['All Employees', 'B']])
    const text = describeDimension(before, after)
    assert.match(text, /-1 element: C/)
    assert.match(text, /\+1 edge: All Employees → B/)
    assert.match(text, /-1 edge: All Employees → A/)
})

test('a hierarchy new on the target is its size, not 500 names', () => {
    const after = hier(Array.from({ length: 50 }, (_, i) => `E${i}`))
    assert.equal(describeDimension(null, after), 'new on PROD (50 elements)')
    assert.equal(describeDimension(after, null), 'removed from PROD (50 elements)')
})

test('a static subset lists its members, including the @id form', () => {
    const text = JSON.stringify({
        Elements: [
            { '@id': "Dimensions('WFP Employee')/Hierarchies('WFP Employee')/Elements('ZZ_TEST_EMP_A')" },
            { '@id': "Dimensions('WFP Employee')/Hierarchies('WFP Employee')/Elements('ZZ_TEST_EMP_B')" },
        ],
    })
    assert.equal(describeSubset(text), '2 members: ZZ_TEST_EMP_A, ZZ_TEST_EMP_B')
})

test('an MDX subset shows its expression', () => {
    assert.match(describeSubset(JSON.stringify({ Expression: '{TM1FILTERBYLEVEL({TM1SUBSETALL([D])},0)}' })), /MDX: \{TM1FILTER/)
})

test('the PROD-added snapshot excludes what PROD removed or kept', () => {
    const { dimensionSnapshot } = require('../core/git-drift')
    const before = hier(['A', 'B'], [['All Employees', 'A']])
    const after = hier(['A', 'B', 'Z'], [['All Employees', 'B']])
    assert.deepEqual(dimensionSnapshot(before, after), {
        elements: ['Z'],
        edges: ['All Employees::B'],
    })
})
