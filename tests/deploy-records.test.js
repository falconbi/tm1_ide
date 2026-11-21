'use strict'

// The deploy report is the only durable answer to "what did this deploy do?".
// The builder is pure so it can be checked without a TM1 server: everything it
// writes must come from the deploy result, and the outcome must match what the
// user was shown (the same six states as the outcome cards).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildRecord, classify } = require('../core/deploy-records')

const base = {
    target: 'TM1_Test_PROD',
    source: 'TM1_Test_DEV',
    branch: 'release-TM1_Test_PROD',
    baseCommit: 'a'.repeat(40),
    releaseCommit: 'b'.repeat(40),
    targetCommit: 'b'.repeat(40),
    changeSetId: 's1',
    changeSetName: 'JDLove test',
    approvedBy: 'admin',
    approvedAt: '2026-11-21T08:40:00.000Z',
    approvalNote: 'Shipped from the one-step ship',
    executed: true,
    drift: 'clean',
    driftEntries: [],
    driftNonBlocking: [],
    shippedObjects: [{ type: 'cube', name: 'WFP Assignment' }, { type: 'process', name: 'WFP Add Opening Period' }],
    verification: { total: 6, passed: 6, failed: 0, failures: [], results: [] },
    controlOk: true,
}

test('a clean deploy records what shipped, who approved it, and the checks', () => {
    const r = buildRecord(base, { startedAt: '2026-11-21T08:40:00.000Z' })
    assert.equal(r.outcome, 'ok')
    assert.equal(r.target, 'TM1_Test_PROD')
    assert.equal(r.changeSet.name, 'JDLove test')
    assert.equal(r.approval.by, 'admin')
    assert.deepEqual(r.objects.map(o => o.name), ['WFP Assignment', 'WFP Add Opening Period'])
    assert.deepEqual(r.checks, { total: 6, passed: 6, failed: 0, failures: [] })
    assert.equal(r.drift.before, 'clean')
    assert.equal(typeof r.durationMs, 'number')
})

test('a refused deploy is recorded too — with its reason and the object list', () => {
    const r = buildRecord({
        ...base,
        executed: false,
        refused: true,
        error: 'PROD has drifted: M dimensions/Account.hierarchies/Account.json. Re-apply the change on DEV…',
        verification: undefined,
    })
    assert.equal(r.outcome, 'refused')
    assert.equal(r.executed, false)
    assert.match(r.error, /drifted/)
    // The change set's objects are still listed: the report says what WOULD have shipped.
    assert.equal(r.objects.length, 2)
})

test('a pull that fails part-way is its own outcome, not a plain refusal', () => {
    assert.equal(classify({ executed: false, error: 'Pull failed: 500 server exploded' }), 'pull-failed')
    assert.equal(classify({ executed: false, refused: true, error: 'Refused: nope' }), 'refused')
})

test('the outcome follows the deploy\'s own signals, worst first', () => {
    assert.equal(classify({ ...base, recorded: false }), 'unrecorded')
    assert.equal(classify({ ...base, subsetsViews: { errors: [{ type: 'view', name: 'V', error: 'x' }] } }), 'subsets-views')
    assert.equal(classify({ ...base, incomplete: ['cube A'] }), 'incomplete')
    assert.equal(classify({ ...base, controlOk: false }), 'checks-failed')
})

test('drift entries and failed checks survive into the record', () => {
    const r = buildRecord({
        ...base,
        controlOk: false,
        drift: 'drifted',
        driftEntries: [{ status: 'M', file: 'dimensions/Account.json' }],
        driftNonBlocking: [{ status: 'M', file: 'cubes/X.views/Default.json' }],
        verification: {
            total: 6, passed: 5, failed: 1,
            failures: [{ id: 'a1', description: 'Totals tie out', expected: 0, actual: 5 }],
            results: [],
        },
    })
    assert.equal(r.outcome, 'checks-failed')
    assert.deepEqual(r.drift.blocking.map(e => e.file), ['dimensions/Account.json'])
    assert.deepEqual(r.drift.reported.map(e => e.file), ['cubes/X.views/Default.json'])
    assert.equal(r.checks.failures[0].description, 'Totals tie out')
})
