'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), os = require('os'), path = require('path')
const { createLiveHub, colorFor } = require('../core/lens_live')
const { logLensWrite, logLensRun, readLensActivity } = require('../core/lens_activity_log')

// Working together: people in the same Lens + channel hear each other; events
// are stamped with the real user; size and rate are capped.
const inbox = () => { const got = []; const write = ev => got.push(ev); return { got, write } }

test('joining says hello with who is here; others hear the join and the leave', () => {
  const hub = createLiveHub()
  const a = inbox(), b = inbox()
  const ja = hub.join('Target-Input', 'store:101|Y2', 'east_mgr', a.write)
  hub.join('Target-Input', 'store:101|Y2', 'east_mgr2', b.write)
  assert.equal(a.got[0].type, 'hello'); assert.equal(a.got[0].you.user, 'east_mgr')
  assert.deepEqual(b.got[0].members.map(m => m.user).sort(), ['east_mgr', 'east_mgr2'])
  assert.equal(a.got[1].type, 'join'); assert.equal(a.got[1].member.user, 'east_mgr2')
  ja.leave()
  assert.deepEqual(b.got.at(-1), { type: 'leave', id: ja.id, user: 'east_mgr' })
  assert.equal(colorFor('east_mgr'), a.got[0].you.color, 'same person, same colour')
})

test('events reach only the same Lens and channel, stamped with the real sender', () => {
  const hub = createLiveHub()
  const a = inbox(), b = inbox(), other = inbox()
  const ja = hub.join('Target-Input', 'store:101|Y2', 'east_mgr', a.write)
  hub.join('Target-Input', 'store:101|Y2', 'east_mgr2', b.write)
  hub.join('Target-Input', 'store:401|Y2', 'canada_mgr', other.write)
  hub.publish('Target-Input', 'store:101|Y2', 'east_mgr', ja.id, { type: 'typing', account: '6100', month: 'Jan', value: 450, from: { user: 'finance_mgr' } })
  const ev = b.got.at(-1)
  assert.equal(ev.type, 'typing'); assert.equal(ev.value, 450)
  assert.equal(ev.from.user, 'east_mgr', 'a claimed sender is replaced by the real one')
  assert.ok(!a.got.some(e => e.type === 'typing'), 'not echoed to the sender')
  assert.ok(!other.got.some(e => e.type === 'typing'), 'another store never hears it')
})

test('refused: someone else\'s connection, unknown types, oversized and too-fast events', () => {
  const hub = createLiveHub({ perSecond: 3 })
  const ja = hub.join('L', 'c', 'east_mgr', () => {})
  assert.throws(() => hub.publish('L', 'c', 'canada_mgr', ja.id, { type: 'typing' }), /not connected/)
  assert.throws(() => hub.publish('L', 'c', 'east_mgr', ja.id, { type: 'run-anything' }), /unknown event/)
  assert.throws(() => hub.publish('L', 'c', 'east_mgr', ja.id, { type: 'typing', pad: 'x'.repeat(5000) }), /too large/)
  for (let i = 0; i < 3; i++) hub.publish('L', 'c', 'east_mgr', ja.id, { type: 'cursor' })
  assert.throws(() => hub.publish('L', 'c', 'east_mgr', ja.id, { type: 'cursor' }), /too many/)
})

test('history: one Lens, one slice, newest first — saves keep only the cells inside it', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lensact-')), 'a.jsonl')
  const at = (org, v) => ({ coordinates: { organization: org, Year: 'Y2', Account: '6100', Month: 'Jan' }, old: 0, value: v })
  logLensWrite({ server: 'S', app: 'lens', user: 'east_mgr', lens: 'Target-Input', cube: 'IS', changes: [at('101', 1), at('102', 2)] }, file)
  logLensWrite({ server: 'S', app: 'lens', user: 'canada_mgr', lens: 'Target-Input', cube: 'IS', changes: [at('401', 3)] }, file)
  logLensRun({ server: 'S', app: 'lens', user: 'east_mgr', lens: 'Target-Input', process: 'Lens Workflow Submit', params: { pOrg: '101', pYear: 'Y2' }, status: 'CompletedSuccessfully' }, file)
  logLensWrite({ server: 'OTHER', app: 'lens', user: 'x', lens: 'Target-Input', cube: 'IS', changes: [at('101', 9)] }, file)
  const h = readLensActivity({ server: 'S', lens: 'Target-Input', match: { organization: '101', Year: 'Y2' } }, file)
  assert.deepEqual(h.map(e => e.kind), ['run', 'write'])
  assert.deepEqual(readLensActivity({ server: 'S', lens: 'Target-Input', match: { organization: '101' }, skip: ['lens workflow submit'] }, file).map(e => e.kind), ['write'])
  assert.deepEqual(h[1].changes.map(c => c.coordinates.organization), ['101'])
})

// Through the Lens app: history refuses a slice the person can't see.
test('Lens app: history checks the slice as the user before returning anything', async () => {
  const { createApp } = require('../lens-server')
  const asked = []
  const deps = {
    probeAuthMethod: async () => ({ method: 'native' }),
    makeClientWithCredentials(server, creds) { return { _adapter: { closeSession() {} }, async get() { return { Name: creds.username } } } },
    execMdx: async (client, mdx) => { asked.push(mdx); if (mdx.includes('[401]')) throw new Error('member not found'); return {} },
    listLenses: async () => [],
    readLens: async (s, name) => ({ name, status: 'draft', toolkitVersion: 7, html: '<meta name="lens-writes" content="Income Statement">' }),
    readLensActivity: ({ match }) => [{ kind: 'write', match }],
  }
  const { app, close } = createApp({ config: { server: 'S1', port: 0, showDrafts: true, endSessionProcesses: [] }, deps })
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  const base = `http://127.0.0.1:${srv.address().port}`
  try {
    const si = await fetch(`${base}/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'east_mgr', password: 'pw' }) })
    const cookie = (si.headers.get('set-cookie') || '').split(';')[0]
    const hist = m => fetch(`${base}/api/lens/Target-Input/history?match=${encodeURIComponent(JSON.stringify(m))}`, { headers: { cookie } })
    const ok = await hist({ organization: '101' })
    assert.equal(ok.status, 200)
    assert.deepEqual((await ok.json())[0].match, { organization: '101' })
    const no = await hist({ organization: '401' })
    assert.equal(no.status, 400)
    assert.match((await no.json()).error, /can't see organization "401"/)
    assert.ok(asked.some(q => q.includes('FROM [Income Statement]')), 'checked against the Lens\'s own cube')
  } finally { srv.close(); close() }
})
