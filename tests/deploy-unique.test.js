'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { uniqueObjects } = require('../tools/tm1deploy/src/diff')

test('uniqueObjects keeps the latest entry per object identity', () => {
  const entries = [
    { object_type: 'rules', object_name: 'C1', action: 'RULES_SAVED', timestamp: '2026-01-01T00:00:00Z', detail: null },
    { object_type: 'rules', object_name: 'C1', action: 'RULES_SAVED', timestamp: '2026-01-02T00:00:00Z', detail: null },
    { object_type: 'process', object_name: 'P1', action: 'PROCESS_SAVED', timestamp: '2026-01-03T00:00:00Z', detail: null },
  ]
  const out = uniqueObjects(entries)
  assert.equal(out.length, 2)
  const c1 = out.find(o => o.object_name === 'C1')
  assert.equal(c1.timestamp, '2026-01-02T00:00:00Z') // latest wins
})

test('uniqueObjects treats detail as identity for subsets/views/attributes', () => {
  const entries = [
    { object_type: 'subset', object_name: 'Default', action: 'SUBSET_SAVED', timestamp: '2026-01-01T00:00:00Z', detail: 'DimA' },
    { object_type: 'subset', object_name: 'Default', action: 'SUBSET_SAVED', timestamp: '2026-01-02T00:00:00Z', detail: 'DimB' },
  ]
  const out = uniqueObjects(entries)
  assert.equal(out.length, 2) // same name, different parent dim → two objects
})

test('uniqueObjects ignores detail for rules/process (free-text change note)', () => {
  const entries = [
    { object_type: 'rules', object_name: 'C1', action: 'RULES_SAVED', timestamp: '2026-01-01T00:00:00Z', detail: '2 elements' },
    { object_type: 'rules', object_name: 'C1', action: 'RULES_SAVED', timestamp: '2026-01-02T00:00:00Z', detail: '3 elements' },
  ]
  assert.equal(uniqueObjects(entries).length, 1)
})