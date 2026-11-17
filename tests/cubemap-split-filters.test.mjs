import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyLensActions, processRoots, foldProcesses, narrowToDim } from '../client/src/lib/cubemap-editor/filters.js'

test('process roots follow caller chains', () => {
  const roots = processRoots({ Main: {}, Helper: {} }, { Helper: ['Main'] })
  assert.deepEqual([...roots.Helper], ['Main'])
  assert.deepEqual([...roots.Main], ['Main'])
})

test('a helper folds into its root unless the chain is expanded', () => {
  const nodes = [{ id: 'proc:Main', type: 'process', data: {} }, { id: 'proc:Helper', type: 'process', data: {} }]
  const edges = [{ id: 'call', type: 'call', source: 'proc:Main', target: 'proc:Helper' }]
  const folded = foldProcesses(nodes, edges, { Main: new Set(['Main']), Helper: new Set(['Main']) }, new Set(), () => {})
  assert.deepEqual(folded.nodes.map(n => n.id), ['proc:Main'])
})

test('lens actions can hide Lens-only helper processes', () => {
  const out = applyLensActions(
    [{ id: 'proc:LensRun', type: 'process', data: {} }, { id: 'proc:Main', type: 'process', data: {} }],
    [], { LensRun: ['Lens'] }, {}, false
  )
  assert.deepEqual(out.nodes.map(n => n.id), ['proc:Main'])
})

test('dimension narrowing keeps the dimension, its cubes and their processes', () => {
  const set = new Set(['A', 'B', 'proc:Load', 'dim:Dim1', 'dim:Other'])
  const out = narrowToDim(set, 'Dim1', ['A'], { A: { dims: ['Dim1'] }, B: { dims: ['Other'] } }, { Load: { reads: ['A'], writes: [] } })
  assert.deepEqual([...out].sort(), ['A', 'dim:Dim1', 'proc:Load'])
})
