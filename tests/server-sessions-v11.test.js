'use strict'
// The Sessions monitor showed "0 sessions" and a 400 on TM1 v11 because
// getSessions asked for Session.CurrentThread, which v11 does not have — TM1
// rejects the whole request. v11 exposes Session.Threads; v12 has CurrentThread.
// getSessions must try the working expansion and remember it.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TM1Client } = require('../core/tm1_client')

function clientWith(adapter) {
  return new TM1Client('TestServer', {
    async get(path, params) { return adapter.get(path, params) },
    async patch() { throw new Error('not used') },
    async post() { throw new Error('not used') },
    async delete() { throw new Error('not used') },
    async put() { throw new Error('not used') },
  })
}

test('getSessions uses Threads on v11 (never asks for CurrentThread)', async () => {
  const seen = []
  const c = clientWith({
    async get(path, params) {
      seen.push(params.$expand)
      return { value: [{ Name: 'session-1', Threads: [{ Name: 'thread-1' }] }] }
    },
  })
  const sessions = await c.getSessions()
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].Threads[0].Name, 'thread-1')
  assert.deepEqual(seen, ['User,Threads'])
})

test('getSessions falls back to CurrentThread where Threads does not exist (v12)', async () => {
  const seen = []
  const c = clientWith({
    async get(path, params) {
      seen.push(params.$expand)
      if (params.$expand === 'User,Threads') throw { response: { status: 400, data: { error: { message: '"Threads" is not a property of "Session".' } } } }
      if (params.$expand === 'User,CurrentThread') return { value: [{ Name: 'session-1', CurrentThread: { Name: 'thread-1' } }] }
      throw new Error('unexpected expansion: ' + params.$expand)
    },
  })
  const sessions = await c.getSessions()
  assert.equal(sessions[0].CurrentThread.Name, 'thread-1')
  assert.deepEqual(seen, ['User,Threads', 'User,CurrentThread'])
})

test('getSessions remembers the expansion that worked', async () => {
  const seen = []
  const c = clientWith({
    async get(path, params) {
      seen.push(params.$expand)
      if (params.$expand === 'User,Threads') throw { response: { status: 400 } }
      return { value: [] }
    },
  })
  await c.getSessions()
  await c.getSessions()
  assert.deepEqual(seen, ['User,Threads', 'User,CurrentThread', 'User,CurrentThread'])
})

test('getSessions throws when no expansion is accepted', async () => {
  const c = clientWith({
    async get() { throw { response: { status: 400, data: { error: { message: 'nope' } } } } },
  })
  await assert.rejects(() => c.getSessions())
})
