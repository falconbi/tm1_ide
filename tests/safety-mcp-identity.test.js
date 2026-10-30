'use strict'
// Reads run as the end user (TM1 security decides what they see); writes keep
// the builder identity. A per-user login that can't be honoured never falls back.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup, fakeTm1 } = require('./_mcp-harness')

const READ_ENV = { TM1_MCP_READ_USER: 'east_mgr', TM1_MCP_READ_PASSWORD: 'pw' }

test('read tools use the reader login, write tools the builder login', async () => {
    const reader = fakeTm1('reader', { async getModelCubes() { return [{ Name: 'Sales' }] } })
    const h = setup({ env: READ_ENV, reader })
    const r = await h.call('list_cubes')
    assert.deepEqual(r.data, ['Sales'], 'the agent sees only what the reader login returns')
    assert.equal(h.builder.calls.length, 0, 'the builder login is not touched by a read')
    await h.call('reprocess_feeders', { cubes: ['Sales'] })
    assert.ok(h.builder.calls.some(c => c[0] === 'post'), 'the write ran as the builder')
    assert.ok(!reader.calls.some(c => c[0] === 'post'), 'never as the reader')
})

test('the user identity sees only what TM1 returns for that user', async () => {
    // Two logins on the same server: TM1 hands each a different cube list.
    const admin = setup({ builder: fakeTm1('admin', { async getModelCubes() { return [{ Name: 'Sales' }, { Name: 'Opex' }, { Name: 'Capex' }] } }) })
    const user  = setup({ env: READ_ENV, reader: fakeTm1('east', { async getModelCubes() { return [{ Name: 'Sales' }] } }) })
    assert.equal((await admin.call('list_cubes')).data.length, 3)
    assert.deepEqual((await user.call('list_cubes')).data, ['Sales'])
})

test('a reader login that cannot be honoured fails closed — no fallback to the service login', async () => {
    const h = setup({ env: READ_ENV, reader: null })     // e.g. a PAW-routed server
    const r = await h.call('list_cubes')
    assert.equal(r.isError, true)
    assert.match(r.text, /Not falling back/)
    assert.equal(h.builder.calls.length, 0, 'the service login was never used for the read')
})

test('reader user without a password is refused, not tried blank', async () => {
    const h = setup({ env: { TM1_MCP_READ_USER: 'east_mgr' } })
    const r = await h.call('list_cubes')
    assert.equal(r.isError, true)
    assert.match(r.text, /TM1_MCP_READ_PASSWORD/)
})

test('no reader user configured: reads run as the service login and say so', () => {
    const h = setup()
    assert.equal(h.identity.describe().reader, 'service login')
    assert.equal(h.identity.describe().perUser, false)
})

// Optional live check against a lab server (skipped unless configured):
//   TM1_MCP_LIVE_SERVER=24Retail_Lens TM1_MCP_LIVE_USER=east_mgr TM1_MCP_LIVE_PASSWORD=... node --test tests/safety-mcp-identity.test.js
test('live: a restricted TM1 user sees fewer cubes than the service login', { skip: !process.env.TM1_MCP_LIVE_SERVER }, async () => {
    const { makeClient, makeClientWithCredentials } = require('../core/adapter_registry')
    const { createIdentity } = require('../tools/tm1mcp/identity')
    const server = process.env.TM1_MCP_LIVE_SERVER
    const id = createIdentity({ server, makeClient, makeClientWithCredentials, env: {
        TM1_MCP_READ_USER: process.env.TM1_MCP_LIVE_USER, TM1_MCP_READ_PASSWORD: process.env.TM1_MCP_LIVE_PASSWORD } })
    const mine = await id.readClient().getModelCubes()
    const all  = await id.builderClient().getModelCubes()
    assert.ok(mine.length < all.length, `${process.env.TM1_MCP_LIVE_USER} sees ${mine.length} cubes, service login ${all.length}`)
})
