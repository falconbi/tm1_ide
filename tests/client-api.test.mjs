import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { get, post } from '../client/src/lib/api.js'

const realFetch = global.fetch
const realWindow = global.window
const realLocalStorage = global.localStorage
afterEach(() => {
  global.fetch = realFetch
  global.window = realWindow
  global.localStorage = realLocalStorage
})

test('a non-ok response becomes an error carrying the server message', async () => {
  global.localStorage = { getItem: () => 'tok' }
  global.window = { dispatchEvent() {} }
  global.fetch = async () => ({ ok: false, status: 400, statusText: 'Bad Request', url: 'http://x/api/test', async json() { return { error: 'Nope' } }, clone() { return this } })
  await assert.rejects(() => get('/api/test'), /Nope/)
})

test('post returns JSON and raises the noSession event', async () => {
  let seen = null
  global.localStorage = { getItem: () => 'tok' }
  global.window = { dispatchEvent: e => { seen = e } }
  global.fetch = async () => ({ ok: true, status: 200, url: 'http://x/api/test', async json() { return { noSession: true, ok: true } } })
  const d = await post('/api/test', { a: 1 })
  assert.equal(d.ok, true)
  assert.equal(seen.type, 'tm1-no-session')
})

test('apiFetch adds the IDE token to an /api call', async () => {
  global.localStorage = { getItem: () => 'tok' }
  let seen
  global.fetch = async (_url, init) => { seen = init.headers; return { ok: true } }
  const { apiFetch } = await import('../client/src/lib/api.js')
  await apiFetch('/api/test')
  assert.equal(seen.get('x-ide-token'), 'tok')
})
