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

// ── Home page: business processes, ordered steps, friendly titles ────────────
const { groupLenses, stepOf } = require('../lens-server')

test('home page groups Lenses by folder (no folder last) with numbered steps in order', () => {
  const g = groupLenses([
    { name: 'Command-Centre', title: '3 Results', folder: 'Target setting 2027' },
    { name: 'Target-Input', title: '1 Enter targets', folder: 'Target setting 2027' },
    { name: 'Approvals', title: '2 Approve targets', folder: 'Target setting 2027' },
    { name: 'Notes', title: 'Read me first', folder: 'Target setting 2027' },
    { name: 'Loose', folder: '' },
    { name: 'PnL', title: 'P&L dashboard', folder: 'Monthly reporting' },
  ])
  assert.deepEqual(g.map(x => x.folder), ['Monthly reporting', 'Target setting 2027', ''])
  assert.deepEqual(g[1].items.map(l => l.name), ['Target-Input', 'Approvals', 'Command-Centre', 'Notes'])
  assert.deepEqual(stepOf({ title: '1. Enter targets' }), { step: '1', label: 'Enter targets' })
  assert.deepEqual(stepOf({ name: 'Target-Input' }), { step: '', label: 'Target-Input' })
})

test('the home page shows titles and folders, never a raw cube or server name', async () => {
  await withApp(async ({ base, signin }) => {
    const c = cookieOf(await signin('admin', 'apple'))
    const home = await (await fetch(`${base}/`, { headers: { cookie: c } })).text()
    assert.match(home, /Target setting 2027/)
    assert.match(home, /<span class="step">1<\/span>/)
    assert.match(home, /<b>Enter targets<\/b>/)
    assert.ok(!home.includes('Lenses on S1'), 'no server name heading')
  }, { listLenses: async () => [{ name: 'Target-Input', title: '1 Enter targets', folder: 'Target setting 2027', status: 'published' }] })
})

// ── Home-page tiles: an icon on a colour, or the Lens's own image ────────────
test('Lens icon, colour and image are checked before they are stored', () => {
  const s = require('../core/lens_store')
  assert.equal(s.cleanIcon('target'), 'target')
  assert.throws(() => s.cleanIcon('skull'), /Unknown icon/)
  assert.equal(s.cleanColor('#0F766E'), '#0F766E')
  assert.throws(() => s.cleanColor('red; background:url(x)'), /#0f766e/)
  assert.equal(s.cleanImage(''), '')
  assert.ok(s.cleanImage('data:image/png;base64,iVBORw0KGgo='))
  assert.throws(() => s.cleanImage('javascript:alert(1)'), /PNG, JPEG, WebP or SVG/)
  assert.throws(() => s.cleanImage('data:text/html;base64,PGI+'), /PNG, JPEG, WebP or SVG/)
  assert.throws(() => s.cleanImage('data:image/png;base64,' + 'A'.repeat(300 * 1024)), /too large/)
})

test('the home page draws each Lens as a tile: its icon, or a guessed one, or its image', async () => {
  await withApp(async ({ base, signin }) => {
    const c = cookieOf(await signin('admin', 'apple'))
    const home = await (await fetch(`${base}/`, { headers: { cookie: c } })).text()
    assert.match(home, /<span class="tile" style="background:linear-gradient\(135deg, #7c3aed/)
    assert.match(home, /<span class="tile"><img src="data:image\/png;base64,iVBOR/)
    assert.equal((home.match(/<svg viewBox="0 0 24 24"/g) || []).length, 2, 'icon tiles for the two Lenses without an image')
  }, { listLenses: async () => [
    { name: 'A', title: 'Approve targets', status: 'published', icon: 'circle-check', color: '#7c3aed' },
    { name: 'B', title: 'Enter targets', status: 'published' },
    { name: 'C', title: 'Brand', status: 'published', image: 'data:image/png;base64,iVBORw0KGgo=' },
  ] })
})

test('every script on the home page parses (a template-literal escape slip once broke the hover preview)', async () => {
  const vm = require('node:vm')
  await withApp(async ({ base, signin }) => {
    const c = cookieOf(await signin('admin', 'apple'))
    const home = await (await fetch(`${base}/`, { headers: { cookie: c } })).text()
    const scripts = [...home.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
    assert.ok(scripts.length >= 2)
    for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code), code.slice(0, 80))
  }, { listLenses: async () => [{ name: 'Command-Centre', title: 'Command centre', status: 'published' }] })
})

// ── Lens access: config.access (TM1 groups) is enforced on every route ───────
test('a Lens limited to Finance is invisible and refused for others, open for Finance and ADMIN', async () => {
  const lenses = {
    Approvals: { name: 'Approvals', status: 'published', toolkitVersion: 1, html: '<meta name="lens-writes" content="Plan"><meta name="lens-runs" content="P"><p>approve</p>', config: { access: ['Finance'], cube: 'Plan' } },
    Open: { name: 'Open', status: 'published', toolkitVersion: 1, html: '<p>open</p>', config: {} },
  }
  const groupsOf = { east_mgr: ['Lens East'], finance_mgr: ['finance'], boss: ['ADMIN'] }
  let wrote = 0
  const deps = {
    probeAuthMethod: async () => ({ method: 'native' }),
    makeClientWithCredentials(server, creds) { return { _who: creds.username, _adapter: { closeSession() {} }, async get() { return { Name: creds.username } } } },
    groupsOf: async client => groupsOf[client._who] ?? [],
    listLenses: async () => Object.values(lenses).map(({ html, ...m }) => m),
    readLens: async (s, name) => { if (!lenses[name]) throw new Error('not found'); return lenses[name] },
    writeCells: async () => { wrote++; return { written: 1, changes: [] } },
    logLensWrite: () => {},
  }
  const { createApp } = require('../lens-server')
  const { app, close } = createApp({ config: { server: 'S1', port: 0, showDrafts: true, endSessionProcesses: [] }, deps })
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  const base = `http://127.0.0.1:${srv.address().port}`
  const as = async user => {
    const si = await fetch(`${base}/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: 'pw' }) })
    const cookie = (si.headers.get('set-cookie') || '').split(';')[0]
    const get = p => fetch(base + p, { headers: { cookie } })
    return {
      home: async () => (await get('/')).text(),
      list: async () => (await (await get('/api/lenses')).json()).map(l => l.name),
      page: async () => (await get('/lens/Approvals')).text(),
      frame: async () => { const r = await get('/lens-frame/Approvals'); return { status: r.status, text: await r.text() } },
      api: async () => (await get('/api/lens/Approvals')).status,
      write: async () => (await fetch(`${base}/api/lens/write-cells`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ lens: 'Approvals', cube: 'Plan', cells: [] }) })).status,
    }
  }
  try {
    const east = await as('east_mgr')
    assert.deepEqual(await east.list(), ['Open'])
    assert.ok(!(await east.home()).includes('/lens/Approvals'), 'not on the home page')
    assert.match(await east.page(), /not available to you/)
    assert.equal((await east.frame()).status, 404)
    assert.equal(await east.api(), 404)
    assert.equal(await east.write(), 400); assert.equal(wrote, 0, 'no write through a Lens you may not open')

    const fin = await as('finance_mgr')
    assert.deepEqual((await fin.list()).sort(), ['Approvals', 'Open'], 'group names match whatever their case')
    const fr = await fin.frame()
    assert.equal(fr.status, 200)
    assert.match(fr.text, /window\.__lensConfig = \{"access":\["Finance"\],"cube":"Plan"\}/, 'the config reaches the Lens')
    assert.equal(await (await as('boss')).api(), 200, 'ADMIN may open anything')
  } finally { srv.close(); close() }
})

// ── Personal themes: remembered per login, handed into Lenses ────────────────
test('each person\'s theme is remembered and reaches their Lenses — unless a Lens keeps its own look', async () => {
  const os = require('os'), path = require('path'), fs = require('fs')
  const prefsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lensprefs-')), 'p.json')
  await withApp(async ({ base, signin }) => {
    const c = cookieOf(await signin('admin', 'apple'))
    const post = body => fetch(`${base}/api/prefs`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify(body) })
    assert.deepEqual(await (await fetch(`${base}/api/prefs`, { headers: { cookie: c } })).json(), { mode: 'system', palette: 'teal' })
    assert.equal((await post({ mode: 'dark', palette: 'ocean' })).status, 200)
    assert.equal((await post({ palette: 'neon' })).status, 400, 'unknown themes refused')
    const home = await (await fetch(`${base}/`, { headers: { cookie: c } })).text()
    assert.match(home, /:root\{--app-bg:#0c1220/, 'the app\'s own pages follow it (ocean, dark)')
    assert.match(home, /data-mode="dark" class="on"/)
    assert.match(home, /data-pal="ocean" title="Ocean" class="sw on"/)
    const frame = await (await fetch(`${base}/lens-frame/Plain`, { headers: { cookie: c } })).text()
    assert.match(frame, /window\.__lensTheme = \{"mode":"dark","palette":"ocean"\}/)
    const fixed = await (await fetch(`${base}/lens-frame/Fixed`, { headers: { cookie: c } })).text()
    assert.match(fixed, /window\.__lensTheme = null/, 'theme: fixed keeps the Lens\'s own look')
    assert.deepEqual(JSON.parse(fs.readFileSync(prefsFile, 'utf8')), { 'S1::admin': { mode: 'dark', palette: 'ocean' } })
  }, {
    prefsFile,
    readLens: async (s, name) => ({ name, status: 'published', toolkitVersion: 1, html: '<p>x</p>', config: name === 'Fixed' ? { theme: 'fixed' } : {} }),
  })
})

test('whoami tells a Lens who is signed in and their TM1 groups', async () => {
  await withApp(async ({ base, signin }) => {
    const c = cookieOf(await signin('admin', 'apple'))
    assert.deepEqual(await (await fetch(`${base}/api/lens/whoami`, { headers: { cookie: c } })).json(), { user: 'admin', groups: ['Lens Finance'] })
  }, { groupsOf: async () => ['Lens Finance'] })
})
