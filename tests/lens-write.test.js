'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { declaredWriteCubes, writeCells } = require('../core/lens_bridge')
const { createApp } = require('../lens-server')

// Lens write-back: a Lens changes only the cubes it declares, only plain
// numbers, never calculated cells, and never over a change someone else made.
// TM1 is a stub cube with dims A and B; `now` holds the current cell values.
function stubClient({ now = {}, ruled = [] } = {}) {
  const calls = { updates: [], mdx: [] }
  return {
    calls,
    async getCube() { return { Dimensions: [{ Name: 'A' }, { Name: 'B' }] } },
    async post(_path, body) {
      calls.mdx.push(body.MDX)
      const tuples = [...body.MDX.matchAll(/\(\[A\]\.\[A\]\.\[([^\]]+)\],\[B\]\.\[B\]\.\[([^\]]+)\]\)/g)].map(m => m[1] + '/' + m[2])
      return { ID: 'cs1', Cells: tuples.map((k, i) => ({ Ordinal: i, Value: now[k] ?? null, RuleDerived: ruled.includes(k), Consolidated: false })) }
    },
    async delete() {},
    async updateCells(cube, updates) { calls.updates.push({ cube, updates }) },
  }
}
const cell = (a, b, value, expect) => ({ coordinates: { A: a, B: b }, value, ...(expect === undefined ? {} : { expect }) })
const ok = { cube: 'Plan', allowedCubes: ['Plan'] }

test('declaredWriteCubes reads <meta name="lens-writes">, any attribute order, comma lists', () => {
  assert.deepEqual(declaredWriteCubes('<meta name="lens-writes" content="Plan, Other"><meta content="Third" name=\'lens-writes\'>'), ['Plan', 'Other', 'Third'])
  assert.deepEqual(declaredWriteCubes('<meta name="description" content="Plan">'), [])
  assert.deepEqual(declaredWriteCubes(null), [])
})

test('a cube the Lens did not declare is refused before TM1 is touched', async () => {
  const c = stubClient()
  await assert.rejects(writeCells(c, { cube: 'Payroll', cells: [cell('x', 'y', 1)], allowedCubes: ['Plan'] }), /hasn't declared that it changes "Payroll"/)
  assert.equal(c.calls.mdx.length, 0)
})

test('only plain numbers, full coordinates, no duplicates, at most 500 cells', async () => {
  const c = stubClient()
  await assert.rejects(writeCells(c, { ...ok, cells: [cell('x', 'y', '5')] }), /must be a number/)
  await assert.rejects(writeCells(c, { ...ok, cells: [cell('x', 'y', NaN)] }), /must be a number/)
  await assert.rejects(writeCells(c, { ...ok, cells: [{ coordinates: { A: 'x' }, value: 1 }] }), /missing B/)
  await assert.rejects(writeCells(c, { ...ok, cells: [{ coordinates: { A: 'x', B: 'y', C: 'z' }, value: 1 }] }), /"C" is not a dimension/)
  await assert.rejects(writeCells(c, { ...ok, cells: [cell('x', 'y', 1), cell('X', 'Y', 2)] }), /same cell appears twice/)
  await assert.rejects(writeCells(c, { ...ok, cells: Array.from({ length: 501 }, (_, i) => cell('x' + i, 'y', 1)) }), /limit is 500/)
  await assert.rejects(writeCells(c, { ...ok, cells: [] }), /nothing to save/)
  assert.equal(c.calls.updates.length, 0)
})

test('a calculated cell refuses the whole save', async () => {
  const c = stubClient({ ruled: ['x/2'] })
  await assert.rejects(writeCells(c, { ...ok, cells: [cell('x', '1', 5), cell('x', '2', 6)] }), /1 cell is calculated by TM1.*x · 2.*Nothing was saved/)
  assert.equal(c.calls.updates.length, 0)
})

test('a cell changed by someone else since the screen loaded refuses the whole save', async () => {
  const c = stubClient({ now: { 'x/1': 10, 'x/2': 99 } })
  const e = await writeCells(c, { ...ok, cells: [cell('x', '1', 5, 10), cell('x', '2', 6, 20)] }).catch(err => err)
  assert.match(e.message, /1 cell was changed by someone else.*Nothing was saved/)
  assert.deepEqual(e.conflicts, [{ coordinates: { A: 'x', B: '2' }, now: 99, expected: 20 }])
  assert.equal(c.calls.updates.length, 0)
})

test('a clean save writes every cell in one call and reports old and new values', async () => {
  const c = stubClient({ now: { 'x/1': 10 } })
  const r = await writeCells(c, { ...ok, cells: [cell('x', '1', 5, 10), cell('x', '2', 6, null)] })
  assert.equal(r.written, 2)
  assert.deepEqual(r.changes, [{ coordinates: { A: 'x', B: '1' }, old: 10, value: 5 }, { coordinates: { A: 'x', B: '2' }, old: 0, value: 6 }])
  assert.equal(c.calls.updates.length, 1)
  assert.deepEqual(c.calls.updates[0].updates[1], { dimElemPairs: [{ dim: 'A', element: 'x' }, { dim: 'B', element: '2' }], value: 6 })
})

test('a TM1 refusal comes back in plain English, with the TM1 code kept', async () => {
  const c = stubClient()
  c.updateCells = async () => { const e = new Error('500'); e.response = { data: { error: { message: 'CubeCellWriteStatusCubeNoWriteAccess' } } }; throw e }
  await assert.rejects(writeCells(c, { ...ok, cells: [cell('x', '1', 5)] }), /^Error: You don't have permission to change these cells in Plan .*\(TM1: CubeCellWriteStatusCubeNoWriteAccess\)\. Nothing was saved\.$/)
})

// Through the Lens app: the declared cubes come from the SAVED Lens, the save
// runs as the signed-in user, and it is logged.
test('Lens app: writes are checked against the saved Lens, run as the user, and logged', async () => {
  const logged = []
  let tm1 = null
  const deps = {
    probeAuthMethod: async () => ({ method: 'native' }),
    makeClientWithCredentials(server, creds) {
      tm1 = { ...stubClient(), _creds: creds, _adapter: { closeSession() {} }, async get() { return { Name: creds.username } } }
      return tm1
    },
    listLenses: async () => [],
    readLens: async (s, name) => ({ name, status: 'draft', toolkitVersion: 3, html: name === 'Input' ? '<meta name="lens-writes" content="Plan">' : '<p>read only</p>' }),
    logLensWrite: e => logged.push(e),
  }
  const { app, close } = createApp({ config: { server: 'S1', port: 0, showDrafts: true }, deps })
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  const base = `http://127.0.0.1:${srv.address().port}`
  try {
    const si = await fetch(`${base}/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'east_mgr', password: 'pw' }) })
    const cookie = (si.headers.get('set-cookie') || '').split(';')[0]
    const write = body => fetch(`${base}/api/lens/write-cells`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) })

    const refused = await write({ lens: 'Report', cube: 'Plan', cells: [cell('x', '1', 5)] })
    assert.equal(refused.status, 400)
    assert.match((await refused.json()).error, /hasn't declared/)

    const r = await write({ lens: 'Input', cube: 'Plan', cells: [cell('x', '1', 5)] })
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { written: 1 })
    assert.equal(tm1._creds.username, 'east_mgr')
    assert.equal(logged.length, 1)
    assert.equal(logged[0].user, 'east_mgr'); assert.equal(logged[0].lens, 'Input'); assert.equal(logged[0].app, 'lens')

    const signedOut = await fetch(`${base}/api/lens/write-cells`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(signedOut.status, 401)
  } finally { srv.close(); close() }
})

// ── Action buttons: Lens.run → a declared process, checked parameters ─────────
const { declaredRunProcesses, runProcess } = require('../core/lens_bridge')

function procClient({ status = 'CompletedSuccessfully', message = { Process: 'Spread', Message: 'Spread 1200.' } } = {}) {
  const calls = { runs: [] }
  return {
    calls,
    async getProcess(name) { return name === 'Spread' ? { Name: 'Spread', Parameters: [{ Name: 'pOrg', Type: 'String' }, { Name: 'pTotal', Type: 'Numeric' }] } : null },
    async executeProcess(name, params) { calls.runs.push({ name, params }); return { ProcessExecuteStatusCode: status } },
    async executeMDX() {
      const names = ['Process', 'Time', 'Message', 'Result']
      return { Axes: [{ Tuples: names.map(n => ({ Members: [{ Name: n }] })) }], Cells: names.map(n => ({ Value: message[n] ?? '' })) }
    },
  }
}
const run = { process: 'Spread', allowedProcesses: ['Spread'], user: 'east_mgr' }

test('declaredRunProcesses reads <meta name="lens-runs">', () => {
  assert.deepEqual(declaredRunProcesses('<meta name="lens-runs" content="Spread, Seed">'), ['Spread', 'Seed'])
  assert.deepEqual(declaredRunProcesses('<meta name="lens-writes" content="Plan">'), [])
})

test('a process the Lens did not declare is refused before TM1 is asked', async () => {
  const c = procClient()
  await assert.rejects(runProcess(c, { ...run, process: 'Delete Everything' }), /hasn't declared that it runs "Delete Everything"/)
  assert.equal(c.calls.runs.length, 0)
})

test('parameters must be the process own, with the right types', async () => {
  const c = procClient()
  await assert.rejects(runProcess(c, { ...run, params: { pEvil: 'x' } }), /has no parameter "pEvil"/)
  await assert.rejects(runProcess(c, { ...run, params: { pTotal: '1200' } }), /pTotal must be a number/)
  await assert.rejects(runProcess(c, { ...run, params: { pOrg: 101 } }), /pOrg must be text/)
  assert.equal(c.calls.runs.length, 0)
})

test('a successful run returns the message the process left', async () => {
  const c = procClient()
  const r = await runProcess(c, { ...run, params: { pOrg: '101', pTotal: 1200 } })
  assert.equal(r.status, 'CompletedSuccessfully'); assert.equal(r.message, 'Spread 1200.'); assert.equal(r.result, '')
  assert.deepEqual(c.calls.runs[0].params, [{ Name: 'pOrg', Value: '101' }, { Name: 'pTotal', Value: '1200' }])
})

test('a run returns the short Result the process left (e.g. a data reservation state)', async () => {
  const r = await runProcess(procClient({ message: { Process: 'Spread', Message: 'Store 101 is being edited by east_mgr.', Result: 'taken' } }), run)
  assert.equal(r.result, 'taken'); assert.match(r.message, /being edited by east_mgr/)
})

test('a refused run rejects with the process\'s own reason — never a stale message from another process', async () => {
  await assert.rejects(runProcess(procClient({ status: 'CompletedWithMessages', message: { Process: 'Spread', Message: 'You may not change store "401".' } }), { ...run, params: { pOrg: '401' } }), /^Error: You may not change store "401"\.$/)
  await assert.rejects(runProcess(procClient({ status: 'Aborted', message: { Process: 'Other', Message: 'old news' } }), run), /did not complete \(Aborted\)/)
})
