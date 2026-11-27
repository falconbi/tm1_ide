'use strict'

// TM1's ExecuteProcess expects Parameters: [{ Name, Value }]. The backup helper
// used to send a flat [name, value] array, which TM1 rejects with
// "NameValuePair ... Expecting Object but was String". The client normalises all
// three accepted shapes.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TM1Client } = require('../core/tm1-client')

function capture() {
    const c = new TM1Client('S', {})
    const seen = []
    c.post = async (path, body) => { seen.push({ path, body }); return {} }
    return { c, seen }
}

test('a flat [name, value] array becomes Name/Value objects', async () => {
    const { c, seen } = capture()
    await c.executeProcess('P', ['pKeep', 5, 'pBackupFile', 'x.zip'])
    assert.deepEqual(seen[0].body.Parameters, [
        { Name: 'pKeep', Value: '5' },
        { Name: 'pBackupFile', Value: 'x.zip' },
    ])
})

test('an object becomes Name/Value objects', async () => {
    const { c, seen } = capture()
    await c.executeProcess('P', { pKeep: 5, pBackupFile: 'x.zip' })
    assert.deepEqual(seen[0].body.Parameters, [
        { Name: 'pKeep', Value: '5' },
        { Name: 'pBackupFile', Value: 'x.zip' },
    ])
})

test('an array of Name/Value objects is passed through', async () => {
    const { c, seen } = capture()
    const params = [{ Name: 'pCube', Value: 'Sales' }]
    await c.executeProcess('P', params)
    assert.deepEqual(seen[0].body.Parameters, params)
})

test('an empty array stays empty', async () => {
    const { c, seen } = capture()
    await c.executeProcess('P', [])
    assert.deepEqual(seen[0].body.Parameters, [])
})
