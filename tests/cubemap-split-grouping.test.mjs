import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePrefixGroups } from '../client/src/lib/cubemap-editor/grouping.js'

test('prefix groups are case-insensitive and need at least two members', () => {
  const groups = computePrefixGroups(['Con_A', 'CON_B', 'Other_X', 'Solo_Y'])
  assert.deepEqual(Object.keys(groups), ['CON'])
  assert.deepEqual(groups.CON.sort(), ['CON_B', 'Con_A'])
})

test('a regex uses its capture group as the key', () => {
  const groups = computePrefixGroups(['WFP Cost', 'WFP Headcount'], '^(WFP) ')
  assert.deepEqual(groups.WFP, ['WFP Cost', 'WFP Headcount'])
})
