'use strict'
// Every read call is audited (who, tool, object, rows); writes are not — they
// go to the change set as before, and reads never do.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./_mcp-harness')

test('a read is audited with the developer, the TM1 login, the tool, the object and the row count', async () => {
    const h = setup({ env: { TM1_MCP_READ_USER: 'east_mgr', TM1_MCP_READ_PASSWORD: 'pw' } })
    await h.call('list_cubes')
    await h.call('get_cube_rules', { cube: 'Sales' })
    assert.equal(h.audit.length, 2)
    assert.deepEqual(
        { user: h.audit[0].user, identity: h.audit[0].identity, tool: h.audit[0].tool, rows: h.audit[0].rows, outcome: h.audit[0].outcome },
        { user: 'dev-test', identity: 'east_mgr', tool: 'list_cubes', rows: 2, outcome: 'ok' })
    assert.equal(h.audit[1].object, 'cube=Sales')
})

test('writes are not read-audited and reads never touch the change set', async () => {
    const h = setup()
    await h.call('reprocess_feeders', { cubes: ['Sales'] })
    assert.equal(h.audit.length, 0)
    await h.call('list_cubes')
    assert.equal(h.changes.length, 0, 'no change-set entry from a read')
})

test('a failed read is audited as an error', async () => {
    const h = setup()
    h.builder.getModelCubes = async () => { throw new Error('TM1 is down') }
    const r = await h.call('list_cubes')
    assert.equal(r.isError, true)
    assert.equal(h.audit[0].outcome, 'error')
    assert.match(h.audit[0].detail, /TM1 is down/)
})

test('read audit retention drops rows older than the setting, and 0 keeps everything', () => {
    const cl = require('../core/change_log')
    const server = `retention-test-${process.pid}-${Date.now()}`
    cl.writeReadAudit({ server, tool: 'list_cubes', outcome: 'ok' })
    const later = Date.now() + 91 * 86_400_000
    assert.equal(cl.pruneReadAudit(0, { server, now: later }), 0, '0 = keep forever')
    assert.equal(cl.pruneReadAudit(90, { server, now: Date.now() }), 0, 'a fresh row is kept')
    assert.equal(cl.pruneReadAudit(90, { server, now: later }), 1, 'older than 90 days goes')
    assert.equal(cl.getReadAudit(server).length, 0)
})
