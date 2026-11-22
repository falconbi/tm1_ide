'use strict'

// What the Release screen offers. The rule changed with the "nothing to deploy"
// record: a set recorded as done must LEAVE the list — leaving it there asks the
// person to ship something already decided (zz-cover-b, zz-cover-d and
// zz-cover-cleanup all stayed on it).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readyToRelease, inProgress } = require('../client/src/lib/deploy/change-sets')

const base = (over = {}) => ({
    name: 'set', closed_at: '2026-11-22T10:00:00Z', started_at: '2026-11-22T09:00:00Z',
    entry_count: 3, deployed_target: null, covered_by: null, wont_deploy_at: null,
    phantom: false, no_change_at: null, ...over,
})

test('a closed, committed set with changes is ready', () => {
    assert.equal(readyToRelease([base()]).length, 1)
})

test('a set recorded "nothing to deploy, done" is no longer ready', () => {
    assert.equal(readyToRelease([base({ no_change_at: '2026-11-22T10:05:00Z' })]).length, 0)
})

test('deployed, covered and retired sets are not ready either', () => {
    assert.equal(readyToRelease([
        base({ name: 'a', deployed_target: 'PROD' }),
        base({ name: 'b', covered_by: 'catchup' }),
        base({ name: 'c', wont_deploy_at: '2026-11-22T10:00:00Z' }),
        base({ name: 'd', phantom: true }),
        base({ name: 'e', closed_at: null }),
        base({ name: 'f', entry_count: 0 }),
    ]).length, 0)
})
