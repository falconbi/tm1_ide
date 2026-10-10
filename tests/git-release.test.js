'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

// ── Real temporary git repo helpers ──────────────────────────────────────────
const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rel-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rel-bare-'))

function bareInit(p) {
  execFileSync('git', ['init', '-q', '--bare', p])
  return p
}
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

// ── In-memory change_log (never touches change_log.db) ───────────────────────
const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

// Stub git-state BEFORE requiring git-release (lastDeployed is read at call time).
const gitStatePath = resolve('core/git-state')
let fakeBase = null
require.cache[gitStatePath] = { id: gitStatePath, filename: gitStatePath, loaded: true, exports: { lastDeployed: () => (fakeBase ? { lastDeployedCommit: fakeBase } : null), recordDeploy: async () => ({ ok: true }), load: () => ({}), FILE: '' } }

const cl = require(path.join(__dirname, '..', 'core', 'change_log'))
const { buildRelease } = require(path.join(__dirname, '..', 'core', 'git-release'))

const BASE_CONTENT = {
  'cubes/WFP Workforce Cost.rules': '# base rule\n[] = N:1;\n',
  'cubes/WFP Delete.rules': '# to delete\n[] = N:0;\n',
  'cubes/WFP Other.rules': '# other\n[] = N:2;\n',
  'dimensions/WFP Version.hierarchies/WFP Version.json': '{"elements":[{"Name":"Actual"}]}\n',
}

function setupRepo() {
  const bare = bareInit(BARE())
  const w = W()
  g(w, 'init', '-q')
  g(w, 'remote', 'add', 'origin', bare)
  for (const [f, t] of Object.entries(BASE_CONTENT)) write(w, f, t)
  const base = commitAll(w, 'base')
  // DEV state: A's rule changes, A deletes a rule, B changes a dimension, and an
  // unrelated rule (not in A) changes too.
  write(w, 'cubes/WFP Workforce Cost.rules', '# base rule (A edited)\n[] = N:10;\n# A marker\n')
  write(w, 'cubes/WFP Delete.rules', '# changed then deleted\n')
  fs.unlinkSync(path.join(w, 'cubes/WFP Delete.rules'))
  write(w, 'cubes/WFP Other.rules', '# other (not in A)\n[] = N:999;\n')
  write(w, 'dimensions/WFP Version.hierarchies/WFP Version.json', '{"elements":[{"Name":"Actual"},{"Name":"zz_scopedB"}]}\n')
  const devCommit = commitAll(w, 'dev state')
  g(w, 'branch', '-M', 'dev')
  g(w, 'push', '-q', 'origin', 'dev:dev')
  return { bare, base, devCommit, w }
}

test('release contains only the change set\'s objects; deleted object removed; excludes listed', async () => {
  const repo = setupRepo()
  try {
    fakeBase = repo.base
    // Change set A: edited rules for WFP Workforce Cost + deleted WFP Delete.
    const a = cl.startSession('Change set A', 'DEV1', 'admin')
    cl.setSessionCommit(a.id, repo.devCommit)
    cl.writeLog({ server: 'DEV1', action: 'RULES_UPDATED', objectType: 'rules', objectName: 'WFP Workforce Cost', user: 'admin' })
    cl.writeLog({ server: 'DEV1', action: 'OBJECT_DELETED', objectType: 'rules', objectName: 'WFP Delete', user: 'admin' })
    // Change set B (other): the dimension — should be LEFT ON DEV.
    cl.startSession('Change set B', 'DEV1', 'samtm1')
    cl.writeLog({ server: 'DEV1', action: 'ELEMENT_CREATED', objectType: 'dimension', objectName: 'WFP Version', user: 'samtm1' })

    const r = await buildRelease(a, 'TG1', { token: 'x', gitUser: 't', repoUrl: repo.bare })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.base, repo.base)
    assert.equal(r.devCommit, repo.devCommit)
    assert.ok(r.releaseCommit)

    const inc = r.included.map(i => `${i.type}:${i.name}:${i.action}`)
    assert.deepEqual(inc.sort(), [
      'cube:WFP Delete:D',
      'cube:WFP Workforce Cost:A',
    ].sort(), 'only A\'s rule objects ship')

    const excNames = r.excluded.map(x => `${x.type}:${x.name}`)
    assert.ok(excNames.includes('dimension:WFP Version'), 'B\'s dimension is left on DEV')
    assert.ok(excNames.includes('cube:WFP Other'), 'the unrelated rule is left on DEV')
    const bExcl = r.excluded.find(x => x.type === 'dimension' && x.name === 'WFP Version')
    assert.equal(bExcl.owner?.sessionName, 'Change set B', 'excluded object names its owning change set')

    // The pushed release branch contains exactly those files.
    const vw = W()
    try {
      g(vw, 'init', '-q'); g(vw, 'remote', 'add', 'origin', repo.bare)
      g(vw, 'fetch', '-q', 'origin', 'refs/heads/release-TG1:rel')
      const parent = g(vw, 'rev-parse', 'rel^').trim().slice(0, 7)
      const baseShort = repo.base.slice(0, 7)
      assert.equal(parent, baseShort, 'release parents to the recorded base')
      const diff = g(vw, 'diff', '--name-status', baseShort, 'rel').trim()
      assert.match(diff, /M\tcubes\/WFP Workforce Cost\.rules/)
      assert.match(diff, /D\tcubes\/WFP Delete\.rules/)
      assert.ok(!/WFP Version/.test(diff), 'the dimension file must not be in the release')
      assert.ok(!/WFP Other/.test(diff), 'the unrelated rule must not be in the release')
    } finally { fs.rmSync(vw, { recursive: true, force: true }) }
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})

test('build refuses when the target has no recorded deployed commit', async () => {
  const repo = setupRepo()
  try {
    fakeBase = null
    const a = cl.startSession('No base', 'DEV1', 'admin')
    cl.setSessionCommit(a.id, repo.devCommit)
    const r = await buildRelease(a, 'TG1', { token: 'x', gitUser: 't', repoUrl: repo.bare })
    assert.equal(r.ok, false)
    assert.equal(r.refused, true)
    assert.match(r.error, /no recorded deployed commit/i)
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})

test('build refuses when the change set has not been pushed', async () => {
  const repo = setupRepo()
  try {
    fakeBase = repo.base
    const a = cl.startSession('No dev commit', 'DEV1', 'admin')
    cl.setSessionCommit(a.id, null)
    const r = await buildRelease(a, 'TG1', { token: 'x', gitUser: 't', repoUrl: repo.bare })
    assert.equal(r.ok, false)
    assert.equal(r.refused, true)
    assert.match(r.error, /not been pushed/i)
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})

test('build refuses when release-<target> has moved (someone else released)', async () => {
  const repo = setupRepo()
  try {
    fakeBase = repo.base
    // Move release-TG1 to a different commit.
    const mv = W()
    try {
      g(mv, 'init', '-q'); g(mv, 'remote', 'add', 'origin', repo.bare)
      g(mv, 'fetch', '-q', 'origin', 'dev:dev')
      g(mv, 'checkout', '-q', '-b', 'release-TG1', 'dev')
      g(mv, 'push', '-q', 'origin', 'release-TG1:release-TG1')
    } finally { fs.rmSync(mv, { recursive: true, force: true }) }

    const a = cl.startSession('Moved release', 'DEV1', 'admin')
    cl.setSessionCommit(a.id, repo.devCommit)
    cl.writeLog({ server: 'DEV1', action: 'RULES_UPDATED', objectType: 'rules', objectName: 'WFP Workforce Cost', user: 'admin' })
    const r = await buildRelease(a, 'TG1', { token: 'x', gitUser: 't', repoUrl: repo.bare })
    assert.equal(r.ok, false)
    assert.equal(r.refused, true)
    assert.match(r.error, /has moved/i)
  } finally { fs.rmSync(repo.bare, { recursive: true, force: true }); fs.rmSync(repo.w, { recursive: true, force: true }) }
})