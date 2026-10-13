'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createApp } = require('../lens-server')

// Security fixes for the Lens app sign-in and frame. TM1 is a stub that accepts
// only the password "apple"; each test drives the real express app over HTTP.
async function withApp(fn, depsOverride = {}) {
  const calls = { signIn: 0, closed: 0 }
  const deps = {
    probeAuthMethod: async () => ({ method: 'native' }),
    makeClientWithCredentials(server, creds) {
      calls.signIn++
      return {
        _creds: creds,
        _adapter: { closeSession() { calls.closed++ } },
        async get() { if (creds.password !== 'apple') { const e = new Error('401'); e.response = { status: 401 }; throw e } return { Name: creds.username } },
      }
    },
    execMdx: async (client) => ({ ranAs: client._creds.username, pw: client._creds.password }),
    listLenses: async () => [],
    readLens: async (s, name) => ({ name, toolkitVersion: 1, html: '<p>lens</p>' }),
    ...depsOverride,
  }
  const { app, close } = createApp({ config: { server: 'S1', port: 0, showDrafts: true, endSessionProcesses: [] }, deps })
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  const base = `http://127.0.0.1:${srv.address().port}`
  const signin = (username, password) => fetch(`${base}/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  try { await fn({ base, signin, calls }) } finally { srv.close(); close() }
}
const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0]

test('a second sign-in with a WRONG password is refused while the user is signed in', async () => {
  await withApp(async ({ signin }) => {
    assert.equal((await signin('admin', 'apple')).status, 200)
    const r = await signin('admin', 'WRONG')
    assert.equal(r.status, 403)
    assert.equal(cookieOf(r), '', 'no session cookie for a wrong password')
  })
})

test('a second sign-in with the right password shares the one TM1 session and closes the check session', async () => {
  await withApp(async ({ base, signin, calls }) => {
    const a = await signin('admin', 'apple'); const b = await signin('admin', 'apple')
    assert.equal(a.status, 200); assert.equal(b.status, 200)
    assert.equal(calls.signIn, 2, 'password checked with TM1 both times')
    assert.equal(calls.closed, 1, 'the extra check session was closed')
    const q = await fetch(`${base}/api/lens/exec-mdx`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookieOf(b) }, body: JSON.stringify({ mdx: 'x' }) })
    assert.equal((await q.json()).pw, 'apple', 'queries run on the verified session')
  })
})

test('after 2 rejected passwords the username is paused — TM1 is not asked a 3rd time', async () => {
  await withApp(async ({ signin, calls }) => {
    assert.equal((await signin('jdlove', 'x1')).status, 403)
    assert.equal((await signin('jdlove', 'x2')).status, 403)
    const before = calls.signIn
    const r = await signin('jdlove', 'apple')
    assert.equal(r.status, 429)
    assert.match((await r.json()).error, /Too many failed sign-ins for "jdlove"/)
    assert.equal(calls.signIn, before, 'no 3rd attempt reached TM1')
    assert.equal((await signin('admin', 'apple')).status, 200, 'other users are not affected')
  })
})

test('the per-address limit refuses a flood of sign-ins', async () => {
  await withApp(async ({ signin }) => {
    let last
    for (let i = 0; i < 11; i++) last = await signin('user' + i, 'nope')
    assert.equal(last.status, 429)
  })
})

test('the Lens frame is sandboxed by its own security header (sealed even when opened directly)', async () => {
  await withApp(async ({ base, signin }) => {
    const c = cookieOf(await signin('admin', 'apple'))
    const r = await fetch(`${base}/lens-frame/PnL-Dashboard`, { headers: { cookie: c } })
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-security-policy'), /^sandbox allow-scripts;/)
    assert.match(r.headers.get('content-security-policy'), /connect-src 'none'/)
  })
})

test('sign out from the page returns to sign-in; a script asking for JSON gets JSON', async () => {
  await withApp(async ({ base, signin }) => {
    const c1 = cookieOf(await signin('admin', 'apple'))
    const page = await fetch(`${base}/auth/signout`, { method: 'POST', headers: { cookie: c1, accept: 'text/html' }, redirect: 'manual' })
    assert.equal(page.status, 303)
    assert.equal(page.headers.get('location'), '/signin')
    const c2 = cookieOf(await signin('admin', 'apple'))
    const api = await fetch(`${base}/auth/signout`, { method: 'POST', headers: { cookie: c2, accept: 'application/json' } })
    assert.deepEqual(await api.json(), { ok: true })
  })
})

test('the sign-in page only says "TM1 rejected the login" when TM1 actually rejected it', async () => {
  await withApp(async ({ base }) => {
    const html = await (await fetch(`${base}/signin`)).text()
    assert.match(html, /o\.d\.rejected === true \? 'TM1 rejected the login/)
    assert.doesNotMatch(html, /o\.d\.error \|\| o\.d\.rejected === true \?/)
  })
})

test('every page says who is signed in, next to Sign out', async () => {
  await withApp(async ({ base, signin }) => {
    const c = cookieOf(await signin('admin', 'apple'))
    const home = await (await fetch(`${base}/`, { headers: { cookie: c } })).text()
    assert.match(home, /Signed in as <b[^>]*>admin<\/b>/)
    const lens = await (await fetch(`${base}/lens/PnL-Dashboard`, { headers: { cookie: c } })).text()
    assert.match(lens, /Signed in as <b[^>]*>admin<\/b>/)
  })
})
