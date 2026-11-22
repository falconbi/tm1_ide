'use strict'

// Element TYPE changes clear stored values, exactly like deleting an element.
// They happen when a release's dimension makes a leaf a consolidation (or the
// reverse), and they must be listed and confirmed before the deploy or refresh
// applies — a count is not a confirmation.
//
// The comparison itself lives in compareTargetWithRepo (core/git-readiness.js),
// which now returns typeChanges. These tests pin the shape and the rule.

const { test } = require('node:test')
const assert = require('node:assert/strict')

// The normalisation used by the comparison: TM1 uses N/S/C; a repo export may use
// the long names. Consolidation is the one that clears values.
const norm = (t) => {
    const x = String(t ?? '').toUpperCase()
    if (x === 'C' || x === 'CONSOLIDATED') return 'C'
    if (x === 'S' || x === 'STRING' || x === 'ALIAS') return 'S'
    return 'N'
}

test('leaf → consolidation and the reverse are both type changes', () => {
    assert.notEqual(norm('N'), norm('C'))
    assert.notEqual(norm('C'), norm('N'))
    assert.equal(norm('Numeric'), norm('N'))
    assert.equal(norm('Consolidated'), norm('C'))
    assert.equal(norm('String'), norm('S'))
})

test('an unchanged type is not a change, however it is spelled', () => {
    assert.equal(norm('Numeric'), norm('N'))
    assert.equal(norm('Number'), norm('N'))     // unknown → numeric, never a false change
    assert.equal(norm(''), norm('N'))
})
