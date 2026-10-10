'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, o) => { const r = resolve(rel); require.cache[r] = { id: r, filename: r, loaded: true, exports: o } }
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dep-wk-'))

// Real temp repo: base then release change only cubes/A.rules.
function repo() {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-bare-'))
  execFileSync('git', ['init', '-q', '--bare', bare])
  const w = W(); g(w, 'init', '-q'); g(w, 'remote', 'add', 'origin', bare)
  fs.mkdirSync(path.join(w, 'cubes'), { recursive: true })
  fs.writeFileSync(path.join(w, 'cubes', 'A.rules'), '# base\n')
  g(w, 'add', '-A'); g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base')
  const base = g(w, 'rev-parse', 'HEAD').trim()
  fs.writeFileSync(path.join(w, 'cubes', 'A.rules'), '# base (A)\n')
  g(w, 'add', '-A'); g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'release')
  const releaseCommit = g(w, 'rev-parse', 'HEAD').trim()
  g(w, 'push', '-q', 'origin', 'HEAD:refs/heads/release-TG1')
  return { bare, base, releaseCommit, w }
}

// Real temp repo: base then a release that adds a chore file only.
function choreRepo() {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-bare-'))
  execFileSync('git', ['init', '-q', '--bare', bare])
  const w = W(); g(w, 'init', '-q'); g(w, 'remote', 'add', 'origin', bare)
  g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base')
  const base = g(w, 'rev-parse', 'HEAD').trim()
  fs.mkdirSync(path.join(w, 'chores'), { recursive: true })
  fs.writeFileSync(path.join(w, 'chores', 'My Chore.json'), JSON.stringify({ Name: 'My Chore' }))
  g(w, 'add', '-A'); g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'release')
  const releaseCommit = g(w, 'rev-parse', 'HEAD').trim()
  g(w, 'push', '-q', 'origin', 'HEAD:refs/heads/release-TG1')
  return { bare, base, releaseCommit, w }
}

// Real temp repo: base then a release that adds a subset file only.
function subsetRepo() {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-bare-'))
  execFileSync('git', ['init', '-q', '--bare', bare])
  const w = W(); g(w, 'init', '-q'); g(w, 'remote', 'add', 'origin', bare)
  g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base')
  const base = g(w, 'rev-parse', 'HEAD').trim()
  const dir = path.join(w, 'dimensions', 'WFP Cost Centre.hierarchies', 'WFP Cost Centre.subsets')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'Test Subset.json'), JSON.stringify({ Name: 'Test Subset', Expression: '{TM1SUBSETALL( [WFP Cost Centre] )}' }))
  g(w, 'add', '-A'); g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'release')
  const releaseCommit = g(w, 'rev-parse', 'HEAD').trim()
  g(w, 'push', '-q', 'origin', 'HEAD:refs/heads/release-TG1')
  return { bare, base, releaseCommit, w }
}

// In-memory change_log
const realBsq = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBsq(':memory:') } }
const cl = require(path.join(__dirname, '..', 'core', 'change_log'))

let ctx = null
function fakeClient() {
  return {
    async post(route) {
      if (route === 'GitStatus') return { URL: ctx.bare, DeployedCommit: { ID: 'x' } }
      if (route === 'GitPull') return { ID: 'PLAN1', Commit: { ID: ctx.planCommit ?? ctx.releaseCommit }, Operations: ctx.ops }
      if (/Subsets/.test(String(route)) && ctx?.subsetApplyFail) throw new Error('subset apply failed: boom')
      return {}
    },
    async get(route) {
      const r = String(route)
      if (ctx?.seenRoutes) ctx.seenRoutes.push(r)
      if (/Cubes\('A'\)/.test(r)) {
        if (ctx?.missingCube) throw { response: { status: 404 } }
        return { Rules: ctx.releaseRules ?? '# base (A)\n' }
      }
      if (/Cubes\(|Dimensions\(|Processes\(/.test(r)) return { Name: 'x' }
      return {}
    },
    async patch(route) {
      if (/Subsets/.test(String(route)) && ctx?.subsetApplyFail) throw new Error('subset apply failed: boom')
      return {}
    }, async delete() { return {} },
  }
}
const arReal = require(resolve('core/adapter_registry'))
stub('core/adapter_registry', { ...arReal, makeClient: () => fakeClient() })

let acquired = 0, released = 0
stub('core/git-lock', { acquire: async () => { acquired++; return { by: 't', at: 'now' } }, release: async () => { released++; return { ok: true } }, current: async () => null, clear: async () => ({ ok: true }) })
let baseCommit = null
stub('core/git-state', { lastDeployed: () => (baseCommit ? { lastDeployedCommit: baseCommit } : null), recordDeploy: async () => ({ ok: true }), load: () => ({}), FILE: '' })
stub('core/git-reconcile', { reconcile: async () => ({ restored: [], skipped: [], errors: [] }) })
// Drift guard: clean by default; a test flips driftEntries to force the refusal.
let driftEntries = []
stub('core/git-drift', { driftCheck: async () => ({ entries: driftEntries, deployed: baseCommit }), revert: async () => ({}), promote: async () => ({ ok: true }) })
// Approval exists for the release commit, linked to the change set. Keep the REAL
// sameCommit (the thing under test); stub only find/append.
const realApprovals = require(resolve('core/git-approvals'))
stub('core/git-approvals', {
  ...realApprovals,
  find: async () => ({ target: 'TG1', commit: ctx?.releaseCommit, approver: 'u', approved_at: 'now', session: ctx?.sessionId }),
  append: async (r) => r,
})

const { execute } = require(path.join(__dirname, '..', 'core', 'git-deploy'))
const { verifyRelease } = require(path.join(__dirname, '..', 'core', 'git-release'))

test('release deploy refuses when the pull plan carries an object not in the release', async () => {
  const r = repo()
  try {
    baseCommit = r.base
    const s = cl.startSession('Rel', 'DEV1', 'admin')
    cl.setSessionCommit(s.id, r.releaseCommit)
    cl.setSessionRelease(s.id, r.releaseCommit, 'TG1')
    cl.writeLog({ server: 'DEV1', action: 'RULES_UPDATED', objectType: 'rules', objectName: 'A', user: 'admin' })

    ctx = { bare: r.bare, releaseCommit: r.releaseCommit, sessionId: s.id, ops: ["Update Cubes('Sneaky')"] }
    acquired = 0; released = 0
    const out = await execute('TG1', { session: s.id, token: 'x', gitUser: 't' })
    assert.equal(out.refused, true)
    assert.equal(out.executed, false)
    assert.match(out.error, /not in this release/i)
    assert.match(out.error, /Sneaky/)
    assert.equal(released, 1, 'lock released on refusal')
  } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('release deploy proceeds when the plan contains only the release objects', async () => {
  const r = repo()
  try {
    baseCommit = r.base
    const s = cl.startSession('Rel2', 'DEV1', 'admin')
    cl.setSessionCommit(s.id, r.releaseCommit)
    cl.setSessionRelease(s.id, r.releaseCommit, 'TG1')

    ctx = { bare: r.bare, releaseCommit: r.releaseCommit, sessionId: s.id, ops: ["Update Cubes('A')"] }
    acquired = 0; released = 0
    const out = await execute('TG1', { session: s.id, token: 'x', gitUser: 't' })
    assert.equal(out.executed, true, JSON.stringify(out))
    assert.equal(out.release, true)
    assert.equal(out.releaseCommit, r.releaseCommit)
    assert.equal(released, 1)
  } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('a full approved ID matches a short plan ID (sameCommit) → deploys', async () => {
  const r = repo()
  try {
    baseCommit = r.base
    const s = cl.startSession('Rel-short', 'DEV1', 'admin')
    cl.setSessionCommit(s.id, r.releaseCommit)
    cl.setSessionRelease(s.id, r.releaseCommit, 'TG1')   // stored full
    // The pull plan reports the SHORT id — same commit, not a move.
    ctx = { bare: r.bare, releaseCommit: r.releaseCommit, planCommit: r.releaseCommit.slice(0, 8), sessionId: s.id, ops: ["Update Cubes('A')"] }
    const out = await execute('TG1', { session: s.id, token: 'x', gitUser: 't' })
    assert.equal(out.executed, true, JSON.stringify(out))
    assert.ok(!out.refused)
    assert.deepEqual(out.incomplete, [], 'everything that shipped is verified on the target')
  } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('an included object that did not land is reported as incomplete (not a clean success)', async () => {
  const r = repo()
  try {
    baseCommit = r.base
    const s = cl.startSession('Incomplete', 'DEV1', 'admin')
    cl.setSessionCommit(s.id, r.releaseCommit)
    cl.setSessionRelease(s.id, r.releaseCommit, 'TG1')
    ctx = { bare: r.bare, releaseCommit: r.releaseCommit, sessionId: s.id, ops: ["Update Cubes('A')"], missingCube: true }
    const out = await execute('TG1', { session: s.id, token: 'x', gitUser: 't' })
    assert.equal(out.executed, true, JSON.stringify(out))   // still "executed"...
    assert.deepEqual(out.incomplete, ['cube A'])             // ...but never a clean success
  } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('a genuinely different plan commit is refused as moved', async () => {
  const r = repo()
  try {
    baseCommit = r.base
    const s = cl.startSession('Rel-moved', 'DEV1', 'admin')
    cl.setSessionRelease(s.id, r.releaseCommit, 'TG1')
    ctx = { bare: r.bare, releaseCommit: r.releaseCommit, planCommit: '0000000000000000000000000000000000000000', sessionId: s.id, ops: [] }
    const out = await execute('TG1', { session: s.id, token: 'x', gitUser: 't' })
    assert.equal(out.refused, true)
    assert.match(out.error, /commit moved/i)
  } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('Skip operations (real TM1 format) are not counted as changes', async () => {
  const r = repo()
  try {
    baseCommit = r.base
    const s = cl.startSession('Real-format', 'DEV1', 'admin')
    cl.setSessionCommit(s.id, r.releaseCommit)
    cl.setSessionRelease(s.id, r.releaseCommit, 'TG1')
    // The exact strings TM1 returns: 41 Skips + the release's own Update.
    const ops = [
      "Skip Dimensions('WFP Assumptions Measure')",
      "Skip Dimensions('WFP Cost Centre')",
      "Skip Processes('WFP Copy Version')",
      "Skip Cubes('WFP Workforce Input')",
      "Update Cubes('A')",
    ]
    ctx = { bare: r.bare, releaseCommit: r.releaseCommit, sessionId: s.id, ops }
    const out = await execute('TG1', { session: s.id, token: 'x', gitUser: 't' })
    assert.equal(out.executed, true, JSON.stringify(out))
    assert.ok(!out.refused, 'Skips must not flip the release to \'unexpected\'')
  } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('a Replace/Update of an object not in the release is still refused', async () => {
  const r = repo()
  try {
    baseCommit = r.base
    const s = cl.startSession('Real-format-refuse', 'DEV1', 'admin')
    cl.setSessionCommit(s.id, r.releaseCommit)
    cl.setSessionRelease(s.id, r.releaseCommit, 'TG1')
    ctx = { bare: r.bare, releaseCommit: r.releaseCommit, sessionId: s.id, ops: [
      "Skip Dimensions('WFP Assumptions Measure')",
      "Replace Dimensions('WFP Version')",
      "Update Cubes('Sneaky')",
    ] }
    const out = await execute('TG1', { session: s.id, token: 'x', gitUser: 't' })
    assert.equal(out.refused, true)
    assert.match(out.error, /not in this release/i)
    assert.match(out.error, /Sneaky/)
    assert.ok(!/WFP Assumptions Measure/.test(out.error), 'Skip objects are not in the refusal list')
  } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('deploy is refused when the target has drifted (snapshot refreshed first)', async () => {
  const r = repo()
  try {
    baseCommit = r.base
    const s = cl.startSession('Drift', 'DEV1', 'admin')
    cl.setSessionCommit(s.id, r.releaseCommit)
    cl.setSessionRelease(s.id, r.releaseCommit, 'TG1')
    driftEntries = [{ status: 'M', file: 'dimensions/WFP Version.hierarchies/WFP Version.json' }]
    ctx = { bare: r.bare, releaseCommit: r.releaseCommit, sessionId: s.id, ops: ["Update Cubes('A')"] }
    const out = await execute('TG1', { session: s.id, token: 'x', gitUser: 't' })
    assert.equal(out.refused, true)
    assert.equal(out.executed, false)
    assert.equal(out.drift, 'drifted')
    assert.match(out.error, /drifted/i)
    assert.match(out.error, /Re-apply the change on DEV/i)
    assert.match(out.error, /paused until drift is clean/)
  } finally { driftEntries = []; fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('execute refuses any deploy that is not a built release', async () => {
  const r = repo()
  try {
    baseCommit = r.base
    ctx = { bare: r.bare, releaseCommit: r.releaseCommit, ops: [] }
    // No session → no release → rule 1 refusal.
    const out = await execute('TG1', { source: 'DEV1', token: 'x', gitUser: 't' })
    assert.equal(out.refused, true)
    assert.equal(out.executed, false)
    assert.match(out.error, /Build a release first/i)
  } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('verifyRelease checks a chore against Chores(...), not Processes(...)', async () => {
  const r = choreRepo()
  try {
    ctx = { bare: r.bare, seenRoutes: [] }
    const incomplete = await verifyRelease('TG1', { base: r.base, releaseCommit: r.releaseCommit, repoUrl: r.bare, token: 'x', gitUser: 't' })
    assert.deepEqual(incomplete, [], 'chore landed → verified, nothing reported incomplete')
    const choreCalls = ctx.seenRoutes.filter(x => /Chores\('/.test(x))
    const procCalls = ctx.seenRoutes.filter(x => /Processes\('/.test(x))
    assert.equal(choreCalls.length, 1, `exactly one GET to Chores('My Chore') — saw ${JSON.stringify(ctx.seenRoutes)}`)
    assert.match(choreCalls[0], /^Chores\('My%20Chore'\)/)
    assert.equal(procCalls.length, 0, 'a chore is never probed as a Process')
  } finally { ctx = null; fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('a subset apply failure drives controlOk to false', async () => {
  const r = subsetRepo()
  try {
    baseCommit = r.base
    const s = cl.startSession('SubFail', 'DEV1', 'admin')
    cl.setSessionCommit(s.id, r.releaseCommit)
    cl.setSessionRelease(s.id, r.releaseCommit, 'TG1')
    cl.writeLog({ server: 'DEV1', action: 'SUBSET_CREATED', objectType: 'subset', objectName: 'Test Subset', detail: 'WFP Cost Centre', user: 'admin' })

    ctx = {
      bare: r.bare, releaseCommit: r.releaseCommit, planCommit: r.releaseCommit, sessionId: s.id,
      ops: [`Create Subsets('Test Subset','WFP Cost Centre')`], subsetApplyFail: true,
    }
    const out = await execute('TG1', { session: s.id, source: 'DEV1', token: 'x', gitUser: 't' })
    assert.equal(out.executed, true, JSON.stringify(out))
    assert.equal(out.subsetsViews.errors.length, 1, 'the subset apply failure is surfaced')
    assert.match(out.subsetsViews.errors[0].error, /subset apply failed/)
    assert.equal(out.controlOk, false, 'a failed subset apply is never control-ok')
  } finally { ctx = null; fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})