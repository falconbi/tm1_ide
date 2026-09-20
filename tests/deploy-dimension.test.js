'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { dimensionSignature, compareDimensionSignature } = require('../tools/tm1deploy/src/diff')

const ELEMENTS = () => [
  { Name: 'Admin', Type: 'N' },
  { Name: 'Total', Type: 'C' },
]
const EDGES = () => [
  { ParentName: 'Total', ComponentName: 'Admin', Weight: 1 },
]

test('identical signatures → no drift', () => {
  const a = dimensionSignature(ELEMENTS(), EDGES())
  const b = dimensionSignature(ELEMENTS(), EDGES())
  const d = compareDimensionSignature(a, b)
  assert.equal(d.addedElements.length + d.removedElements.length + d.addedEdges.length + d.removedEdges.length, 0)
})

test('re-parent (edge change) is detected even with same elements', () => {
  const base = dimensionSignature(ELEMENTS(), EDGES())
  const cur = dimensionSignature(ELEMENTS(), [{ ParentName: 'Other', ComponentName: 'Admin', Weight: 1 }])
  const d = compareDimensionSignature(base, cur)
  assert.equal(d.addedEdges.length, 1)
  assert.equal(d.removedEdges.length, 1)
  assert.equal(d.addedElements.length + d.removedElements.length, 0) // names unchanged
})

test('weight change is detected', () => {
  const base = dimensionSignature(ELEMENTS(), EDGES())
  const cur = dimensionSignature(ELEMENTS(), [{ ParentName: 'Total', ComponentName: 'Admin', Weight: 0.5 }])
  const d = compareDimensionSignature(base, cur)
  assert.equal(d.addedEdges.length, 1)
  assert.equal(d.removedEdges.length, 1)
})

test('type flip is detected', () => {
  const base = dimensionSignature(ELEMENTS(), EDGES())
  const cur = dimensionSignature([{ Name: 'Admin', Type: 'C' }, { Name: 'Total', Type: 'C' }], EDGES())
  const d = compareDimensionSignature(base, cur)
  assert.equal(d.addedElements.length, 1)
  assert.equal(d.removedElements.length, 1)
})

test('added element is detected', () => {
  const base = dimensionSignature(ELEMENTS(), EDGES())
  const cur = dimensionSignature([...ELEMENTS(), { Name: 'New', Type: 'N' }], EDGES())
  const d = compareDimensionSignature(base, cur)
  assert.equal(d.addedElements.length, 1)
  assert.equal(d.addedElements[0], 'New:N')
})