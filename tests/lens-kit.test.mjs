import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rows, format, better } from '../shared/lens-kit/rows.js'
import { COMPONENTS, TOOLKIT_VERSION } from '../shared/lens-kit/components.js'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// The Lens toolkit's pure parts: Lens.rows / format / better, the component
// catalogue matching the toolkit, and the toolkit version shared with the store.
const cs = (cols, rowsAxis, values) => ({
  Axes: [{ Tuples: cols.map(c => ({ Members: c.map(n => ({ Name: n, UniqueName: `[Version].[Version].[${n}]` })) })) },
         ...(rowsAxis ? [{ Tuples: rowsAxis.map(r => ({ Members: r.map(([d, n]) => ({ Name: n, UniqueName: `[${d}].[${d}].[${n}]` })) })) }] : [])],
  Cells: values.map((v, i) => ({ Ordinal: i, Value: v })),
})

test('rows: one object per row, dims named from the member, columns labelled', () => {
  const r = rows(cs([['Actual'], ['Target']], [[['organization', '100']], [['organization', '200']]], [1, 2, 3, 4]))
  assert.deepEqual(r.map(x => [x._label, x.organization, x.Actual, x.Target]), [['100', '100', 1, 2], ['200', '200', 3, 4]])
})

test('rows: multi-member tuples join with " / "', () => {
  const r = rows(cs([['Y2', 'Actual']], [[['Account', 'GM'], ['Version', 'Actual']]], [7]))
  assert.equal(r[0]._label, 'GM / Actual'); assert.equal(r[0]['Y2 / Actual'], 7); assert.equal(r[0].Account, 'GM')
})

test('rows: a one-axis result is a single row; missing cells are null; empty is []', () => {
  assert.deepEqual(rows(cs([['A'], ['B']], null, [5])), [{ _label: '', _members: [], A: 5, B: null }])
  assert.deepEqual(rows({ Axes: [], Cells: [] }), [])
  assert.deepEqual(rows(null), [])
})

test('format and better', () => {
  assert.equal(format(71566000, 'k$'), '$71,566k')
  assert.equal(format(-1302000, 'k$'), '−$1,302k')
  assert.equal(format(0.377, '%'), '37.7%')
  assert.equal(format(null, 'k$'), '—')
  assert.equal(better(10, 8), true); assert.equal(better(10, 8, { cost: true }), false)
})

test('the component catalogue describes exactly the toolkit components', () => {
  const cat = JSON.parse(readFileSync(new URL('../shared/lens-components.json', import.meta.url), 'utf8'))
  const described = Object.keys(cat).filter(k => !k.startsWith('_') && k !== 'helpers').sort()
  assert.deepEqual(described, [...COMPONENTS].sort())
  for (const k of described) for (const f of ['purpose', 'call', 'data', 'interactions', 'goodFor', 'example']) assert.ok(cat[k][f], `${k}.${f}`)
})

test('the Lens store stamps the toolkit version the kit provides', () => {
  assert.equal(require('../core/lens_store.js').TOOLKIT_VERSION, TOOLKIT_VERSION)
})
