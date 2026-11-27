'use strict'

// Parts K.2 / E.6 — warnings when the IDE connects to a server.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))
const { connectCheck } = require(path.join(__dirname, '..', 'core', 'connect-check'))

const client = (st) => ({ post: async (action) => action === 'GitStatus' ? st : {} })

test('E.6 — connecting to DEV warns about every chore left on', async () => {
    const r = await connectCheck('DEVX', {
        label: 'DEV',
        client: client({ Deployment: 'DEV', LocalCommit: { ID: 'a' } }),
        deps: { getChoresWithTasks: async () => [
            { name: 'Nightly', active: true },
            { name: 'Quiet', active: false },
            { name: 'Weekly', active: true },
        ] },
    })
    const w = r.warnings.find(x => x.code === 'chores-on')
    assert.ok(w)
    assert.match(w.message, /2 chores are switched on/)
    assert.match(w.message, /Nightly, Weekly/)
})

test('K.2 — an open change set and DEV moved away from its last write warns and names the set', async () => {
    const closed = cl.startSession('closed before', 'DEVM', 'dev')
    cl.closeSession(closed.id, { user: 'dev' })
    cl.setSessionCommit(closed.id, 'aaaaaaa111')
    cl.startSession('work in progress', 'DEVM', 'dev')

    const r = await connectCheck('DEVM', {
        label: 'DEV',
        client: client({ Deployment: 'DEV', LocalCommit: { ID: 'bbbbbbb222' } }),
        deps: { getChoresWithTasks: async () => [] },
    })
    const w = r.warnings.find(x => x.code === 'dev-recloned')
    assert.ok(w, JSON.stringify(r.warnings))
    assert.match(w.message, /no longer matches its last write into dev/)
    assert.match(w.message, /work in progress/)
})

test('no DEV-only warnings on a non-DEV server', async () => {
    const r = await connectCheck('PRODX', {
        label: 'PROD',
        client: client({ Deployment: 'PROD' }),
        deps: { getChoresWithTasks: async () => [{ name: 'Nightly', active: true }] },
    })
    assert.equal(r.warnings.length, 0)
})
