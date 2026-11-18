'use strict'
// A catch-up is created closed and empty, so it has no close_tests snapshot.
// Approval must accept it; an ordinary release still must carry a clean result.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const resolve = rel => require.resolve(path.join(__dirname, '..', rel))

const approvals = require(resolve('core/git-approvals'))
const approvalPath = resolve('core/git-approvals')
const realApprovals = { ...approvals }
let linked = null
const appended = []
require.cache[approvalPath] = {
    id: approvalPath, filename: approvalPath, loaded: true,
    exports: { ...realApprovals, linkedChangeSet: () => linked, append: async (rec) => { appended.push(rec); return rec } },
}
const releasePath = resolve('core/git-release')
const realRelease = require(releasePath)
require.cache[releasePath] = {
    id: releasePath, filename: releasePath, loaded: true,
    exports: { ...realRelease, checkDependencies: async () => ({ ok: true, blockers: [] }) },
}

const { register } = require(resolve('routes/deploy'))
function app() {
    const handlers = {}
    const a = { get(p, f) { handlers['GET ' + p] = f }, post(p, f) { handlers['POST ' + p] = f }, delete() {} }
    register(a, {
        _GI: () => ({ user: () => 'u' }), _GITOK: () => 't', cl: {},
        fail: (res, e) => res.status(500).json({ error: e.message }),
        fs, gateReadOnly: () => true, gitSecrets: { tokenSource: () => 'none' },
        listServers: () => [], makeClient: () => ({}), path,
        requireTm1Admin: async () => true,
    })
    return handlers
}
function res() { return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } } }

test('approve accepts a catch-up with no close tests', async () => {
    linked = { id: 'cu1', kind: 'catch-up', close_tests: null, release_commit: 'r1', release_added_by_user: null, release_added_as_dependency: null }
    const out = res()
    await app()['POST /api/deploy/git/approve']({ body: { target: 'TG', commit: 'r1' }, user: 'james', ideToken: 't' }, out)
    assert.equal(out.statusCode, 200)
    assert.equal(appended.at(-1).session, 'cu1')
})

test('approve still refuses an ordinary release with no tests', async () => {
    linked = { id: 's1', kind: 'change', close_tests: null, release_commit: 'r1' }
    const out = res()
    await app()['POST /api/deploy/git/approve']({ body: { target: 'TG', commit: 'r1' }, user: 'james', ideToken: 't' }, out)
    assert.equal(out.statusCode, 409)
})
