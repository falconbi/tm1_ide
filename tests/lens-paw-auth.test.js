'use strict'
// A PAW-native server signs in through PAW (the IDE's paw-connect session) and
// then calls TM1 through PAW as that person. No TM1 is involved in these tests.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { createApp } = require('../lens-server')

function deps(over = {}) {
  return {
    probeAuthMethod: async () => ({ method: 'paw' }),
    createPawSession: async (user, password) => {
      if (password !== 'pw') { const e = new Error('PAW said no'); e.response = { status: 401 }; throw e }
      return 'paw-token'
    },
    makePawClient: () => ({ _adapter: {}, async get() { return { Name: 'east_mgr', Groups: [] } } }),
    invalidatePawSession: () => {},
    listLenses: async () => [],
    readLens: async (s, name) => ({ name, status: 'published', toolkitVersion: 1, html: '<p>x</p>' }),
    ...over,
  }
}

async function withApp(fn, over = {}) {
  const { app, close } = createApp({ config: { server: 'S1', port: 0, endSessionProcesses: [] }, deps: deps(over) })
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  const base = `http://127.0.0.1:${srv.address().port}`
  const signin = (username, password) => fetch(`${base}/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  try { await fn({ base, signin }) } finally { srv.close(); close() }
}
const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0]

test('a PAW-native server signs in through PAW and signs out with it', async () => {
  const made = [], gone = []
  await withApp(async ({ base, signin }) => {
    const r = await signin('east_mgr', 'pw')
    assert.equal(r.status, 200)
    assert.deepEqual(made, [['S1', 'paw-token']])
    const cookie = cookieOf(r)

    const who = await fetch(`${base}/api/lens/whoami`, { headers: { cookie } })
    assert.equal(who.status, 200)
    assert.equal((await who.json()).user, 'east_mgr')

    await fetch(`${base}/auth/signout`, { method: 'POST', headers: { cookie, accept: 'application/json' } })
    assert.deepEqual(gone, ['paw-token'], 'the PAW session is released with the last browser session')
  }, {
    createPawSession: async (u, p) => { assert.equal(p, 'pw'); return 'paw-token' },
    makePawClient: (server, token) => { made.push([server, token]); return { _adapter: {}, async get() { return { Name: 'east_mgr', Groups: [] } } } },
    invalidatePawSession: token => { gone.push(token) },
  })
})

test('a wrong PAW password is refused and never becomes a TM1 error', async () => {
  await withApp(async ({ signin }) => {
    const r = await signin('east_mgr', 'wrong')
    assert.equal(r.status, 403)
    const body = await r.json()
    assert.equal(body.rejected, true)
    assert.match(body.error, /PAW rejected the login/)
  })
})

test('a method the Lens app does not support is still refused clearly', async () => {
  await withApp(async ({ signin }) => {
    const r = await signin('east_mgr', 'pw')
    assert.equal(r.status, 400)
    assert.match((await r.json()).error, /Sign-in method "unknown" .* not supported/)
  }, { probeAuthMethod: async () => ({ method: 'unknown' }) })
})
