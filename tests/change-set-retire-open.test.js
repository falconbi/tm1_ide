'use strict'
// Fix 11 — retire an open change set, and Close from the row menu.
// Retire must close + retire WITHOUT running tests or writing DEV into `dev`;
// Close must run the same close as "Tests & close".
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, o) => { const r = resolve(rel); require.cache[r] = { id: r, filename: r, loaded: true, exports: o } }

// In-memory change log.
const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

// Unmigrated model store: local log is the truth, nothing is written to TM1.
const written = []
stub('core/model-store', {
  async isMigrated() { return false },
  async readDoc() { return null },
  async writeDoc(_s, _a, name, data) { written.push({ name, data }); return data },
  async listDocs() { return [] },
})

// Tests must NOT run when retiring an open set.
let testsRan = 0
stub('core/assertions', {
  async run() { testsRan++; return { passed: 1, total: 1, results: [] } },
})

// Close-menu path: preCloseCheck/finalizeDevClose are the "Tests & close" close.
let preCloseRan = 0
let finalizeRan = 0
stub('core/close-check', {
  async preCloseCheck() { preCloseRan++; return { ok: true } },
  async finalizeDevClose() { finalizeRan++; return { ok: true, commit: 'abc123' } },
})
stub('core/git-secrets', { getToken: () => 'token' })
stub('core/git-identity', { user: () => 't' })

const cl = require(resolve('core/change-log'))
const { register } = require(resolve('routes/changesets'))

function recorder() {
  const res = { statusCode: 200, body: null }
  res.status = code => { res.statusCode = code; return res }
  res.json = body => { res.body = body; return res }
  return res
}

function handlers() {
  const h = {}
  const app = { post: (p, f) => { h['POST ' + p] = f }, get: () => {}, patch: () => {}, delete: () => {} }
  register(app, {
    cl,
    createStartSessionRoute: () => (() => {}),
    gateReadOnly: () => true,
    gateWrite: () => true,
    makeClient: () => ({}),
    mayManageSession: async () => true,
    odataKey: s => s,
  })
  return h
}

test('retiring an open set closes + retires it, runs no tests, writes no dev branch', async () => {
  testsRan = 0; preCloseRan = 0; finalizeRan = 0
  const s = cl.startSession('Abandoned work', 'RET-1', 'james')
  const res = recorder()
  await handlers()['POST /api/sessions/:id/retire']({ params: { id: s.id }, user: 'james', body: {} }, res)

  assert.equal(res.statusCode, 200)
  assert.ok(res.body.closed_at, 'the set is closed')
  assert.ok(res.body.wont_deploy_at, 'the set is retired')
  assert.equal(res.body.close_tests, null, 'no tests snapshot')
  assert.equal(testsRan, 0, 'retire never runs tests')
  assert.equal(preCloseRan, 0, 'retire never runs the close checks')
  assert.equal(finalizeRan, 0, 'retire never writes DEV into dev')
})

test('Close from the menu runs the same close as Tests & close', async () => {
  testsRan = 0; preCloseRan = 0; finalizeRan = 0
  const s = cl.startSession('Close from menu', 'RET-2', 'james')
  const res = recorder()
  await handlers()['POST /api/sessions/close']({ body: { id: s.id }, user: 'james' }, res)

  assert.equal(res.statusCode, 200)
  assert.ok(res.body.closed_at)
  assert.equal(JSON.parse(res.body.close_tests).passed, 1)
  assert.equal(testsRan, 1, 'close runs the tests')
  assert.equal(preCloseRan, 1, 'close runs the close checks')
  assert.equal(finalizeRan, 1, 'close writes DEV into dev')
})
