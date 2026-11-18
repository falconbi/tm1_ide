'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cov-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cov-bare-'))
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
const { markCoveredAfterDeploy } = require(path.join(__dirname, '..', 'core', 'change-set-service'))
const { buildRelease, ownerOf } = require(path.join(__dirname, '..', 'core', 'git-release'))

function closed(name, server, user = 'admin') {
  const s = cl.startSession(name, server, user)
  cl.closeSession(s.id, { user })
  records.set(`${s.id}.json`, { id: s.id, name, server, user, closed_at: new Date().toISOString() })
  return cl.getSession(s.id)
}
function catchUp(server, coveredIds) {
  const s = cl.startSession(`Catch-up: TG level with ${server} (2026-11-18)`, server, 'james', 'catch-up')
  cl.setSessionRelease(s.id, 'rel-commit', 'TG', { coveredSets: coveredIds })
  return cl.getSession(s.id)
}

test('a successful catch-up covers closed sets only — never an open set', async () => {
  const closedSet = closed('Covered set', 'COV-1')
  const openSet = cl.startSession('Still open', 'COV-1', 'sam')
  const proof = closed('Proof', 'COV-1')
  cl.markSessionWontDeploy(proof.id, { by: 'james', reason: 'lab work' })
  const cu = catchUp('COV-1', [closedSet.id, openSet.id, proof.id])

  const marked = await markCoveredAfterDeploy(cu.id)
  assert.deepEqual(marked, [closedSet.id])

  const after = cl.getSession(closedSet.id)
  assert.equal(after.covered_by, cu.id)
  assert.ok(after.covered_at)
  assert.equal(cl.getSession(openSet.id).covered_by, null, 'an open set is never covered')
  assert.equal(cl.getSession(proof.id).covered_by, null, "a won't-deploy set is never covered")
  assert.equal(records.get(`${closedSet.id}.json`).covered_by, cu.id, 'the model record carries it too')
})

test('a non-catch-up session covers nothing', async () => {
  const s = closed('Ordinary', 'COV-2')
  const cu = catchUp('COV-2', [s.id])
  const ordinary = cl.getSession(cl.startSession('Normal close', 'COV-2', 'admin').id)
  const marked = await markCoveredAfterDeploy(ordinary.id)
  assert.deepEqual(marked, [])
  assert.equal(cl.getSession(s.id).covered_by, null)
  assert.ok(cu)
})

test('ownerOf skips a covered set, so it no longer blocks a release', () => {
  const entries = [{ object_type: 'subset', object_name: 'Cities', detail: 'WFP Position' }]
  assert.equal(ownerOf([{ name: 'Covered', covered_by: 'cu1', entries }], { type: 'subset', name: 'Cities', parent: 'WFP Position' }), null)
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

test('a covered set no longer blocks a release that needs its object', async () => {
  const repo = setupRepo()
  try {
    fakeBase = repo.base
    const owner = closed('Old owner', 'COV-LINK', 'sam')
    cl.writeLog({ server: 'COV-LINK', action: 'SUBSET_SAVED', objectType: 'subset', objectName: 'Cities', detail: 'WFP Position', user: 'sam' })
    cl.markSessionCovered(owner.id, { by: 'cu1' })
    const a = cl.startSession('Links', 'COV-LINK', 'admin')
    cl.setSessionCommit(a.id, repo.devCommit)
    cl.writeLog({ server: 'COV-LINK', action: 'ELEMENT_ADDED', objectType: 'dimension', objectName: 'WFP Position', detail: 'Sydney', user: 'admin' })
    const r = await buildRelease(a, 'COV-T', { token: 'x', gitUser: 't', repoUrl: repo.bare })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.ok(r.addedAsDependency.some(d => d.file === CITIES))
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})

// ── Route: coverage happens only after a successful deploy ──────────────────

function recorder() {
  const res = { statusCode: 200, body: null }
  res.status = code => { res.statusCode = code; return res }
  res.json = body => { res.body = body; return res }
  return res
}
function deployRoutes() {
  const handlers = {}
  const app = { post: (p, f) => { handlers['POST ' + p] = f }, get: () => {}, delete: () => {} }
  const { register } = require(path.join(__dirname, '..', 'routes', 'deploy'))
  register(app, {
    _GI: () => ({ user: () => 't' }), _GITOK: () => 't', cl,
    deployLoadBaseline: () => null, deploySeed: async () => ({}),
    fail: (r, e) => r.status(500).json({ error: e.message }),
    fs, gateReadOnly: () => true, gitSecrets: { tokenSource: () => 'none' },
    listServers: () => [], makeClient: () => ({}), path,
    requireTm1Admin: async () => true,
  })
  return handlers
}

test('covered sets are marked only when the catch-up deploy is clean', async () => {
  const a = closed('Carried A', 'COV-R')
  const b = closed('Carried B', 'COV-R')
  const cu = catchUp('COV-R', [a.id, b.id])
  let result = { executed: false, controlOk: false, approvalSession: cu.id }
  require.cache[resolve('core/git-deploy')] = {
    id: resolve('core/git-deploy'), filename: resolve('core/git-deploy'), loaded: true,
    exports: { execute: async () => result, prepare: async () => ({}) },
  }
  const handlers = deployRoutes()

  await handlers['POST /api/deploy/git/execute']({ body: { target: 'TG', session: cu.id }, user: 'james', ideToken: 'x' }, recorder())
  assert.equal(cl.getSession(a.id).covered_by, null, 'a failed deploy covers nothing')

  result = { executed: true, controlOk: true, approvalSession: cu.id }
  await handlers['POST /api/deploy/git/execute']({ body: { target: 'TG', session: cu.id }, user: 'james', ideToken: 'x' }, recorder())
  assert.equal(cl.getSession(a.id).covered_by, cu.id)
  assert.equal(cl.getSession(b.id).covered_by, cu.id)
})
