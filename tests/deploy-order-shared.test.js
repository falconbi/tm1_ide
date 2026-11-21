'use strict'

// Deploy order on shared objects.
//
// Two change sets touching the same object must deploy in the order the changes
// were made, judged by the change log's own timestamps. Without this, the classic
// case is silent: JDLove created in 1001, deleted in 1002; deploy 1002 first (its
// delete finds nothing to delete and is treated as already-gone), then deploy 1001
// and the subset comes back with no warning.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sharedObjectOrdering } = require('../core/git-release')

const T = (h, m = 0) => `2026-11-22T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`

const row = ({ label = 'subset JDLove', mineAt = T(10), other = {} } = {}) => ({
    label,
    mineAt,
    other: { id: 'B', name: '1002', at: T(11), deployed: false, covered: false, retired: false, ...other },
})

test('an older change that has not been deployed is refused, naming it', () => {
    const r = sharedObjectOrdering([row({ mineAt: T(11), other: { name: '1001', at: T(10) } })], 'TM1_Test_PROD')
    assert.ok(r)
    assert.match(r.message, /subset JDLove was also changed in 1001 \(10:00\)/)
    assert.match(r.message, /hasn't been deployed to TM1_Test_PROD/)
    assert.match(r.message, /Deploy 1001 first, or retire it/)
    assert.equal(r.older.length, 1)
    assert.equal(r.newer.length, 0)
})

test('a newer change already deployed is refused, naming it', () => {
    const r = sharedObjectOrdering([row({ mineAt: T(10), other: { name: '1002', at: T(11), deployed: true } })], 'TM1_Test_PROD')
    assert.ok(r)
    assert.match(r.message, /1002 already deployed a newer change to subset JDLove \(11:00\)/)
    assert.match(r.message, /This release would undo it/)
    assert.equal(r.newer.length, 1)
})

test('a retired change set does not block, older or newer', () => {
    assert.equal(sharedObjectOrdering([row({ mineAt: T(11), other: { retired: true, at: T(10) } })], 'T'), null)
    assert.equal(sharedObjectOrdering([row({ mineAt: T(10), other: { retired: true, deployed: true, at: T(11) } })], 'T'), null)
})

test('a newer change not yet deployed does not block — order is still preserved', () => {
    assert.equal(sharedObjectOrdering([row({ mineAt: T(10), other: { at: T(11), deployed: false } })], 'T'), null)
})

test('an older change already deployed does not block', () => {
    assert.equal(sharedObjectOrdering([row({ mineAt: T(11), other: { at: T(10), deployed: true } })], 'T'), null)
})

test('a set carried by a catch-up counts as deployed', () => {
    assert.ok(sharedObjectOrdering([row({ mineAt: T(10), other: { at: T(11), covered: true } })], 'T'))
})

test('change sets sharing no objects produce no rows — nothing to refuse', () => {
    assert.equal(sharedObjectOrdering([], 'T'), null)
})

test('every object and change set is named, not just the first', () => {
    const r = sharedObjectOrdering([
        row({ label: 'subset JDLove', mineAt: T(11), other: { name: '1001', at: T(10) } }),
        row({ label: 'dimension WFP Currency', mineAt: T(12), other: { id: 'C', name: '1003', at: T(9) } }),
    ], 'TM1_Test_PROD')
    assert.ok(r)
    assert.match(r.message, /subset JDLove was also changed in 1001/)
    assert.match(r.message, /dimension WFP Currency was also changed in 1003/)
    assert.equal(r.older.length, 2)
})

test('the same change set touching an object twice is judged by its latest time', () => {
    // The caller collapses per-session rows to the latest timestamp; this asserts
    // the rule that matters: a later edit in the same set makes it "after" the other.
    const latest = T(13)
    const r = sharedObjectOrdering([row({ mineAt: latest, other: { name: '1001', at: T(12) } })], 'T')
    assert.ok(r)
    const r2 = sharedObjectOrdering([row({ mineAt: latest, other: { name: '1001', at: T(14) } })], 'T')
    assert.equal(r2, null)
})
