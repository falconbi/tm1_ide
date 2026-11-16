import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionKey } from '../client/src/lib/session-key.js'

test('a v11 session uses Name for its disconnect id', () => {
    assert.equal(sessionKey({ Name: 'session-1', User: { Name: 'east_mgr' }, Threads: [] }), 'session-1')
})

test('older session shapes still resolve', () => {
    assert.equal(sessionKey({ ID: 'id-1' }), 'id-1')
    assert.equal(sessionKey({ SessionID: 'sid-1' }), 'sid-1')
    assert.equal(sessionKey(null), null)
})
