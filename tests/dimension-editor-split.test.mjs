import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTree, isUnder, buildTreeOrder } from '../client/src/lib/dimension-editor/tree.js'
import { parseTabDelimited } from '../client/src/lib/dimension-editor/structure.js'

const el = (Name, Type, Index) => ({ Name, Type, Index })
const edge = (ParentName, ComponentName) => ({ ParentName, ComponentName })

test('build tree: roots come from element order, children from edges, shared child is under both', () => {
  const elements = [el('Total', 'C', 1), el('A', 'N', 2), el('B', 'C', 3), el('Shared', 'N', 4)]
  const edges = [edge('Total', 'A'), edge('Total', 'B'), edge('B', 'Shared')]
  const tree = buildTree(elements, edges)
  assert.deepEqual(tree.roots, ['Total'])
  assert.deepEqual(tree.childrenOf.Total, ['A', 'B'])
  assert.deepEqual(tree.childrenOf.B, ['Shared'])
  assert.deepEqual(Object.keys(tree.byName).sort(), ['A', 'B', 'Shared', 'Total'])
})

test('build tree: a second parent does not make the child a root again', () => {
  const elements = [el('P1', 'C', 1), el('P2', 'C', 2), el('Child', 'N', 3)]
  const edges = [edge('P1', 'Child'), edge('P2', 'Child')]
  const tree = buildTree(elements, edges)
  assert.deepEqual(tree.roots, ['P1', 'P2'])
  assert.deepEqual(tree.childrenOf.P1, ['Child'])
  assert.deepEqual(tree.childrenOf.P2, ['Child'])
})

test('build tree: an edge naming an element that is not in the list is kept as an orphan edge', () => {
  const elements = [el('A', 'C', 1), el('C', 'N', 2)]
  const edges = [edge('A', 'Missing')]
  const tree = buildTree(elements, edges)
  assert.deepEqual(tree.roots, ['A', 'C'])
  assert.deepEqual(tree.childrenOf.A, ['Missing'])
  assert.equal(tree.byName.Missing, undefined)
})

test('is under: walks down more than one level', () => {
  const childrenOf = { A: ['B'], B: ['C'] }
  assert.equal(isUnder(childrenOf, 'A', 'C'), true)
  assert.equal(isUnder(childrenOf, 'A', 'Z'), false)
})

test('is under: a cycle terminates instead of looping', () => {
  const childrenOf = { A: ['B'], B: ['A'] }
  assert.equal(isUnder(childrenOf, 'A', 'A'), true)
  assert.equal(isUnder(childrenOf, 'A', 'Z'), false)
})

test('tree order: depth-first by index, with unreachable elements last', () => {
  const elements = [el('Root', 'C', 2), el('First', 'N', 1), el('Child', 'N', 3), el('Loose', 'N', 4)]
  const edges = [edge('Root', 'Child')]
  const order = buildTreeOrder(elements, edges)
  assert.deepEqual(order.map(e => [e.Name, e.depth]), [
    ['First', 0],
    ['Root', 0],
    ['Child', 1],
    ['Loose', 0],
  ])
})

test('tree order: a shared child appears once, under its first parent', () => {
  const elements = [el('P1', 'C', 1), el('P2', 'C', 2), el('Shared', 'N', 3)]
  const edges = [edge('P1', 'Shared'), edge('P2', 'Shared')]
  const order = buildTreeOrder(elements, edges)
  assert.deepEqual(order.map(e => [e.Name, e.depth]), [
    ['P1', 0],
    ['Shared', 1],
    ['P2', 0],
  ])
})

test('parse tab-delimited: blank lines are dropped and a missing type is N', () => {
  const rows = parseTabDelimited('LeafOne\n\nConsolOne\tC\n')
  assert.deepEqual(rows, [
    { name: 'LeafOne', type: 'N', parent: '', weight: 1 },
    { name: 'ConsolOne', type: 'C', parent: '', weight: 1 },
  ])
})

test('parse tab-delimited: a missing or bad weight becomes 1', () => {
  const rows = parseTabDelimited('LeafOne\tN\tTotal\nLeafTwo\tN\tTotal\tbad\nLeafThree\tN\tTotal\t2.5')
  assert.deepEqual(rows.map(r => r.weight), [1, 1, 2.5])
})
