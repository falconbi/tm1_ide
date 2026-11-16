'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { createAdminGate } = require('../core/admin_gate')
const { createCancelJobRoute } = require('../core/admin_routes')
const { isAdminGroups } = require('../core/save_data_all')

function fakeRes() {
    const res = { statusCode: 200, body: null }
    res.status = code => { res.statusCode = code; return res }
    res.json = body => { res.body = body; return res }
    return res
}

function gateFor(admin, seen) {
    return createAdminGate({
        isAdminGroups,
        makeClient: () => ({
            async get() {
                seen.calls++
                return { Groups: admin ? [{ Name: 'ADMIN' }] : [{ Name: 'Finance' }] }
            },
        }),
    })
}

test('a non-admin is refused with the one admin error', async () => {
    const seen = { calls: 0 }
    const { requireTm1Admin } = gateFor(false, seen)
    const res = fakeRes()
    assert.equal(await requireTm1Admin({ ideToken: 't1', user: 'planner' }, res, 'S1'), false)
    assert.equal(res.statusCode, 403)
    assert.deepEqual(res.body, { error: 'TM1 Admin group required' })
})

test('an admin passes and the answer is cached per token + server', async () => {
    const seen = { calls: 0 }
    const { requireTm1Admin } = gateFor(true, seen)
    const req = { ideToken: 't2', user: 'admin' }
    assert.equal(await requireTm1Admin(req, fakeRes(), 'S1'), true)
    assert.equal(await requireTm1Admin(req, fakeRes(), 'S1'), true)
    assert.equal(seen.calls, 1, 'second call came from the cache')
})

test('the admin cancel route refuses before calling TM1, and runs for an admin', async () => {
    const calls = []
    const client = { async cancelJob(id) { calls.push(id) } }
    const req = { query: { server: 'S1', id: 'job-1' }, ideToken: 'tok' }
    let res = fakeRes()
    const denied = createCancelJobRoute({
        makeClient: () => client,
        requireTm1Admin: async (_req, r) => { r.status(403).json({ error: 'TM1 Admin group required' }); return false },
    })
    await denied(req, res)
    assert.equal(res.statusCode, 403)
    assert.deepEqual(calls, [], 'no TM1 call for a non-admin')

    res = fakeRes()
    const allowed = createCancelJobRoute({ makeClient: () => client, requireTm1Admin: async () => true })
    await allowed(req, res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(calls, ['job-1'])
})

test('the per-server login info carries isAdmin, and the UI hides admin controls without it', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8')
    const loginRoute = serverSrc.slice(serverSrc.indexOf("app.get('/api/auth/servers'"), serverSrc.indexOf("app.post('/api/auth/server-login'"))
    assert.match(loginRoute, /isAdmin:/)
    const statusBar = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'components', 'StatusBar.jsx'), 'utf8')
    const app = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'App.jsx'), 'utf8')
    assert.match(statusBar, /server && isAdmin &&/)
    assert.match(app, /function AdminOnly/)
    assert.match(app, /AdminOnly server=\{server\}/)
})
