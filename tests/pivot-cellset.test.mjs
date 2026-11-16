import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCellset, isConsolidatedType, parseDimFromUniqueName } from '../client/src/lib/cellset.js'

function member(name, dim, type = 'N') {
  return { Name: name, UniqueName: `[${dim}].[${dim}].[${name}]`, Type: type }
}

function cellset(cols, rows, cells) {
  return {
    Axes: [
      { Ordinal: 0, Tuples: cols.map(cs => ({ Members: cs })) },
      { Ordinal: 1, Tuples: rows.map(rs => ({ Members: rs })) },
    ],
    Cells: cells,
  }
}

test('parseCellset builds grid from axes + cells', () => {
  const cs = cellset(
    [[member('FY25', 'Period')], [member('FY26', 'Period')]],
    [[member('Admin', 'Cost Centre')], [member('IT', 'Cost Centre')]],
    [
      { Ordinal: 0, Value: 100, FormattedValue: '100.00' },
      { Ordinal: 1, Value: 200, FormattedValue: '200.00' },
      { Ordinal: 2, Value: 300, FormattedValue: '300.00' },
      { Ordinal: 3, Value: 400, FormattedValue: '400.00' },
    ]
  )
  const p = parseCellset(cs)
  assert.deepEqual(p.cols, ['FY25', 'FY26'])
  assert.deepEqual(p.rows, [['Admin'], ['IT']])
  assert.deepEqual(p.rowDimNames, ['Cost Centre'])
  assert.deepEqual(p.colDimNames, ['Period'])
  assert.deepEqual(p.grid, [['100.00', '200.00'], ['300.00', '400.00']])
  assert.deepEqual(p.cellUpdateable, [[true, true], [true, true]])
})

test('parseCellset numFormat off returns raw Value', () => {
  const cs = cellset(
    [[member('FY25', 'Period')]],
    [[member('Admin', 'Cost Centre')]],
    [{ Ordinal: 0, Value: 1234.5, FormattedValue: '1,234.50' }]
  )
  assert.deepEqual(parseCellset(cs, true).grid, [['1,234.50']])
  assert.deepEqual(parseCellset(cs, false).grid, [[1234.5]])
})

test('parseCellset marks consolidated rows/columns as not updateable', () => {
  const cs = cellset(
    [[member('Total', 'Measure', 'C')]],
    [[member('Admin', 'Cost Centre', 'C')]],
    [{ Ordinal: 0, Value: 99, FormattedValue: '99' }]
  )
  const p = parseCellset(cs)
  assert.deepEqual(p.colIsConsolidated, [true])
  assert.deepEqual(p.rowIsConsolidated, [true])
  assert.deepEqual(p.cellUpdateable, [[false]])
})

test('parseCellset builds cell coords with dim + name', () => {
  const cs = cellset(
    [[member('FY25', 'Period')]],
    [[member('Admin', 'Cost Centre')]],
    [{ Ordinal: 0, Value: 1, FormattedValue: '1' }]
  )
  const p = parseCellset(cs)
  assert.deepEqual(p.cellCoords, [[[
    { dim: 'Cost Centre', name: 'Admin' },
    { dim: 'Period', name: 'FY25' },
  ]]])
})

test('parseCellset returns null without a column axis', () => {
  assert.equal(parseCellset({ Axes: [] }), null)
  assert.equal(parseCellset(null), null)
})

test('isConsolidatedType', () => {
  assert.ok(isConsolidatedType('C'))
  assert.ok(isConsolidatedType('c'))
  assert.ok(isConsolidatedType(3))
  assert.ok(isConsolidatedType('Consolidated'))
  assert.ok(!isConsolidatedType('N'))
  assert.ok(!isConsolidatedType(null))
})

test('parseDimFromUniqueName', () => {
  assert.equal(parseDimFromUniqueName('[Cost Centre].[Cost Centre].[Admin]'), 'Cost Centre')
  assert.equal(parseDimFromUniqueName(undefined), '')
})