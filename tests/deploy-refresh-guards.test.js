'use strict'

// The refresh must refuse before touching anything when the change set cannot
// record it. A closed set is the case that matters: the copies would be invisible
// to the release and to the approval, so the deploy would ship objects nobody saw.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, exportsObj) => {
    const r = resolve(rel)
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exportsObj }
}

// Stub the change log: one closed set, one open set, one belonging to another server.
stub('core/change-log', {
    getSession: (id) => ({
        s1: { id: 's1', name: 'Probe', server: 'DEV1', closed_at: '2026-11-22T10:00:00Z' },
        s2: { id: 's2', name: 'Open set', server: 'DEV1', closed_at: null },
        s3: { id: 's3', name: 'Elsewhere', server: 'OTHER', closed_at: null },
    }[id] ?? null),
    // The guards under test fire before any of these are reached.
    writeLog: () => ({ hasSession: true }),
    getSessionLog: () => [],
})

const { applyRefresh } = require('../core/refresh-dev')

const refused = (pattern) => (e) => e.refused === true && pattern.test(e.message)

test('a refresh without a change set is refused', async () => {
    await assert.rejects(
        () => applyRefresh('DEV1', 'PROD1', { session: null }),
        refused(/open a change set first/i),
    )
})

test('a refresh into a closed change set is refused, and says to reopen it', async () => {
    await assert.rejects(
        () => applyRefresh('DEV1', 'PROD1', { session: 's1' }),
        refused(/is closed\. Reopen it/i),
    )
})

test('a change set belonging to another server is refused', async () => {
    await assert.rejects(
        () => applyRefresh('DEV1', 'PROD1', { session: 's3' }),
        refused(/belongs to OTHER/i),
    )
})

test('an unknown change set is refused', async () => {
    await assert.rejects(
        () => applyRefresh('DEV1', 'PROD1', { session: 'nope' }),
        refused(/no change set/i),
    )
})
