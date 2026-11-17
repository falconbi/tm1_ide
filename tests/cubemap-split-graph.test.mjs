import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReverseMap, getReachable } from '../client/src/lib/cubemap-editor/graph.js'

const ctx = () => {
  const cubeData = {
    A: { ruleCalcRefs: ['B'], ruleFeederRefs: [], tiReaders: [], tiWriters: [] },
    B: { ruleCalcRefs: [], ruleFeederRefs: [], tiReaders: [], tiWriters: ['Load'] },
  }
  const processData = { Load: { reads: ['A'], writes: ['B'], dimWrites: [], calls: [] } }
  return { cubeData, processData, dimData: {}, reverseMap: buildReverseMap(cubeData), processCallers: {} }
}

test('reachability follows rule and process edges by kind', () => {
  const c = ctx()
  const ruleOnly = getReachable(['A'], 2, { rule: true }, c)
  assert.deepEqual([...ruleOnly].sort(), ['A', 'B'])
  const withWrites = getReachable(['A'], 3, { rule: true, write: true }, c)
  assert.deepEqual([...withWrites].sort(), ['A', 'B', 'proc:Load'])
})
