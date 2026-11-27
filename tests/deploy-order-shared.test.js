'use strict'

// Deploy order on shared objects.
//
// Two change sets touching the same object must deploy in the order the changes
// were made, judged by the change log's own timestamps. Without this, the classic
// case is silent: JDLove created in 1001, deleted in 1002; deploy 1002 first (its
// delete finds nothing to delete and is treated as already-gone), then deploy 1001
// and the subset comes back with no warning.
//
// A rule, process, view, subset or cube is a WHOLE object the release carries:
// another undeployed set that changed it stops the release either way round. There
// is no safe order for two versions of one whole object.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sharedObjectOrdering } = require('../core/git-release')

const T = (h, m = 0) => `2026-11-22T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`

const row = ({ type = 'dimension', label = 'dimension WFP Currency', mineAt = T(10), other = {} } = {}) => ({
    type,
    label,
    mineAt,
    other: { id: 'B', name: '1002', at: T(11), deployed: false, covered: false, retired: false, ...other },
})

// ── Dimensions and chores: the ordering rule ────────────────────────────────

test('an older dimension change that has not been deployed is refused, naming it', () => {
    const r = sharedObjectOrdering([row({ mineAt: T(11), other: { name: '1001', at: T(10) } })], 'TM1_Test_PROD')
    assert.ok(r)
    assert.match(r.message, /dimension WFP Currency was also changed in 1001 \(10:00\)/)
    assert.match(r.message, /hasn't been deployed to TM1_Test_PROD/)
    assert.match(r.message, /Deploy 1001 first, or retire it/)
    assert.equal(r.older.length, 1)
    assert.equal(r.newer.length, 0)
})

test('a newer dimension change already deployed is refused, naming it', () => {
    const r = sharedObjectOrdering([row({ mineAt: T(10), other: { name: '1002', at: T(11), deployed: true } })], 'TM1_Test_PROD')
    assert.ok(r)
    assert.match(r.message, /1002 already deployed a newer change to dimension WFP Currency \(11:00\)/)
    assert.match(r.message, /This release would undo it/)
    assert.equal(r.newer.length, 1)
})

test('a retired change set does not block, older or newer', () => {
    assert.equal(sharedObjectOrdering([row({ mineAt: T(11), other: { retired: true, at: T(10) } })], 'T'), null)
    assert.equal(sharedObjectOrdering([row({ mineAt: T(10), other: { retired: true, deployed: true, at: T(11) } })], 'T'), null)
})

test('a newer dimension change not yet deployed does not block — order is still preserved', () => {
    assert.equal(sharedObjectOrdering([row({ mineAt: T(10), other: { at: T(11), deployed: false } })], 'T'), null)
})

test('an older dimension change already deployed does not block', () => {
    assert.equal(sharedObjectOrdering([row({ mineAt: T(11), other: { at: T(10), deployed: true } })], 'T'), null)
})

test('a set covered by an older release counts as deployed', () => {
    assert.ok(sharedObjectOrdering([row({ mineAt: T(10), other: { at: T(11), covered: true } })], 'T'))
})

test('change sets sharing no objects produce no rows — nothing to refuse', () => {
    assert.equal(sharedObjectOrdering([], 'T'), null)
})

test('every object and change set is named, not just the first', () => {
    const r = sharedObjectOrdering([
        row({ label: 'dimension WFP Currency', mineAt: T(11), other: { name: '1001', at: T(10) } }),
        row({ label: 'dimension WFP Employee', mineAt: T(12), other: { id: 'C', name: '1003', at: T(9) } }),
    ], 'TM1_Test_PROD')
    assert.ok(r)
    assert.match(r.message, /dimension WFP Currency was also changed in 1001/)
    assert.match(r.message, /dimension WFP Employee was also changed in 1003/)
    assert.equal(r.older.length, 2)
})

test('the same change set touching a dimension twice is judged by its latest time', () => {
    // The caller collapses per-session rows to the latest timestamp; this asserts
    // the rule that matters: a later edit in the same set makes it "after" the other.
    const latest = T(13)
    const r = sharedObjectOrdering([row({ mineAt: latest, other: { name: '1001', at: T(12) } })], 'T')
    assert.ok(r)
    const r2 = sharedObjectOrdering([row({ mineAt: latest, other: { name: '1001', at: T(14) } })], 'T')
    assert.equal(r2, null)
})

test('a change set recorded as "no change to deploy" does not block, like a retired one', () => {
    // Its objects already matched the target when it was released, so it owns
    // nothing left to apply — blocking on it was a deadlock with no exit.
    const r = sharedObjectOrdering([row({ mineAt: T(11), other: { name: '1001', at: T(10), noChange: true } })], 'T')
    assert.equal(r, null)
})

// ── Rules, processes, views, subsets and cubes: always stop ─────────────────

test('a whole object changed by a NEWER undeployed set stops — the old "older set first" allowance is gone', () => {
    // The old rule let this through (ship the older set first, in order). For a
    // whole object that would silently hide the other developer's version.
    const r = sharedObjectOrdering([row({ type: 'subset', label: 'subset JDLove', mineAt: T(10), other: { name: '1002', at: T(11) } })], 'TM1_Test_PROD')
    assert.ok(r)
    assert.match(r.message, /subset JDLove was also changed in 1002 \(11:00\)/)
    assert.match(r.message, /Only one change set can own an object version/)
    assert.equal(r.shared.length, 1)
    assert.equal(r.older.length, 0)
    assert.equal(r.newer.length, 0)
})

test('a whole object changed by an OLDER undeployed set stops too — either way round', () => {
    const r = sharedObjectOrdering([row({ type: 'cube', label: 'cube WFP Cost', mineAt: T(11), other: { name: '1001', at: T(10) } })], 'TM1_Test_PROD')
    assert.ok(r)
    assert.match(r.message, /cube WFP Cost was also changed in 1001/)
    assert.equal(r.shared.length, 1)
})

test('every whole object kind is strict: rules, process, view, subset, cube', () => {
    for (const [type, label] of [
        ['rules', 'cube WFP Workforce Cost'],
        ['cube', 'cube WFP Cost'],
        ['process', 'process Load Data'],
        ['view', 'view Default'],
        ['subset', 'subset JDLove'],
    ]) {
        const r = sharedObjectOrdering([row({ type, label, mineAt: T(10), other: { at: T(11) } })], 'T')
        assert.ok(r, `${type} must stop`)
        assert.equal(r.shared.length, 1, `${type} must be a shared-object stop`)
    }
})

test('a whole object changed only by an already-deployed set does not block', () => {
    // That set's version is on the target already; shipping this one after it is
    // ordinary work, not an overlap still waiting to go.
    assert.equal(sharedObjectOrdering([row({ type: 'view', label: 'view Default', mineAt: T(11), other: { at: T(10), deployed: true } })], 'T'), null)
})
