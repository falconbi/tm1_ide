'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { createApp } = require('../lens-server')

const LENSES = {
  Finance: { name: 'Finance', status: 'published', toolkitVersion: 1, html: '<p>finance</p>', config: { access: ['Finance'] } },
  Open:    { name: 'Open', status: 'published', toolkitVersion: 1, html: '<p>open</p>', config: {} },
}

function deps() {
  return {
    probeAuthMethod: async () => ({ method: 'native' }),
    makeClientWithCredentials(_server, creds) {
      return { _who: creds.username, async get() { return { Name: creds.username } } }
    },
    groupsOf: async client => client._who === 'finance_mgr' ? ['Finance'] : ['Lens East'],
    listLenses: async () => Object.values(LENSES).map(({ html, ...d }) => d),
    readLens: async (_server, name) => {
      if (!LENSES[name]) throw new Error('not found')
      return LENSES[name]
    },
    execMdx: async () => ({ value: 1 }),
    readCell: async () => 1,
    getMeta: async () => ({ cube: 'Plan' }),
    elementTree: async () => [],
  }
}

async function withApp(fn) {
  const ctl = createApp({ config: { server: 'S1', port: 0, showDrafts: false, endSessionProcesses: [] }, deps: deps() })
  const srv = http.createServer(ctl.app)
  await new Promise(r => srv.listen(0, r))
  const base = `http://127.0.0.1:${srv.address().port}`
  const signIn = async username => {
    const r = await fetch(`${base}/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'pw' }) })
    return (r.headers.get('set-cookie') || '').split(';')[0]
  }
  const call = async (cookie, method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  try { await fn({ signIn, call }) } finally {
    ctl.close()
    await new Promise(r => { srv.closeAllConnections?.(); srv.close(() => r()) })
  }
}

test('read bridge calls require the Lens and enforce its access list', async () => {
  await withApp(async ({ signIn, call }) => {
    const east = await signIn('east_mgr')
    const finance = await signIn('finance_mgr')

    for (const [method, path, body] of [
      ['POST', '/api/lens/exec-mdx', { lens: 'Finance', mdx: 'SELECT 1 ON 0 FROM [Plan]' }],
      ['POST', '/api/lens/read-cell', { lens: 'Finance', cube: 'Plan', coordinates: {} }],
      ['GET',  '/api/lens/meta?lens=Finance&cube=Plan'],
      ['GET',  '/api/lens/element-tree?lens=Finance&dimension=Account'],
    ]) {
      assert.equal((await call(east, method, path, body)).status, 403, `${method} ${path} must refuse a non-Finance reader`)
      assert.equal((await call(finance, method, path, body)).status, 200, `${method} ${path} must allow Finance`)
    }

    assert.equal((await call(east, 'POST', '/api/lens/exec-mdx', { mdx: 'x' })).status, 400, 'no lens name is a bad request')
  })
})
