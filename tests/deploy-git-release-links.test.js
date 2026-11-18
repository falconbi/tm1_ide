'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lnk-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lnk-bare-'))

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

const gitStatePath = resolve('core/git-state')
let fakeBase = null
require.cache[gitStatePath] = { id: gitStatePath, filename: gitStatePath, loaded: true, exports: { lastDeployed: () => (fakeBase ? { lastDeployedCommit: fakeBase } : null), recordDeploy: async () => ({ ok: true }), load: () => ({}), FILE: '' } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))
const { buildRelease, linkClosure } = require(path.join(__dirname, '..', 'core', 'git-release'))

// ── Pure closure ─────────────────────────────────────────────────────────────

test('linkClosure — a hierarchy that links two subsets reports both missing', () => {
  const files = ['dimensions/WFP Position.hierarchies/By Location.json']
  const tree = {
    [files[0]]: JSON.stringify({ Name: 'By Location', 'Subsets@Code.links': ['By Location.subsets/Cities.json', 'By Location.subsets/Default.json'] }),
  }
  assert.deepEqual(linkClosure(files, f => tree[f] ?? null), [
    { file: 'dimensions/WFP Position.hierarchies/By Location.subsets/Cities.json', neededBy: files[0] },
    { file: 'dimensions/WFP Position.hierarchies/By Location.subsets/Default.json', neededBy: files[0] },
  ])
})

test('linkClosure — a cube links views relative to the cubes folder', () => {
  const files = ['cubes/WFP Cost.json']
  const tree = { [files[0]]: JSON.stringify({ 'Views@Code.links': ['WFP Cost.views/Default.json'] }) }
  assert.deepEqual(linkClosure(files, f => tree[f] ?? null), [
    { file: 'cubes/WFP Cost.views/Default.json', neededBy: files[0] },
  ])
})

test('linkClosure — a dimension links hierarchies', () => {
  const files = ['dimensions/WFP Position.json']
  const tree = { [files[0]]: JSON.stringify({ 'Hierarchies@Code.links': ['WFP Position.hierarchies/By Location.json'] }) }
  assert.deepEqual(linkClosure(files, f => tree[f] ?? null), [
    { file: 'dimensions/WFP Position.hierarchies/By Location.json', neededBy: files[0] },
  ])
})

test('linkClosure — a link already in the release is not missing', () => {
  const files = ['dimensions/WFP Position.json', 'dimensions/WFP Position.hierarchies/By Location.json']
  const tree = { [files[0]]: JSON.stringify({ 'Hierarchies@Code.links': ['WFP Position.hierarchies/By Location.json'] }) }
  assert.deepEqual(linkClosure(files, f => tree[f] ?? null), [])
})

test('linkClosure — a nested link is followed through a linked file', () => {
  const dim = 'dimensions/WFP Position.json'
  const hier = 'dimensions/WFP Position.hierarchies/By Location.json'
  const files = [dim, hier]
  const tree = {
    [dim]: JSON.stringify({ 'Hierarchies@Code.links': ['WFP Position.hierarchies/By Location.json'] }),
    [hier]: JSON.stringify({ 'Subsets@Code.links': ['By Location.subsets/Cities.json'] }),
  }
  assert.deepEqual(linkClosure(files, f => tree[f] ?? null), [
    { file: 'dimensions/WFP Position.hierarchies/By Location.subsets/Cities.json', neededBy: hier },
  ])
})

test('linkClosure — the singular @Code.link is handled too', () => {
  const files = ['cubes/CubeA.views/MDX.json']
  const tree = { [files[0]]: JSON.stringify({ '@type': 'MDXView', 'MDX@Code.link': 'MDX.mdx' }) }
  assert.deepEqual(linkClosure(files, f => tree[f] ?? null), [
    { file: 'cubes/CubeA.views/MDX.mdx', neededBy: files[0] },
  ])
})

// ── buildRelease adds dependencies, refuses owned or missing links ───────────

const HIER = 'dimensions/WFP Position.hierarchies/By Location.json'
const CITIES = 'dimensions/WFP Position.hierarchies/By Location.subsets/Cities.json'
const DEFAULT = 'dimensions/WFP Position.hierarchies/By Location.subsets/Default.json'

function setupRepo({ extra = {} } = {}) {
  const bare = bareInit(BARE())
  const w = W()
  g(w, 'init', '-q')
  g(w, 'remote', 'add', 'origin', bare)
  write(w, 'cubes/Base.rules', '# base\n[] = N:0;\n')
  const base = commitAll(w, 'base')
  write(w, HIER, JSON.stringify({ Name: 'By Location', 'Subsets@Code.links': ['By Location.subsets/Cities.json', 'By Location.subsets/Default.json'] }))
  write(w, CITIES, JSON.stringify({ Name: 'Cities', Expression: '{[WFP Position].[WFP Position].[Sydney]}' }))
  write(w, DEFAULT, JSON.stringify({ Name: 'Default', Expression: 'TM1SubsetAll([WFP Position].[WFP Position])' }))
  for (const [f, t] of Object.entries(extra)) write(w, f, t)
  const devCommit = commitAll(w, 'dev')
  g(w, 'branch', '-M', 'dev')
  g(w, 'push', '-q', 'origin', 'dev:dev')
  return { bare, base, devCommit, w }
}

function changeSet(name, server, devCommit) {
  const s = cl.startSession(name, server, 'admin')
  cl.setSessionCommit(s.id, devCommit)
  cl.writeLog({ server, action: 'ELEMENT_ADDED', objectType: 'dimension', objectName: 'WFP Position', detail: 'Sydney', user: 'admin' })
  return s
}

test('buildRelease adds unowned linked subsets on DEV as dependencies', async () => {
  const repo = setupRepo()
  try {
    fakeBase = repo.base
    const a = changeSet('Links A', 'DEV-LINK-A', repo.devCommit)
    const r = await buildRelease(a, 'TGL-A', { token: 'x', gitUser: 't', repoUrl: repo.bare })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.deepEqual(r.addedAsDependency.map(d => d.file).sort(), [CITIES, DEFAULT].sort())
    assert.ok(r.addedAsDependency.every(d => d.neededBy === HIER))
    assert.ok(r.included.some(i => i.file === HIER))

    const vw = W()
    try {
      g(vw, 'init', '-q'); g(vw, 'remote', 'add', 'origin', repo.bare)
      g(vw, 'fetch', '-q', 'origin', 'refs/heads/release-TGL-A:rel')
      const files = g(vw, 'ls-tree', '-r', '--name-only', 'rel').split('\n')
      assert.ok(files.includes(CITIES), 'Cities is in the release')
      assert.ok(files.includes(DEFAULT), 'Default is in the release')
    } finally { fs.rmSync(vw, { recursive: true, force: true }) }
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})

test('buildRelease refuses a linked file owned by another change set, naming it', async () => {
  const repo = setupRepo()
  try {
    fakeBase = repo.base
    const owner = cl.startSession('Subset owner', 'DEV-LINK-B', 'samtm1')
    cl.writeLog({ server: 'DEV-LINK-B', action: 'SUBSET_SAVED', objectType: 'subset', objectName: 'Cities', detail: 'WFP Position', user: 'samtm1' })
    const a = changeSet('Links B', 'DEV-LINK-B', repo.devCommit)
    const r = await buildRelease(a, 'TGL-B', { token: 'x', gitUser: 't', repoUrl: repo.bare })
    assert.equal(r.ok, false)
    assert.equal(r.refused, true)
    assert.match(r.error, /belongs to change set "Subset owner"/)
    assert.match(r.error, /Cities\.json/)
    assert.ok(owner)
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})

test('buildRelease refuses a link that is not on DEV either', async () => {
  const repo = setupRepo()
  try {
    fakeBase = repo.base
    const a = changeSet('Links C', 'DEV-LINK-C', repo.devCommit)
    // Point the released hierarchy at a file nobody committed.
    const w = repo.w
    write(w, HIER, JSON.stringify({ Name: 'By Location', 'Subsets@Code.links': ['By Location.subsets/Ghost.json'] }))
    const dev = commitAll(w, 'dev ghost link')
    g(w, 'push', '-q', '--force', 'origin', 'dev:dev')
    cl.setSessionCommit(a.id, dev)
    const r = await buildRelease(a, 'TGL-C', { token: 'x', gitUser: 't', repoUrl: repo.bare })
    assert.equal(r.ok, false)
    assert.equal(r.refused, true)
    assert.match(r.error, /does not exist on DEV/)
    assert.match(r.error, /Ghost\.json/)
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})
