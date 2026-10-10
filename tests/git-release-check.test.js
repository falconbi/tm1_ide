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
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chk-wk-'))

function repo({ processBody = '' } = {}) {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'chk-bare-'))
  execFileSync('git', ['init', '-q', '--bare', bare])
  const w = W(); g(w, 'init', '-q'); g(w, 'remote', 'add', 'origin', bare)
  fs.mkdirSync(path.join(w, 'cubes'), { recursive: true })
  fs.mkdirSync(path.join(w, 'processes'), { recursive: true })
  fs.writeFileSync(path.join(w, 'cubes', 'A.rules'), '# base\n')
  fs.writeFileSync(path.join(w, 'processes', 'P.ti'), '#region Prolog\n#endregion\n#region Metadata\n#endregion\n#region Data\n#endregion\n#region Epilog\n#endregion\n')
  g(w, 'add', '-A'); g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base')
  const base = g(w, 'rev-parse', 'HEAD').trim()
  fs.writeFileSync(path.join(w, 'cubes', 'A.rules'), "# base (A)\n['X'] = 1;\n")
  fs.writeFileSync(path.join(w, 'processes', 'P.ti'), `#region Prolog\n${processBody}\n#endregion\n#region Metadata\n#endregion\n#region Data\n#endregion\n#region Epilog\n#endregion\n`)
  g(w, 'add', '-A'); g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'release')
  const releaseCommit = g(w, 'rev-parse', 'HEAD').trim()
  g(w, 'push', '-q', 'origin', 'HEAD:refs/heads/release/TG1')
  return { bare, base, releaseCommit, w }
}

let ctx = null
function fakeClient() {
  return {
    async post(route) {
      if (route === 'GitStatus') return { URL: ctx.bare }
      if (/tm1\.CheckRules/.test(route)) return { value: ctx.checkValue }
      return {}
    },
    async get() { return {} }, async patch() { return {} }, async delete() { return {} },
  }
}
const arReal = require(resolve('core/adapter_registry'))
stub('core/adapter_registry', { ...arReal, makeClient: () => fakeClient() })
let baseCommit = null
stub('core/git-state', { lastDeployed: () => (baseCommit ? { lastDeployedCommit: baseCommit } : null), recordDeploy: async () => ({ ok: true }), load: () => ({}), FILE: '' })

const { checkDependencies } = require(path.join(__dirname, '..', 'core', 'git-release'))

test('a rule that fails CheckRules on the target blocks approval', async () => {
  const r = repo()
  try {
    baseCommit = r.base
    ctx = { bare: r.bare, checkValue: [{ LineNumber: 2, Message: 'Dimension "Missing" not found' }] }
    const out = await checkDependencies(r.releaseCommit, 'TG1', { token: 'x', gitUser: 't', repoUrl: r.bare })
    assert.equal(out.ok, false)
    assert.equal(out.blockers.length, 1)
    assert.match(out.blockers[0].object, /rules A/)
    assert.match(out.blockers[0].message, /not found/i)
    assert.match(out.blockers[0].message, /another change set/i)
  } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('a clean rule and process pass the dependency check', async () => {
  const r = repo({ processBody: "sValue = 'ok';" })
  try {
    baseCommit = r.base
    ctx = { bare: r.bare, checkValue: [] }
    const out = await checkDependencies(r.releaseCommit, 'TG1', { token: 'x', gitUser: 't', repoUrl: r.bare })
    assert.equal(out.ok, true, JSON.stringify(out))
    assert.deepEqual(out.blockers, [])
  } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('a process that fails TI lint blocks approval', async () => {
  const r = repo({ processBody: 'CellPutN();' })   // CellPutN needs value+cube+dims
  try {
    baseCommit = r.base
    ctx = { bare: r.bare, checkValue: [] }
    const out = await checkDependencies(r.releaseCommit, 'TG1', { token: 'x', gitUser: 't', repoUrl: r.bare })
    assert.equal(out.ok, false, JSON.stringify(out))
    assert.match(out.blockers[0].object, /process P/)
  } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})