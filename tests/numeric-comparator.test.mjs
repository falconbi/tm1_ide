import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tm1NumericComparator } from '../client/src/lib/utils.js'

test('sorts formatted TM1 numbers numerically', () => {
  // '1,000' must sort AFTER '999' (not alphabetically)
  assert.ok(tm1NumericComparator('999', '1,000') < 0)
  assert.ok(tm1NumericComparator('1,000', '999') > 0)
})

test('handles brackets, percentages, currency and negatives', () => {
  assert.ok(tm1NumericComparator('(5)', '10') < 0)             // (5) = -5 → below 10
  assert.ok(tm1NumericComparator('(5)', '-5') === 0)           // both -5
  assert.ok(tm1NumericComparator('£100', '99') > 0)
  assert.ok(tm1NumericComparator('-5', '-10') > 0)             // -5 > -10
})

test('non-numeric values sort last', () => {
  assert.ok(tm1NumericComparator('N/A', '100') > 0)
  assert.equal(tm1NumericComparator('N/A', 'x'), 0)
})

test('identical values are equal', () => {
  assert.equal(tm1NumericComparator('123', '123'), 0)
})