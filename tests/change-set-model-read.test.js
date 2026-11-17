'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))
let migrated = true
let names = []
let unreadable = new Set()
const store = {
    async isMigrated() { return migrated },
    async listDocs() { return names },
    async readDoc(_server, _area, name) {
        if (unreadable.has(name)) throw new Error('bad JSON')
        return { id: name.replace(/\.json$/, ''), started_at: name }
    },
}
require.cache[resolve('core/model-store')] = {
    id: resolve('core/model-store'), filename: resolve('core/model-store'), loaded: true, exports: store,
}
const csm = require(resolve('core/change-set-model.js'))

test('a model-owned area lists every readable session', async () => {
    migrated = true
    names = ['a.json', 'b.json']
    unreadable = new Set()
    const sessions = await csm.listSessions('S1')
    assert.deepEqual(sessions.map(s => s.id), ['b', 'a'])
})

test('an unreadable model-owned document fails loudly and names the document', async () => {
    migrated = true
    names = ['a.json', 'broken.json']
    unreadable = new Set(['broken.json'])
    await assert.rejects(
        () => csm.listSessions('S1'),
        (e) => /Applications\/Governance\/ChangeSets\/broken\.json/.test(e.message) &&
            /S1/.test(e.message) &&
            /bad JSON/.test(e.message)
    )
})

test('a local area returns null (the local working log is the fallback)', async () => {
    migrated = false
    names = ['a.json']
    unreadable = new Set()
    assert.equal(await csm.listSessions('S1'), null)
})
