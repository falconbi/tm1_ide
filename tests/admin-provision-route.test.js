'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TM1Client } = require('../core/tm1_client')
const { createProvisionUserRoute } = require('../core/user_admin')

function setup() {
    const runs = []
    const groups = []
    const updates = []
    const c = new TM1Client('S', {})
    c._runTI = async code => { runs.push(code) }
    c.addClientToGroup = async (...a) => { groups.push(a) }
    c.updateClient = async (...a) => { updates.push(a) }
    const res = { statusCode: 200, body: null }
    res.status = code => { res.statusCode = code; return res }
    res.json = body => { res.body = body; return res }
    const route = createProvisionUserRoute({
        makeClient: () => c,
        gateReadOnly: () => true,
        requireTm1Admin: async () => true,
        userServer: () => 'S1',
        fail: (r, e) => r.status(500).json({ error: e.message }),
    })
    return { route, runs, groups, updates, res }
}

test('the provision route uses provisionUser and records two TI runs', async () => {
    const { route, runs, groups, updates, res } = setup()
    await route({ body: { name: 'east_mgr', password: 'pw', groups: ['Lens East'], friendlyName: 'East Manager' }, ideToken: 'tok' }, res)
    assert.equal(res.body.ok, true)
    assert.equal(runs.length, 2)
    assert.match(runs[0], /^AddClient\('east_mgr'\);$/)
    assert.match(runs[1], /^AssignClientPassword\('east_mgr', 'pw'\);$/)
    assert.deepEqual(groups, [['east_mgr', 'Lens East']])
    assert.deepEqual(updates, [['east_mgr', { FriendlyName: 'East Manager' }]])
})

test('the route refuses before provisioning when the caller is not an admin', async () => {
    const runs = []
    const c = new TM1Client('S', {})
    c._runTI = async code => runs.push(code)
    const res = { statusCode: 200, body: null }
    res.status = code => { res.statusCode = code; return res }
    res.json = body => { res.body = body; return res }
    const route = createProvisionUserRoute({
        makeClient: () => c,
        gateReadOnly: () => true,
        requireTm1Admin: async (_req, r) => { r.status(403).json({ error: 'TM1 Admin group required' }); return false },
        userServer: () => 'S1',
        fail: () => {},
    })
    await route({ body: { name: 'x', password: 'y' }, ideToken: 'tok' }, res)
    assert.equal(res.statusCode, 403)
    assert.equal(runs.length, 0)
})
