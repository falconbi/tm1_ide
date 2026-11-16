'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createSaveDataAllRoute, isAdminGroups } = require('../core/save_data_all')
const { TM1Client } = require('../core/tm1_client')

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this },
        json(body) { this.body = body; return this },
    }
}

function routeFor({ admin = true } = {}) {
    const calls = { save: 0, log: 0 }
    const client = {
        async get(path) {
            assert.equal(path, 'ActiveUser')
            return { Name: admin ? 'admin' : 'planner', Groups: admin ? [{ Name: 'ADMIN' }] : [{ Name: 'Finance' }] }
        },
        async saveDataAll() { calls.save++; return { method: 'rest' } },
    }
    const logs = []
    const route = createSaveDataAllRoute({
        makeClient: () => client,
        gateReadOnly: () => true,
        writeLog: entry => { calls.log++; logs.push(entry) },
    })
    return { route, calls, logs }
}

test('save-data-all route saves for a TM1 admin', async () => {
    const { route, calls, logs } = routeFor({ admin: true })
    const res = response()
    await route({ body: { server: 'TM1_Test_DEV' }, ideToken: 'tok', user: 'admin' }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.server, 'TM1_Test_DEV')
    assert.equal(res.body.method, 'rest')
    assert.match(res.body.savedAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(calls.save, 1)
    assert.equal(calls.log, 1)
    assert.equal(logs[0].action, 'SAVE_DATA_ALL')
})

test('save-data-all route refuses a non-admin plainly', async () => {
    const { route, calls, logs } = routeFor({ admin: false })
    const res = response()
    await route({ body: { server: 'TM1_Test_DEV' }, ideToken: 'tok', user: 'planner' }, res)
    assert.equal(res.statusCode, 403)
    assert.match(res.body.error, /Only TM1 admins can save data on TM1_Test_DEV/)
    assert.equal(calls.save, 0, 'SaveDataAll must not run for a non-admin')
    assert.equal(calls.log, 0)
})

test('admin group matching is case-insensitive', () => {
    assert.equal(isAdminGroups([{ Name: 'admin' }]), true)
    assert.equal(isAdminGroups([{ Name: 'Finance' }, { Name: 'ADMIN' }]), true)
    assert.equal(isAdminGroups([{ Name: 'Finance' }]), false)
})

test('saveDataAll uses the REST action when the server supports it', async () => {
    const c = Object.create(TM1Client.prototype)
    c.server = 'TM1_Test_DEV'
    c.post = async (path) => { assert.equal(path, 'tm1.SaveDataAll'); return {} }
    c.getProcess = async () => { throw new Error('must not fall back') }
    assert.deepEqual(await c.saveDataAll(), { method: 'rest' })
})

test('saveDataAll falls back to the hidden core TI when REST is unsupported', async () => {
    const c = Object.create(TM1Client.prototype)
    c.server = 'TM1_Test_DEV'
    let created = null, ran = null
    c.post = async () => { throw Object.assign(new Error('not found'), { response: { status: 404 } }) }
    c.getProcess = async () => { throw Object.assign(new Error('not found'), { response: { status: 404 } }) }
    c.createOrReplaceProcess = async def => { created = def }
    c.executeProcess = async name => { ran = name; return { ProcessExecuteStatusCode: 'CompletedSuccessfully' } }
    const result = await c.saveDataAll()
    assert.equal(result.method, 'ti')
    assert.equal(created.name, '}IDE.SaveDataAll')
    assert.match(created.prolog, /SaveDataAll;/)
    assert.equal(ran, '}IDE.SaveDataAll')
})
