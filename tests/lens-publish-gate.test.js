'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { createApp } = require('../lens-server')
const { visibleTo } = require('../core/lens_store')

const DOCS = {
  Public:  { name: 'Public', status: 'published', toolkitVersion: 1, html: '<p>public</p>', config: {} },
  Draft:   { name: 'Draft', status: 'draft', toolkitVersion: 1, html: '<p>draft</p>', config: {} },
  Finance: { name: 'Finance', status: 'published', toolkitVersion: 1, html: '<p>finance</p>', config: { access: ['WFP Finance'] } },
}

function deps() {
  return {
    probeAuthMethod: async () => ({ method: 'native' }),
    makeClientWithCredentials: () => ({ async get() { return { Name: 'hr_user' } } }),
    groupsOf: async () => ['WFP HR'],
    listLenses: async () => Object.values(DOCS).map(({ html, ...d }) => d),
    readLens: async (_server, name) => {
      const doc = DOCS[name]
      if (!doc) throw new Error(`Lens "${name}" not found`)
      return doc
    },
  }
}

async function withApp(fn) {
  const ctl = createApp({ config: { server: 'S1', port: 0, showDrafts: false, endSessionProcesses: [] }, deps: deps() })
  const srv = http.createServer(ctl.app)
  await new Promise(r => srv.listen(0, r))
  const base = `http://127.0.0.1:${srv.address().port}`
  try {
    const r = await fetch(`${base}/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'hr_user', password: 'pw' }) })
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
    await fn({ base, cookie })
  } finally {
    ctl.close()
    await new Promise(r => { srv.closeAllConnections?.(); srv.close(() => r()) })
  }
}

test('visibleTo applies status and group access in one place', () => {
  assert.equal(visibleTo(DOCS.Public, [], { showDrafts: false }), true)
  assert.equal(visibleTo(DOCS.Draft, [], { showDrafts: false }), false)
  assert.equal(visibleTo(DOCS.Draft, [], { showDrafts: true }), true)
  assert.equal(visibleTo(DOCS.Finance, ['WFP HR'], { showDrafts: true }), false)
  assert.equal(visibleTo(DOCS.Finance, ['WFP Finance'], { showDrafts: true }), true)
})

test('with showDrafts off, a draft is absent from lists and refused by every open route', async () => {
  await withApp(async ({ base, cookie }) => {
    const list = await (await fetch(`${base}/api/lenses`, { headers: { cookie } })).json()
    assert.deepEqual(list.map(l => l.name), ['Public'], 'draft and restricted Lenses are not listed')

    const lensList = await (await fetch(`${base}/api/lens/lenses`, { headers: { cookie } })).json()
    assert.deepEqual(lensList.map(l => l.name), ['Public'])

    for (const url of ['/lens/Draft', '/lens-frame/Draft', '/api/lens/Draft', '/lens/Finance', '/api/lens/Finance']) {
      assert.equal((await fetch(base + url, { headers: { cookie }, redirect: 'manual' })).status, 404, url)
    }
    assert.equal((await fetch(`${base}/lens/Public`, { headers: { cookie } })).status, 200)
    assert.equal((await fetch(`${base}/api/lens/Public`, { headers: { cookie } })).status, 200)
  })
})
