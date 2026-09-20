import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellsetToHierarchyData, parseCellset, buildGridData, lookupFormat } from '../client/src/lib/view-cellset.js'

function member(name, dim, type = 'N') {
  return { Name: name, UniqueName: `[${dim}].[${dim}].[${name}]`, Type: type }
}

function cellset(rows, cols, cells) {
  return {
    Axes: [
      { Ordinal: 0, Tuples: cols.map(cs => ({ Members: cs })) },
      { Ordinal: 1, Tuples: rows.map(rs => ({ Members: rs })) },
    ],
    Cells: cells,
  }
}

test('cellsetToHierarchyData builds columns + data keyed by row tuple', () => {
  const cs = cellset(
    [[member('Admin', 'Cost Centre')], [member('IT', 'Cost Centre')]],
    [[member('FY25', 'Period')]],
    [
      { Ordinal: 0, Value: 100, FormattedValue: '100' },
      { Ordinal: 1, Value: 200, FormattedValue: '200' },
    ]
  )
  const h = cellsetToHierarchyData(cs)
  assert.deepEqual(h.columns, [{ id: 'c0', label: 'FY25', members: ['FY25'] }])
  assert.equal(h.data['Admin']['c0'], '100')
  assert.equal(h.data['IT']['c0'], '200')
  assert.equal(h.data['Admin']['c0__u'], 1)
})

test('cellsetToHierarchyData applies TM1 format strings', () => {
  const cs = cellset(
    [[member('Admin', 'Cost Centre')]],
    [[member('FY25', 'Period')]],
    [{ Ordinal: 0, Value: 1234.5, FormattedValue: '1,234.50' }]
  )
  const formatMap = { 'Cost Centre': { Admin: '1,000' } }
  assert.equal(cellsetToHierarchyData(cs, formatMap).data['Admin']['c0'], '1,235')
})

test('cellsetToHierarchyData useFormat off returns raw values', () => {
  const cs = cellset(
    [[member('Admin', 'Cost Centre')]],
    [[member('FY25', 'Period')]],
    [{ Ordinal: 0, Value: 1234.5, FormattedValue: '1,234.50' }]
  )
  const formatMap = { 'Cost Centre': { Admin: '1,000' } }
  assert.equal(cellsetToHierarchyData(cs, formatMap, [], 'none', false).data['Admin']['c0'], '1234.5')
})

test('cellsetToHierarchyData formats zero cells with null Value (the 0.00 bug)', () => {
  const cs = cellset(
    [[member('Admin', 'Cost Centre')]],
    [[member('FY25', 'Period')]],
    [{ Ordinal: 0, Value: null, FormattedValue: '0.00' }]
  )
  const formatMap = { 'Cost Centre': { Admin: '1,000' } }
  assert.equal(cellsetToHierarchyData(cs, formatMap).data['Admin']['c0'], '0')
})

test('cellsetToHierarchyData suppression drops empty rows', () => {
  const cs = cellset(
    [[member('Admin', 'Cost Centre')], [member('Empty', 'Cost Centre')]],
    [[member('FY25', 'Period')]],
    [
      { Ordinal: 0, Value: 100, FormattedValue: '100' },
      { Ordinal: 1, Value: 0, FormattedValue: '0' },
    ]
  )
  const h = cellsetToHierarchyData(cs, {}, [], 'rows')
  assert.ok(h.data['Admin'])
  assert.ok(!h.data['Empty'])
})

test('cellsetToHierarchyData @ colour format sets __fmt and __colour', () => {
  const cs = cellset(
    [[member('Admin', 'Cost Centre')]],
    [[member('FY25', 'Period')]],
    [{ Ordinal: 0, Value: 5, FormattedValue: '5' }]
  )
  const formatMap = { 'Cost Centre': { Admin: '@red' } }
  const h = cellsetToHierarchyData(cs, formatMap)
  assert.equal(h.data['Admin']['c0__fmt'], '@')
  assert.equal(h.data['Admin']['c0__colour'], 'red')
})

test('parseCellset (view) applies formats and falls back to FormattedValue', () => {
  const cs = cellset(
    [[member('Admin', 'Cost Centre')]],
    [[member('FY25', 'Period')]],
    [{ Ordinal: 0, Value: 1234.5, FormattedValue: '1,234.50' }]
  )
  const p = parseCellset(cs, { 'Cost Centre': { Admin: '0.00' } })
  assert.deepEqual(p.cols, ['FY25'])
  assert.deepEqual(p.rows, [['Admin']])
  assert.deepEqual(p.rowDimNames, ['Cost Centre'])
  assert.deepEqual(p.grid, [['1234.50']])
})

test('parseCellset (view) useFormat off returns raw', () => {
  const cs = cellset(
    [[member('Admin', 'Cost Centre')]],
    [[member('FY25', 'Period')]],
    [{ Ordinal: 0, Value: 1234.5, FormattedValue: '1,234.50' }]
  )
  assert.deepEqual(parseCellset(cs, {}, [], false).grid, [['1234.5']])
})

test('buildGridData produces colDefs + rowData with keys', () => {
  const parsed = { cols: ['FY25'], rows: [['Admin'], ['IT']], rowDimNames: ['Cost Centre'], grid: [['100'], ['200']] }
  const { colDefs, rowData } = buildGridData(parsed)
  assert.equal(colDefs.length, 2) // 1 row dim + 1 data col
  assert.equal(colDefs[0].field, '__row_0__')
  assert.equal(colDefs[0].headerName, 'Cost Centre')
  assert.equal(colDefs[1].field, 'c0')
  assert.equal(rowData.length, 2)
  assert.equal(rowData[0].__tupleKey__, 'Admin')
  assert.equal(rowData[0].c0, '100')
  assert.equal(rowData[0].__ri__, 0)
})

test('lookupFormat falls back across dimensions', () => {
  const map = { 'Cost Centre': { Admin: '0.00' }, Other: { 'ENG-001': '1,000' } }
  assert.equal(lookupFormat('Cost Centre', 'Admin', map), '0.00')
  assert.equal(lookupFormat('Cost Centre', 'ENG-001', map), '1,000') // cross-dim fallback
  assert.equal(lookupFormat('Cost Centre', 'Missing', map), null)
})