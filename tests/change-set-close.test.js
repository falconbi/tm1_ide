'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))
const calls = []
const session = { id: 's1', server: 'S1', name: 'test' }
require.cache[resolve('core/change_log')] = {
    id: resolve('core/change_log'), filename: resolve('core/change_log'), loaded: true,
    exports: {
        getSession: id => (id === 's1' ? session : null),
        closeSession: (id, opts) => { calls.push(['closeSession', id, opts]); return { ...session, ...opts } },
    },
}
require.cache[resolve('core/change-set-model')] = {
    id: resolve('core/change-set-model'), filename: resolve('core/change-set-model'), loaded: true,
    exports: {
        closeAndPersist: async (server, sess, opts) => { calls.push(['closeAndPersist', server, sess.id, opts]) },
    },
}
const { closeChangeSet } = require(resolve('core/change-set-service'))

test('closeChangeSet persists the model record before closing locally', async () => {
    calls.length = 0
    const client = { name: 'fake-client' }
    const out = await closeChangeSet('s1', { user: 'ai-agent', tests: { passed: 1, total: 1, blocking: 0 }, client })
    assert.equal(out.id, 's1')
    assert.deepEqual(calls.map(c => c[0]), ['closeAndPersist', 'closeSession'])
    assert.equal(calls[0][1], 'S1')
    assert.equal(calls[0][2], 's1')
    assert.equal(calls[0][3].closedBy, 'ai-agent')
    assert.equal(calls[0][3].client, client)
    assert.equal(calls[1][2].user, 'ai-agent')
})

test('a missing change set closes nothing', async () => {
    calls.length = 0
    assert.equal(await closeChangeSet('missing', { user: 'ai-agent' }), null)
    assert.deepEqual(calls, [])
})
