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
      return {}
    },
    async get() { return {} }, async patch() { return {} }, async delete() { return {} },
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
    assert.match(out.error, /Reconcile/)
  } finally { driftEntries = []; fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})