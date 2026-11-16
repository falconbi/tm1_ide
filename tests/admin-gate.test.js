'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { createAdminGate } = require('../core/admin_gate')
const { isAdminGroups } = require('../core/save_data_all')

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')

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

test('every admin mutation and sensitive read uses requireTm1Admin', () => {
    const routes = [
        "app.post('/api/job/cancel'",
        "app.delete('/api/session'",
        "app.post('/api/thread/cancel'",
        "app.get('/api/admin/metrics'",
        "app.get('/api/admin/configuration'",
        "app.patch('/api/admin/configuration'",
        "app.post('/api/admin/maintenance/enable'",
        "app.post('/api/admin/maintenance/disable'",
        "app.post('/api/users/provision'",
        "app.post('/api/users/:name/password'",
        "app.post('/api/users',",
        "app.patch('/api/users/:name'",
        "app.delete('/api/users/:name'",
        "app.post('/api/users/:name/groups'",
        "app.delete('/api/users/:name/groups/:group'",
        "app.get('/api/admin/catalog-overrides'",
        "app.put('/api/admin/catalog-overrides'",
    ]
    for (const route of routes) {
        const start = serverSrc.indexOf(route)
        assert.ok(start >= 0, `missing route ${route}`)
        const next = serverSrc.indexOf('\napp.', start + route.length)
        const body = serverSrc.slice(start, next < 0 ? undefined : next)
        assert.match(body, /requireTm1Admin/, `${route} must require TM1 Admin`)
    }
})

test('the per-server login info carries isAdmin, and the UI hides admin controls without it', () => {
    const loginRoute = serverSrc.slice(serverSrc.indexOf("app.get('/api/auth/servers'"), serverSrc.indexOf("app.post('/api/auth/server-login'"))
    assert.match(loginRoute, /isAdmin:/)
    const statusBar = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'components', 'StatusBar.jsx'), 'utf8')
    const app = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'App.jsx'), 'utf8')
    assert.match(statusBar, /server && isAdmin &&/)
    assert.match(app, /server && isAdmin &&/)
})
