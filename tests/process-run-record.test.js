'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'run-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'run-bare-'))
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
const { buildRelease, ENTRY_TO_OBJECT } = require(path.join(__dirname, '..', 'core', 'git-release'))
const { maskRunParams, recordProcessRun } = require(path.join(__dirname, '..', 'core', 'process-run'))

test('maskRunParams masks password and token values by name, including nested and array parameters', () => {
  assert.deepEqual(maskRunParams([
    { Name: 'pUserName', Value: 'james' },
    { Name: 'pPassword', Value: 'hunter2' },
  ]), [
    { Name: 'pUserName', Value: 'james' },
    { Name: 'pPassword', Value: '***' },
  ])
  assert.deepEqual(maskRunParams({
    pUser: 'james', pPassword: 'hunter2', client_token: 'abc', nested: { api_key: 'k', other: 1 },
  }), {
    pUser: 'james', pPassword: '***', client_token: '***', nested: { api_key: '***', other: 1 },
  })
})

test('a run is recorded only while a change set is active, with the secrets masked', () => {
  let written = null
  const active = {
    getActiveSession: () => ({ id: 's1', name: 'Testing WFP' }),
    writeLog: (entry) => { written = entry },
  }
  const out = recordProcessRun({
    log: active, server: 'DEV', user: 'james', name: 'WFP Rebuild',
    params: { pPassword: 'hunter2', pName: 'x' }, status: 'completed', duration: 42,
  })
  assert.equal(out.recorded, true)
  assert.equal(written.action, 'PROCESS_RUN')
  assert.equal(written.objectType, 'process-run')
  assert.equal(written.objectName, 'WFP Rebuild')
  assert.equal(written.detail.params.pPassword, '***')
  assert.equal(written.detail.params.pName, 'x')
  assert.equal(written.detail.status, 'completed')
  assert.equal(written.detail.duration, 42)

  const idle = { getActiveSession: () => null, writeLog: () => { throw new Error('must not write without a change set') } }
  assert.deepEqual(recordProcessRun({ log: idle, server: 'DEV', user: 'james', name: 'X' }), { recorded: false })
})

test('process-run is not in ENTRY_TO_OBJECT', () => {
  assert.equal(ENTRY_TO_OBJECT['process-run'], undefined)
})

test('a PROCESS_RUN never makes the release ship the process file', async () => {
  const bare = BARE()
  execFileSync('git', ['init', '-q', '--bare', bare])
  const w = W()
  try {
    g(w, 'init', '-q')
    g(w, 'remote', 'add', 'origin', bare)
    write(w, 'cubes/Keep.rules', '# base\n[] = N:0;\n')
    const base = commitAll(w, 'base')

    // DEV changed the process's file AND ran it; the change set only recorded the run.
    write(w, 'processes/MyProc.json', JSON.stringify({ Name: 'MyProc', PrologProcedure: '# changed by TI output' }))
    write(w, 'cubes/Keep.rules', '# changed rules\n[] = N:1;\n')
    const devCommit = commitAll(w, 'dev')
    g(w, 'branch', '-M', 'dev')
    g(w, 'push', '-q', 'origin', 'dev:dev')

    fakeBase = base
    const server = 'DEV-RUN-1'
    const s = cl.startSession('Runs only', server, 'james')
    cl.setSessionCommit(s.id, devCommit)
    cl.writeLog({ server, action: 'PROCESS_RUN', objectType: 'process-run', objectName: 'MyProc', detail: { status: 'completed' }, user: 'james' })

    // Only a run changed nothing this change set owns → nothing to deploy. That is
    // recorded as done (with the reason), not refused: a set that can never be
    // released yet blocks later sets is a deadlock.
    const onlyRun = await buildRelease(s, 'TGR-1', { token: 'x', gitUser: 't', repoUrl: bare })
    assert.equal(onlyRun.noChange, true)
    assert.match(onlyRun.reason, /nothing to deploy/i)

    // Add a real change; the process file is still left on DEV.
    cl.writeLog({ server, action: 'RULES_SAVED', objectType: 'rules', objectName: 'Keep', user: 'james' })
    const r = await buildRelease(s, 'TGR-1', { token: 'x', gitUser: 't', repoUrl: bare })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.runs, 1)
    assert.ok(r.included.some(i => i.type === 'cube' && i.name === 'Keep'))
    assert.ok(!r.included.some(i => i.type === 'process' && i.name === 'MyProc'))
    assert.ok(r.excluded.some(i => i.type === 'process' && i.name === 'MyProc'))

    const vw = W()
    try {
      g(vw, 'init', '-q'); g(vw, 'remote', 'add', 'origin', bare)
      g(vw, 'fetch', '-q', 'origin', 'refs/heads/release-TGR-1:rel')
      const files = g(vw, 'ls-tree', '-r', '--name-only', 'rel').split('\n')
      assert.ok(!files.includes('processes/MyProc.json'), 'the run must not ship the process file')
    } finally { fs.rmSync(vw, { recursive: true, force: true }) }
  } finally {
    fs.rmSync(bare, { recursive: true, force: true })
    fs.rmSync(w, { recursive: true, force: true })
  }
})
