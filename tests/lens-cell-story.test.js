'use strict'
// A cell's story for a Lens (core/lens_bridge.js): trace / log / notes — every
// dimension named, the person must be able to read the cell, notes only on cubes
// the saved Lens declares, and added notes show in History.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const os = require('os'), fs = require('fs'), path = require('path')
const b = require('../core/lens_bridge')
const log = require('../core/lens_activity_log')

function fakeClient({ readable = true } = {}) {
  const added = []
  return {
    added,
    getCube: async () => ({ Dimensions: [{ Name: 'Measure' }, { Name: 'Entity' }] }),
    executeMDX: async () => { if (!readable) throw new Error('no access'); return { Cells: [] } },
    traceCellCalculation: async (cube, pairs) => ({ Type: 'Rule', pairs }),
    getTransactionLog: async (cube, o) => [{ TimeStamp: 't', User: 'u', OldValue: 1, NewValue: 2, Tuple: o.elements }],
    getAnnotations: async () => [
      { ID: '1', Text: 'mine', Author: 'a', TimeStamp: 't', Tuple: [{ Name: 'Rate', Hierarchy: { Dimension: { Name: 'Measure' } } }, { Name: 'UK', Hierarchy: { Dimension: { Name: 'Entity' } } }] },
      { ID: '2', Text: 'other', Author: 'a', TimeStamp: 't', Tuple: [{ Name: 'Rate', Hierarchy: { Dimension: { Name: 'Measure' } } }, { Name: 'US', Hierarchy: { Dimension: { Name: 'Entity' } } }] },
    ],
    addAnnotation: async (cube, pairs, text) => { added.push({ cube, pairs, text }) },
  }
}
const co = { Measure: 'Rate', Entity: 'UK' }

test('trace names the cell in cube order; every dimension is required', async () => {
  const r = await b.cellTrace(fakeClient(), 'C', { Entity: 'UK', Measure: 'Rate' })
  assert.deepEqual(r.pairs, [{ dim: 'Measure', element: 'Rate' }, { dim: 'Entity', element: 'UK' }])
  await assert.rejects(b.cellTrace(fakeClient(), 'C', { Measure: 'Rate' }), /missing: Entity/)
})

test("log and notes only for a cell the person can read; notes are this cell's only", async () => {
  assert.deepEqual((await b.cellLog(fakeClient(), 'C', co)).map(r => [r.user, r.old, r.value]), [['u', 1, 2]])
  await assert.rejects(b.cellLog(fakeClient({ readable: false }), 'C', co), /can't see this cell/)
  assert.deepEqual((await b.cellNotes(fakeClient(), 'C', co)).map(n => n.text), ['mine'])
  await assert.rejects(b.cellNotes(fakeClient({ readable: false }), 'C', co), /can't see this cell/)
})

test('adding a note: only on a declared cube, with text, on a readable cell', async () => {
  const c = fakeClient()
  await assert.rejects(b.addCellNote(c, { cube: 'C', coordinates: co, text: 'x', allowedCubes: ['Other'] }), /hasn't declared notes on "C"/)
  await assert.rejects(b.addCellNote(c, { cube: 'C', coordinates: co, text: '  ', allowedCubes: ['C'] }), /needs some text/)
  await assert.rejects(b.addCellNote(fakeClient({ readable: false }), { cube: 'C', coordinates: co, text: 'x', allowedCubes: ['C'] }), /can't see/)
  await b.addCellNote(c, { cube: 'C', coordinates: co, text: 'Agreed', allowedCubes: ['c'] })
  assert.equal(c.added[0].text, 'Agreed')
  assert.deepEqual(b.lensNotes({ html: '<meta name="lens-notes" content="A"><meta name="lens-writes" content="B">', config: { notes: ['N'] } }).sort(), ['A', 'B', 'N'])
})

test('an added note shows in History for that slice', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-')), 'a.jsonl')
  log.logLensNote({ server: 'S', app: 'lens', user: 'u', lens: 'L', cube: 'C', coordinates: co, text: 'Agreed' }, file)
  assert.equal(log.readLensActivity({ server: 'S', lens: 'L', match: { Entity: 'UK' } }, file)[0].text, 'Agreed')
  assert.equal(log.readLensActivity({ server: 'S', lens: 'L', match: { Entity: 'US' } }, file).length, 0)
})
