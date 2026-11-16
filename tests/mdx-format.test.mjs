// One formatter, two outputs. These fixtures are the exact output of the old
// local copies, so switching the editors over does not change formatting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMDX } from '../client/src/lib/mdx-format.js'

test('statement mode lays out SELECT / ON / FROM / WHERE', () => {
  assert.equal(
    formatMDX('SELECT {A, B} ON COLUMNS FROM [C] WHERE ([V].[Budget])'),
    'SELECT\n  {\n    A,\n     B\n  } ON COLUMNS\nFROM [C]\nWHERE ([V].[Budget])',
  )
})

test('set mode lays out braces and commas only', () => {
  assert.equal(formatMDX('{A, B}', { mode: 'set' }), '{\n  A,\n   B\n}')
})

test('empty input is returned as-is', () => {
  assert.equal(formatMDX(''), '')
  assert.equal(formatMDX(null), null)
})
