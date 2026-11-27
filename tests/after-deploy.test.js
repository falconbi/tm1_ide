'use strict'

// Part Q — after the deploy: feeders for the cubes whose rules changed, DEV's
// tests against the target, and the developer's manual sign-off.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const { cubesWithChangedRules, reprocessFeeders, runDevTestsOnTarget } = require(path.join(__dirname, '..', 'core', 'after-deploy'))
const records = require(path.join(__dirname, '..', 'core', 'deploy-records'))

test('Q.1 — only cubes whose rules file changed, not every cube in the release', () => {
    const cubes = cubesWithChangedRules([
        { type: 'cube', name: 'Salary', kind: 'rules', action: 'M' },
        { type: 'cube', name: 'Salary', kind: 'rules', action: 'M' },
        { type: 'cube', name: 'Sales', kind: 'cube', action: 'M' },
        { type: 'cube', name: 'Old', kind: 'rules', action: 'D' },
        { type: 'process', name: 'Salary', kind: 'process', action: 'M' },
    ])
    assert.deepEqual(cubes, ['Salary'])
})

test('Q.1 — feeders run once per cube, timing each, and a failure names the cube', async () => {
    const calls = []
    const r = await reprocessFeeders({}, ['A', 'B'], {
        deps: {
            ensureProcess: async () => {},
            runProcess: async (cube) => { calls.push(cube); if (cube === 'B') throw new Error('boom'); return { ProcessExecuteStatusCode: 'CompletedSuccessfully' } },
        },
    })
    assert.deepEqual(calls, ['A', 'B'])
    assert.equal(r.cubes.length, 1)
    assert.equal(r.cubes[0].cube, 'A')
    assert.equal(r.failed.length, 1)
    assert.equal(r.failed[0].cube, 'B')
    assert.match(r.failed[0].error, /boom/)
    assert.ok(r.cubes[0].ms >= 0)
})

test('Q.2 — DEV tests run against the target and a failure names the test', async () => {
    const ok = await runDevTestsOnTarget('DEV', 'PROD', {
        deps: { runAssertions: async (source, opts) => ({ total: 2, passed: 1, failed: [{ id: 'a1', description: 'Salary total' }] }) },
    })
    assert.equal(ok.total, 2)
    assert.equal(ok.failed, 1)
    assert.deepEqual(ok.failures.map(f => f.description), ['Salary total'])
})

test('Q.3 — the deploy record awaits sign-off until it is confirmed', async () => {
    const out = {
        target: 'Q-TARGET', source: 'DEV', releaseCommit: 'abc1234', targetCommit: 'abc1234',
        executed: true, controlOk: true, shippedObjects: [{ type: 'cube', name: 'Salary' }],
        changeSetName: 'Rollup', approval: { approver: 'jo' },
        feeders: { cubes: [{ cube: 'Salary', ms: 12 }], failed: [] },
        devTests: { total: 1, passed: 1, failed: 0 },
        needsChecking: false,
    }
    const rec = records.buildRecord(out, { startedAt: new Date().toISOString() })
    assert.equal(rec.signoff, null)
    assert.match(records.userSummary(rec), /not signed it off/)
    assert.match(records.userSummary(rec), /Q-TARGET was updated/)

    const written = await records.record(out, {})
    assert.equal(written.signoff, null)

    const updated = await records.updateSignoff('Q-TARGET', 'abc1234', { by: 'jo', at: '2026-11-26T10:00:00.000Z' })
    assert.equal(updated.signoff.by, 'jo')
    const read = await records.get('Q-TARGET', 'abc1234')
    assert.equal(read.signoff.by, 'jo')
    assert.match(records.userSummary(read), /Tested on PROD by jo/)
})
