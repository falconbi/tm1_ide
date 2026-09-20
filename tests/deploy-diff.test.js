'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { lineDiff, lineDiffNote } = require('../tools/tm1deploy/src/diff')

test('lineDiff identical text → empty', () => {
  const d = lineDiff('SKIPCHECK;\n["a"] = N: 1;', 'SKIPCHECK;\n["a"] = N: 1;')
  assert.deepEqual(d, { added: [], removed: [] })
  assert.equal(lineDiffNote(d), '')
})

test('lineDiff detects a modified line as remove + add', () => {
  const d = lineDiff(
    'SKIPCHECK;\n["a"] = N: 1;',
    'SKIPCHECK;\n["a"] = N: 2;'
  )
  assert.deepEqual(d.removed, ['["a"] = N: 1;'])
  assert.deepEqual(d.added, ['["a"] = N: 2;'])
})

test('lineDiff detects added and removed lines', () => {
  const d = lineDiff(
    '["a"] = N: 1;',
    '["a"] = N: 1;\n["b"] = N: 2;\n["c"] = N: 3;'
  )
  assert.deepEqual(d.added, ['["b"] = N: 2;', '["c"] = N: 3;'])
  assert.deepEqual(d.removed, [])
})

test('lineDiff large input falls back to set-based approximation', () => {
  // > 12M cells → set-based path (no LCS), must still return added/removed
  const a = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')
  const b = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n') + '\nline extra'
  const d = lineDiff(a, b)
  assert.ok(Array.isArray(d.added))
  assert.ok(Array.isArray(d.removed))
})

test('lineDiffNote formats counts', () => {
  assert.equal(lineDiffNote({ added: ['a'], removed: ['b'] }), '+1 line / −1 line')
  assert.equal(lineDiffNote({ added: ['a', 'b'], removed: [] }), '+2 lines')
})