'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { createApp } = require('../lens-server')
const { visibleTo } = require('../core/lens-store')

const DOCS = {
  Public:  { name: 'Public', status: 'published', toolkitVersion: 1, html: '<p>public</p>', config: {} },
  Draft:   { name: 'Draft', status: 'draft', owner: 'author', createdBy: 'author', reviewers: ['reviewer', 'WFP HR'], toolkitVersion: 1, html: '<p>draft</p>', config: {} },
  OtherDraft: { name: 'OtherDraft', status: 'draft', owner: 'someone-else', createdBy: 'someone-else', toolkitVersion: 1, html: '<p>other</p>', config: {} },
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

async function withApp(fn, config = {}) {
  const ctl = createApp({ config: { server: 'S1', port: 0, showDrafts: false, endSessionProcesses: [], ...config }, deps: deps() })
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

test('visibleTo applies status, access, author/reviewer and admin in one place', () => {
  assert.equal(visibleTo(DOCS.Public, [], { showDrafts: false }), true)
  assert.equal(visibleTo(DOCS.Draft, [], { showDrafts: false, user: 'author' }), false, 'showDrafts off hides drafts even from the author')
  assert.equal(visibleTo(DOCS.Draft, [], { showDrafts: true }), false, 'no signed-in identity sees no draft')
  assert.equal(visibleTo(DOCS.Draft, [], { showDrafts: true, user: 'author' }), true)
  assert.equal(visibleTo(DOCS.Draft, [], { showDrafts: true, user: 'reviewer' }), true)
  assert.equal(visibleTo(DOCS.Draft, [], { showDrafts: true, user: 'someone' }), false)
  assert.equal(visibleTo(DOCS.Draft, ['WFP HR'], { showDrafts: true, user: 'hr_user' }), true, 'a reviewer group works too')
  assert.equal(visibleTo(DOCS.Draft, ['ADMIN'], { showDrafts: true, user: 'boss' }), true, 'a TM1 admin may review any draft')
  assert.equal(visibleTo(DOCS.Draft, [], { showDrafts: true, user: 'admin' }), true)
  assert.equal(visibleTo(DOCS.Finance, ['WFP HR'], { showDrafts: true, user: 'hr_user' }), false)
  assert.equal(visibleTo(DOCS.Finance, ['WFP Finance'], { showDrafts: true, user: 'fin' }), true)
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

test('with showDrafts on, a draft is listed and opened only for its author and reviewers', async () => {
  await withApp(async ({ base, cookie }) => {
    const list = await (await fetch(`${base}/api/lenses`, { headers: { cookie } })).json()
    assert.deepEqual(list.map(l => l.name).sort(), ['Draft', 'Public'], 'hr_user is a reviewer (WFP HR) of Draft, not of OtherDraft')

    assert.equal((await fetch(`${base}/lens/Draft`, { headers: { cookie }, redirect: 'manual' })).status, 200)
    assert.equal((await fetch(`${base}/lens/OtherDraft`, { headers: { cookie }, redirect: 'manual' })).status, 404, 'a draft the person may not review is not openable')
  }, { showDrafts: true })
})
