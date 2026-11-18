'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wd-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wd-bare-'))
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

// In-memory change log.
const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

// Model-owned store stub: the change-set documents live in `records`.
const records = new Map()
require.cache[resolve('core/model-store')] = {
  id: resolve('core/model-store'), filename: resolve('core/model-store'), loaded: true,
  exports: {
    async isMigrated() { return true },
    async readDoc(_server, _area, name) { return records.get(name) ?? null },
    async writeDoc(_server, _area, name, data) { records.set(name, data); return data },
    async listDocs() { return [...records.keys()] },
  },
}

const gitStatePath = resolve('core/git-state')
let fakeBase = null
require.cache[gitStatePath] = { id: gitStatePath, filename: gitStatePath, loaded: true, exports: { lastDeployed: () => (fakeBase ? { lastDeployedCommit: fakeBase } : null), recordDeploy: async () => ({ ok: true }), load: () => ({}), FILE: '' } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))
const { markWontDeploy, unmarkWontDeploy } = require(path.join(__dirname, '..', 'core', 'change-set-service'))
const { buildRelease, ownerOf } = require(path.join(__dirname, '..', 'core', 'git-release'))

function closed(name, server, user = 'admin') {
  const s = cl.startSession(name, server, user)
  cl.closeSession(s.id, { user, tests: { passed: 1, total: 1, blocking: 0 } })
  // mirror what the close service writes to a model-owned server
  records.set(`${s.id}.json`, { id: s.id, name, server, user, closed_at: new Date().toISOString() })
  return cl.getSession(s.id)
}

test('marking won\'t deploy stores the reason and time; unmark clears all three', async () => {
  const s = closed('Proof re-run', 'WD-1')
  const marked = await markWontDeploy(s.id, { by: 'james', reason: 'proof only' })
  assert.equal(marked.wont_deploy_by, 'james')
  assert.equal(marked.wont_deploy_reason, 'proof only')
  assert.ok(marked.wont_deploy_at)
  const unmarked = await unmarkWontDeploy(s.id)
  assert.equal(unmarked.wont_deploy_at, null)
  assert.equal(unmarked.wont_deploy_by, null)
  assert.equal(unmarked.wont_deploy_reason, null)
})

test('the model record receives the won\'t-deploy fields too', async () => {
  const s = closed('Model proof', 'WD-2')
  await markWontDeploy(s.id, { by: 'james', reason: 'lab work' })
  const rec = records.get(`${s.id}.json`)
  assert.equal(rec.wont_deploy_by, 'james')
  assert.equal(rec.wont_deploy_reason, 'lab work')
  assert.ok(rec.wont_deploy_at)
})

test('an open change set cannot be marked, and a reason is required', async () => {
  const open = cl.startSession('Still open', 'WD-3', 'admin')
  await assert.rejects(() => markWontDeploy(open.id, { by: 'james', reason: 'x' }), e => e.code === 'OPEN_SET')
  const s = closed('No reason', 'WD-3')
  await assert.rejects(() => markWontDeploy(s.id, { by: 'james', reason: '  ' }), e => e.code === 'REASON_REQUIRED')
})

test('ownerOf skips a change set marked won\'t deploy (or covered)', () => {
  const entries = [{ object_type: 'subset', object_name: 'Cities', detail: 'WFP Position' }]
  assert.equal(ownerOf([{ name: 'Proof', user: 'x', wont_deploy_at: 'now', entries }], { type: 'subset', name: 'Cities', parent: 'WFP Position' }), null)
  assert.equal(ownerOf([{ name: 'Covered', user: 'x', covered_by: 'c1', entries }], { type: 'subset', name: 'Cities', parent: 'WFP Position' }), null)
})

const HIER = 'dimensions/WFP Position.hierarchies/By Location.json'
const CITIES = 'dimensions/WFP Position.hierarchies/By Location.subsets/Cities.json'
function setupRepo() {
  const bare = bareInit(BARE())
  const w = W()
  g(w, 'init', '-q'); g(w, 'remote', 'add', 'origin', bare)
  write(w, 'cubes/Base.rules', '# base\n[] = N:0;\n')
  const base = commitAll(w, 'base')
  write(w, HIER, JSON.stringify({ Name: 'By Location', 'Subsets@Code.links': ['By Location.subsets/Cities.json'] }))
  write(w, CITIES, JSON.stringify({ Name: 'Cities', Expression: '{[WFP Position].[WFP Position].[Sydney]}' }))
  const devCommit = commitAll(w, 'dev')
  g(w, 'branch', '-M', 'dev'); g(w, 'push', '-q', 'origin', 'dev:dev')
  return { bare, base, devCommit, w }
}

test('a won\'t-deploy set does not own a subset a release needs', async () => {
  const repo = setupRepo()
  try {
    fakeBase = repo.base
    const proof = closed('WFP_Lab — test model, never deploy', 'WD-LINK', 'samtm1')
    cl.writeLog({ server: 'WD-LINK', action: 'SUBSET_SAVED', objectType: 'subset', objectName: 'Cities', detail: 'WFP Position', user: 'samtm1' })
    await markWontDeploy(proof.id, { by: 'james', reason: 'lab work' })
    const a = cl.startSession('Links', 'WD-LINK', 'admin')
    cl.setSessionCommit(a.id, repo.devCommit)
    cl.writeLog({ server: 'WD-LINK', action: 'ELEMENT_ADDED', objectType: 'dimension', objectName: 'WFP Position', detail: 'Sydney', user: 'admin' })
    const r = await buildRelease(a, 'WD-T', { token: 'x', gitUser: 't', repoUrl: repo.bare })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.ok(r.addedAsDependency.some(d => d.file === CITIES), 'the subset comes in as a dependency, not a refusal')
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})

// ── Routes ───────────────────────────────────────────────────────────────────

function recorder() {
  const res = { statusCode: 200, body: null }
  res.status = code => { res.statusCode = code; return res }
  res.json = body => { res.body = body; return res }
  return res
}

test('a non-owner non-admin cannot mark a change set won\'t deploy', async () => {
  const handlers = {}
  const app = { post: (p, f) => { handlers['POST ' + p] = f }, get: () => {}, delete: (p, f) => { handlers['DELETE ' + p] = f }, patch: () => {} }
  const { register } = require(path.join(__dirname, '..', 'routes', 'changesets'))
  register(app, {
    cl, gateReadOnly: () => true, gateWrite: () => true,
    createStartSessionRoute: () => () => {},
    makeClient: () => ({}), mayManageSession: async () => false, odataKey: s => s,
  })
  const s = closed('Not mine', 'WD-403', 'someone-else')
  const res = recorder()
  await handlers['POST /api/sessions/:id/wont-deploy']({ params: { id: s.id }, body: { reason: 'x' }, user: 'jdlove' }, res)
  assert.equal(res.statusCode, 403)
})

test('releasing a change set marked won\'t deploy is refused', async () => {
  const handlers = {}
  const app = { post: (p, f) => { handlers['POST ' + p] = f }, get: () => {}, delete: () => {} }
  const { register } = require(path.join(__dirname, '..', 'routes', 'deploy'))
  register(app, {
    _GI: () => ({ user: () => 't' }), _GITOK: () => 't', cl,
    deployLoadBaseline: () => null, deploySeed: async () => ({}),
    fail: (r, e) => r.status(500).json({ error: e.message }),
    fs, gateReadOnly: () => true, gitSecrets: { tokenSource: () => 'none' },
    listServers: () => [], makeClient: () => ({}), path,
  })
  const s = closed('Proof', 'WD-REL')
  await markWontDeploy(s.id, { by: 'james', reason: 'proof' })
  const res = recorder()
  await handlers['POST /api/deploy/git/release']({ body: { target: 'WD-T', session: s.id }, user: 'james', ideToken: 'x' }, res)
  assert.equal(res.statusCode, 409)
  assert.match(res.body.error, /retired as a phantom/)
})

test('an older closed set with no model record is backfilled before it is marked', async () => {
  const s = cl.startSession('Old local proof', 'WD-4', 'admin')
  cl.closeSession(s.id, { user: 'admin', tests: { passed: 1, total: 1, blocking: 0 } })
  records.delete(`${s.id}.json`)
  const marked = await markWontDeploy(s.id, { by: 'james', reason: 'older local set' })
  assert.equal(marked.wont_deploy_reason, 'older local set')
  assert.equal(records.get(`${s.id}.json`).wont_deploy_reason, 'older local set')
})
