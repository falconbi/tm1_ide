'use strict'

// Parts M / L.3 / K.1 — the deliberate admin resets.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))
const { startAgain, recloneTest, prepareDevRestore } = require(path.join(__dirname, '..', 'core', 'deploy-admin'))

function closed(name, server) {
    const s = cl.startSession(name, server, 'admin')
    cl.closeSession(s.id, { user: 'admin', tests: { passed: 1, total: 1, blocking: 0 } })
    return s
}

test('start again refuses while a closed, undeployed change set exists', async () => {
    const s = closed('stranded', 'M1')
    const r = await startAgain('M1', { deps: { clearDeployState: async () => ({ local: true, model: false }) } })
    assert.equal(r.ok, false)
    assert.equal(r.refused, true)
    assert.match(r.error, /stranded/)
    // Retiring it lets start again through.
    cl.markSessionWontDeploy(s.id, { by: 'admin', reason: 'superseded' })
    let cleared = null
    const ok = await startAgain('M1', { deps: { clearDeployState: async (server) => { cleared = server; return { local: true, model: true } } } })
    assert.equal(ok.ok, true, ok.error)
    assert.equal(cleared, 'M1')
})

test('a deployed or open change set does not block start again', async () => {
    const deployed = closed('deployed', 'M2')
    cl.recordSessionDeploy(deployed.id, { target: 'TEST', status: 'complete' })
    cl.startSession('still open', 'M2', 'admin')
    const r = await startAgain('M2', { deps: { clearDeployState: async () => ({ local: true, model: false }) } })
    assert.equal(r.ok, true, r.error)
})

test('re-cloning TEST supersedes the TEST deploys that never reached another target', async () => {
    const onlyTest = closed('test only', 'D-L')
    cl.recordSessionDeploy(onlyTest.id, { target: 'T-L', status: 'complete' })
    const both = closed('through to prod', 'D-L')
    cl.recordSessionDeploy(both.id, { target: 'T-L', status: 'complete' })
    cl.recordSessionDeploy(both.id, { target: 'P-L', status: 'complete' })

    const marked = []
    const r = await recloneTest('T-L', {
        token: 't', gitUser: 'g',
        deps: {
            pushServerState: async () => ({ commit: 'NEWTEST' }),
            recordDeploy: async () => ({ ok: true }),
            initialiseAttrs: async () => ({ ok: true, commit: 'ATTRS' }),
            setDeployStatus: async (id, target, status, reason) => { marked.push([id, target, status, reason]) },
        },
    })
    assert.equal(r.ok, true, r.error)
    assert.equal(r.commit, 'NEWTEST')
    assert.equal(r.attrsCommit, 'ATTRS')
    assert.deepEqual(marked.map(m => m[0]), [onlyTest.id], 'only the set that never left TEST is superseded')
    assert.deepEqual(marked[0].slice(1), ['T-L', 'superseded', 'TEST was re-cloned from PROD'])
})

test('prepare DEV for restore refuses while any change set is open', () => {
    const open = cl.startSession('open', 'K1', 'admin')
    const r = prepareDevRestore('K1')
    assert.equal(r.ok, false)
    assert.match(r.error, /open/)
    cl.closeSession(open.id, { user: 'admin' })
    assert.equal(prepareDevRestore('K1').ok, true)
})
