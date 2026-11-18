'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cu-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cu-bare-'))
function bareInit(p) { execFileSync('git', ['init', '-q', '--bare', p]); return p }
function write(w, file, text) {
  const f = path.join(w, file)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, text)
}
function commitAll(w, msg) {
  g(w, 'add', '-A')
  g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg)
  return g(w, 'rev-parse', 'HEAD').trim()
}

const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

// Keep the close sequence local (no model writes) in this test.
require.cache[resolve('core/model-store')] = {
  id: resolve('core/model-store'), filename: resolve('core/model-store'), loaded: true,
  exports: { async isMigrated() { return false }, async readDoc() { return null }, async writeDoc(_s, _a, _n, d) { return d }, async listDocs() { return [] } },
}

const gitStatePath = resolve('core/git-state')
let fakeBase = null
require.cache[gitStatePath] = { id: gitStatePath, filename: gitStatePath, loaded: true, exports: { lastDeployed: () => (fakeBase ? { lastDeployedCommit: fakeBase } : null), recordDeploy: async () => ({ ok: true }), load: () => ({}), FILE: '' } }

let sourceStatus = { URL: 'REPO', LocalCommit: { ID: 'C0' } }
const fakeClient = {
  async post(route) {
    if (route === 'GitStatus') return sourceStatus
    return {}
  },
  async get() { return { value: [] } },
}
const arReal = require(resolve('core/adapter-registry'))
require.cache[resolve('core/adapter-registry')] = {
  id: resolve('core/adapter-registry'), filename: resolve('core/adapter-registry'), loaded: true,
  exports: { ...arReal, makeClient: () => fakeClient },
}

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))
const { buildRelease, linkClosure } = require(path.join(__dirname, '..', 'core', 'git-release'))
const { startCatchUp, sourcePushedCommit, sentenceFor, catchUpName } = require(path.join(__dirname, '..', 'core', 'git-catchup'))

function setupRepo({ brokenLink = false } = {}) {
  const bare = bareInit(BARE())
  const w = W()
  g(w, 'init', '-q'); g(w, 'remote', 'add', 'origin', bare)
  write(w, 'cubes/A.rules', '# base A\n[] = N:1;\n')
  write(w, 'cubes/B.rules', '# base B\n[] = N:2;\n')
  const base = commitAll(w, 'base')
  write(w, 'cubes/A.rules', '# dev A\n[] = N:10;\n')
  write(w, 'cubes/B.rules', '# dev B\n[] = N:20;\n')
  if (brokenLink) {
    write(w, 'dimensions/WFP Position.hierarchies/By Location.json', JSON.stringify({ Name: 'By Location', 'Subsets@Code.links': ['By Location.subsets/Ghost.json'] }))
  }
  const devCommit = commitAll(w, 'dev')
  g(w, 'branch', '-M', 'dev'); g(w, 'push', '-q', 'origin', 'dev:dev')
  return { bare, base, devCommit, w }
}

function catchSession(server, devCommit) {
  const s = cl.startSession(catchUpName(server, 'TG'), server, 'admin', 'catch-up')
  cl.setSessionCommit(s.id, devCommit)
  return cl.getSession(s.id)
}

test('a catch-up includes every changed file, owned and unowned', async () => {
  const repo = setupRepo()
  try {
    fakeBase = repo.base
    const catchSet = catchSession('DEV-CU-A', repo.devCommit)
    // Two ordinary change sets own the two changed rules — a catch-up ignores both.
    const a = cl.startSession('Set A', 'DEV-CU-A', 'james')
    cl.writeLog({ server: 'DEV-CU-A', action: 'RULES_SAVED', objectType: 'rules', objectName: 'A', user: 'james' })
    cl.closeSession(a.id, { user: 'james' })
    const b = cl.startSession('Set B', 'DEV-CU-A', 'sam')
    cl.writeLog({ server: 'DEV-CU-A', action: 'RULES_SAVED', objectType: 'rules', objectName: 'B', user: 'sam' })

    const r = await buildRelease(catchSet, 'TG', { token: 'x', gitUser: 't', repoUrl: repo.bare, catchUp: true })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.catchUp, true)
    const names = r.included.map(i => `${i.type}:${i.name}`).sort()
    assert.deepEqual(names, ['cube:A', 'cube:B'])
    assert.deepEqual(r.excluded, [], 'nothing is left on DEV in a catch-up')
    assert.deepEqual(r.coveredSets.map(s => s.name), ['Set A'])
    assert.deepEqual(r.openSets.map(s => s.name), ['Set B'], 'an open set is listed as partly shipped, never covered')
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})

test('a catch-up still refuses a broken link', async () => {
  const repo = setupRepo({ brokenLink: true })
  try {
    fakeBase = repo.base
    const s = catchSession('DEV-CU-B', repo.devCommit)
    const r = await buildRelease(s, 'TG', { token: 'x', gitUser: 't', repoUrl: repo.bare, catchUp: true })
    assert.equal(r.ok, false)
    assert.equal(r.refused, true)
    assert.match(r.error, /does not exist on DEV/)
    assert.match(r.error, /Ghost\.json/)
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})

test('a won\'t-deploy set is not previewed as covered', async () => {
  const repo = setupRepo()
  try {
    fakeBase = repo.base
    const s = catchSession('DEV-CU-C', repo.devCommit)
    const proof = cl.startSession('WFP_Lab — test model, never deploy', 'DEV-CU-C', 'james')
    cl.writeLog({ server: 'DEV-CU-C', action: 'RULES_SAVED', objectType: 'rules', objectName: 'A', user: 'james' })
    cl.closeSession(proof.id, { user: 'james' })
    cl.markSessionWontDeploy(proof.id, { by: 'james', reason: 'lab work' })
    const r = await buildRelease(s, 'TG', { token: 'x', gitUser: 't', repoUrl: repo.bare, catchUp: true })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.deepEqual(r.coveredSets, [])
    assert.deepEqual(r.openSets, [])
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})

test('sourcePushedCommit refuses a source with no pushed commit or pending changes', () => {
  assert.match(sourcePushedCommit({}).error, /Commit DEV first/)
  assert.match(sourcePushedCommit({ LocalCommit: { ID: 'C1' }, HasLocalChanges: true }).error, /not pushed/)
  assert.match(sourcePushedCommit({ LocalCommit: { ID: 'C1' }, Changes: ['x'] }).error, /not pushed/)
  assert.deepEqual(sourcePushedCommit({ LocalCommit: { ID: 'C1' } }), { ok: true, commit: 'C1' })
})

test('starting a catch-up creates a closed, empty kind=catch-up session', async () => {
  sourceStatus = { URL: 'REPO', LocalCommit: { ID: 'abc123' } }
  fakeBase = 'base1'
  const r = await startCatchUp({ source: 'DEV-CU-D', target: 'TG', confirm: sentenceFor('DEV-CU-D', 'TG'), user: 'james', token: 'x', gitUser: 't' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.session.kind, 'catch-up')
  assert.ok(r.session.closed_at)
  assert.equal(r.session.commit_ref, 'abc123')
  assert.equal(r.session.name, catchUpName('DEV-CU-D', 'TG'))
  assert.match(r.session.name, /^Catch-up: TG level with DEV-CU-D \(\d{4}-\d{2}-\d{2}\)$/)
  assert.deepEqual(cl.getSessionLog(r.session.id), [], 'a catch-up has no log entries')
})

test('starting a catch-up refuses a wrong sentence', async () => {
  sourceStatus = { URL: 'REPO', LocalCommit: { ID: 'abc123' } }
  fakeBase = 'base1'
  const r = await startCatchUp({ source: 'DEV-CU-E', target: 'TG', confirm: 'yes', user: 'james', token: 'x', gitUser: 't' })
  assert.equal(r.refused, true)
  assert.match(r.error, /Type exactly: I understand this brings TG level with DEV-CU-E/)
})

// ── Routes ───────────────────────────────────────────────────────────────────

function recorder() {
  const res = { statusCode: 200, body: null }
  res.status = code => { res.statusCode = code; return res }
  res.json = body => { res.body = body; return res }
  return res
}
function routeApp(admin) {
  const handlers = {}
  const app = { post: (p, f) => { handlers['POST ' + p] = f }, get: (p, f) => { handlers['GET ' + p] = f }, delete: () => {} }
  const { register } = require(path.join(__dirname, '..', 'routes', 'deploy'))
  register(app, {
    _GI: () => ({ user: () => 't' }), _GITOK: () => 't', cl,
    deployLoadBaseline: () => null, deploySeed: async () => ({}),
    fail: (r, e) => r.status(500).json({ error: e.message }),
    fs, gateReadOnly: () => true, gitSecrets: { tokenSource: () => 'none' },
    listServers: () => ['TG', 'DEV-CU-R'], makeClient: () => fakeClient, path,
    requireTm1Admin: async (_req, res) => { if (admin) return true; res.status(403).json({ error: 'TM1 Admin group required' }); return false },
  })
  return handlers
}

test('the catch-up route refuses a non-admin with 403', async () => {
  const handlers = routeApp(false)
  const res = recorder()
  await handlers['POST /api/deploy/git/catch-up']({ body: { source: 'DEV-CU-R', target: 'TG', confirm: 'x' }, user: 'james', ideToken: 'x' }, res)
  assert.equal(res.statusCode, 403)
})

test('the catch-up route refuses unpushed DEV', async () => {
  const handlers = routeApp(true)
  fakeBase = 'base1'
  sourceStatus = { URL: 'REPO', LocalCommit: { ID: 'abc123' }, HasLocalChanges: true }
  const res = recorder()
  await handlers['POST /api/deploy/git/catch-up']({ body: { source: 'DEV-CU-R', target: 'TG', confirm: sentenceFor('DEV-CU-R', 'TG') }, user: 'james', ideToken: 'x' }, res)
  assert.equal(res.statusCode, 409)
  assert.match(res.body.error, /Commit DEV first/)
})

test('the catch-up targets route lists only targets with a recorded deploy', async () => {
  const handlers = routeApp(true)
  const prev = fakeBase
  fakeBase = 'base1'
  const res = recorder()
  await handlers['GET /api/deploy/git/catch-up/targets']({ query: { source: 'DEV-CU-R' }, user: 'james', ideToken: 'x' }, res)
  fakeBase = prev
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.targets.map(t => t.target), ['TG'])
})
