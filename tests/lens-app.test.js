'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { createApp } = require('../lens-server')

// Offline two-point tests for the Lens app server: the TM1-facing pieces
// (probe, sign-in, lens store, bridge calls) are injected stubs, so nothing
// touches a real TM1 server. We drive the real express app over an ephemeral
// listener with fetch.

let server, base, stubs, appCtl

const CFG = { server: 'SrvA', port: 0, showDrafts: true, idleMinutes: 30, https: { enabled: false } }

async function setup(stubOverrides = {}) {
  stubs = {
    probeAuthMethod: async () => ({ server: 'SrvA', method: 'native', camNamespace: null }),
    makeClientWithCredentials(server, creds) {
      const client = {
        async get() {
          if (creds?.password === 'bad') throw { code: 'TM1_AUTH_REJECTED', response: { status: 401 } }
          return { Name: creds?.username ?? 'admin' }
        },
      }
      client._creds = creds
      return client
    },
    execMdx: async (client, mdx) => ({ executedAs: client._creds?.username ?? '?', mdx: String(mdx).slice(0, 20) }),
    readCell: async (client, cube, coords) => ({ readAs: client._creds?.username ?? '?', cube, coords }),
    getMeta: async (client, cube) => ({ metaFor: client._creds?.username ?? '?', cube }),
    listLenses: async (server, opts) => ([
      { name: 'PnL-Dashboard', status: 'published', version: 1, toolkitVersion: 1, updated: '2026-10-01T00:00:00Z', description: 'P&L' },
      { name: 'Private-Draft', status: 'draft', version: 2, toolkitVersion: 1 },
    ]),
    readLens: async (server, name, opts) => {
      if (name === 'Future') return { name: 'Future', toolkitVersion: 5, html: '<p>future</p>' }
      return { name, status: 'published', version: 1, toolkitVersion: 1, html: '<div>hello lens</div>' }
    },
    ...stubOverrides,
  }
  delete require.cache[require.resolve('../lens-server')]
  appCtl = createApp({ config: CFG, deps: stubs })
  server = http.createServer(appCtl.app)
  await new Promise(r => server.listen(0, r))
  base = `http://127.0.0.1:${server.address().port}`
}

async function teardown() {
  appCtl?.close()
  await new Promise(r => {
    if (!server) return r()
    server.closeAllConnections?.()   // drop undici keep-alive sockets, or close() never returns
    server.close(() => r())
  })
}

before(async () => { await setup() })
after(async () => { await teardown() })

const post = (url, body, cookie) => fetch(base + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
})
const get = (url, cookie) => fetch(base + url, { headers: { ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual' })

async function signIn(as = 'admin', pwd = 'pw') {
  const r = await post('/auth/signin', { username: as, password: pwd })
  const setc = r.headers.get('set-cookie') ?? ''
  const sid = (setc.match(/lens_session=([^;]+)/) ?? [])[1]
  return { setc, sid, cookie: sid ? `lens_session=${sid}` : '' }
}

test('sign-in accepts valid credentials and issues an HttpOnly, SameSite=Strict session cookie', async () => {
  const { setc, cookie } = await signIn()
  assert.equal((await get('/', cookie)).status, 200, 'home is reachable with the session')
  assert.match(setc, /lens_session=[0-9a-f]+/)
  assert.match(setc, /HttpOnly/i)
  assert.match(setc, /SameSite=Strict/i)
  assert.match(setc, /Path=\//)
  assert.ok(!/Secure/i.test(setc), 'no Secure flag on a plain-HTTP listener')
})

test('a wrong password is refused once and never retried or stored', async () => {
  let attempts = 0
  await teardown()
  await setup({
    makeClientWithCredentials(server, creds) {
      attempts++
      return {
        async get() {
          if (creds?.password === 'bad') throw { code: 'TM1_AUTH_REJECTED', response: { status: 401 } }
          return { Name: 'admin' }
        },
      }
    },
  })
  try {
    const r = await post('/auth/signin', { username: 'admin', password: 'bad' })
    assert.equal(r.status, 403)
    const body = await r.json()
    assert.equal(body.rejected, true)
    assert.match(body.error, /TM1 rejected the login/)
    assert.equal(attempts, 1, 'rejected credentials are never retried')
    assert.ok(!(r.headers.get('set-cookie') ?? '').includes('lens_session='), 'no session cookie after a rejection')
  } finally { await teardown(); await setup() }
})

test('no route works without a session — pages redirect, the API refuses', async () => {
  assert.equal((await get('/')).status, 302)
  assert.equal((await get('/lens/PnL-Dashboard')).status, 302)
  assert.equal((await get('/api/lenses')).status, 401)
  assert.equal((await get('/api/lens/meta')).status, 401)
  const r = await post('/api/lens/exec-mdx', { mdx: 'S' })
  assert.equal(r.status, 401)
})

test('bridge reads run AS the signed-in user', async () => {
  const { cookie } = await signIn('reviewer')
  const r = await post('/api/lens/exec-mdx', { mdx: 'SELECT {} ON 0 FROM [C]' }, cookie)
  assert.equal(r.status, 200)
  const body = await r.json()
  assert.equal(body.executedAs, 'reviewer')
})

test('the server always comes from settings — a request naming another is refused', async () => {
  const { cookie } = await signIn()
  let execCalls = 0
  const orig = stubs.execMdx
  stubs.execMdx = async (c, m) => { execCalls++; return orig(c, m) }
  try {
    const r = await post('/api/lens/exec-mdx?server=H4x0r', { mdx: 'S' }, cookie)
    assert.equal(r.status, 400)
    assert.match((await r.json()).error, /configured server/)
    assert.equal(execCalls, 0, 'the other server never reaches the bridge')
  } finally { stubs.execMdx = orig }
})

test('no write routes exist — anything that would save/delete/run is a 404', async () => {
  const { cookie } = await signIn()
  const attempts = [
    ['POST', '/api/lenses'],
    ['POST', '/api/lens/write'],
    ['POST', '/api/lens/exec-MDX'],          // casing drift must not exist either
    ['PUT', '/api/lens/PnL-Dashboard'],
    ['DELETE', '/api/lens/PnL-Dashboard'],
    ['DELETE', '/api/lens/exec-mdx'],
  ]
  for (const [method, url] of attempts) {
    const r = await fetch(base + url, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(r.status, 404, `${method} ${url} should not exist`)
  }
})

test('home lists published Lenses, and drafts only when showDrafts is on', async () => {
  const cfg2 = { ...CFG, showDrafts: false }
  await teardown()
  try {
    const ctl = createApp({ config: cfg2, deps: stubs })
    const srv = http.createServer(ctl.app)
    await new Promise(r => srv.listen(0, r))
    const b = `http://127.0.0.1:${srv.address().port}`
    const sr = await fetch(`${b}/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'pw' }) })
    const cookie = `lens_session=${(sr.headers.get('set-cookie').match(/lens_session=([^;]+)/) ?? [])[1]}`
    const html = await (await fetch(`${b}/`, { headers: { Cookie: cookie } })).text()
    assert.match(html, /PnL-Dashboard/)
    assert.ok(!html.includes('Private-Draft'), 'drafts are hidden when showDrafts is false')
    ctl.close()
    await new Promise(r => { srv.closeAllConnections?.(); srv.close(() => r()) })
  } finally { await setup() }
})

test('a Lens with a newer toolkitVersion is refused with a clear message', async () => {
  const { cookie } = await signIn()
  const r = await get('/api/lens/Future', cookie)
  assert.equal(r.status, 417)
  const body = await r.json()
  assert.match(body.error, /needs toolkit version 5/)
  const page = await get('/lens/Future', cookie)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /can\S+t open here/)
  assert.ok(!html.includes('<div>hello lens</div>'), 'the incompatible Lens body is never shown')
})

test('idle sessions time out and are dropped', async () => {
  const { sid, cookie } = await signIn()
  const s = appCtl.store.get(sid)
  s.lastSeen = Date.now() - 2_000_000              // idle well beyond idleMinutes (30m)
  const dropped = appCtl.store.sweep()
  assert.equal(dropped, 1, 'the stale session is swept')
  assert.equal((await get('/api/lenses', cookie)).status, 401, 'the expired session no longer works')
})