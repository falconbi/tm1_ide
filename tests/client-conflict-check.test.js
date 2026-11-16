'use strict'
// useConflictCheck's decision is a pure function: another user's newer change log
// row than the editor's baseline is a conflict; your own row or the baseline is not.

const { test } = require('node:test')
const assert = require('node:assert/strict')

let conflictEntry
test('loads the pure decision', async () => {
  ({ conflictEntry } = await import('../client/src/lib/conflict.js'))
  assert.equal(typeof conflictEntry, 'function')
})

const row = (id, user) => ({ id, user, action: 'RULES_SAVED' })

test('no banner for your own change', () => {
  assert.equal(conflictEntry([row(2, 'me'), row(1, 'me')], 'me', 1), null)
})

test('a banner for another user\'s row newer than the baseline', () => {
  const latest = row(2, 'bob')
  assert.equal(conflictEntry([latest, row(1, 'me')], 'me', 1), latest)
})

test('no banner when the latest row is the baseline', () => {
  assert.equal(conflictEntry([row(1, 'bob')], 'me', 1), null)
})

test('no banner without a user or history', () => {
  assert.equal(conflictEntry([row(2, 'bob')], '', 1), null)
  assert.equal(conflictEntry([], 'me', 1), null)
})
