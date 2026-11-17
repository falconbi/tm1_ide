import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildElementTree } from '../client/src/lib/view-editor/member-tree.js'

test('builds explicit parent/child trees, including one element under two parents', () => {
  const tree = buildElementTree([
    { Name: 'All', Components: ['North', 'South'] },
    { Name: 'North', Components: ['100'] },
    { Name: 'South', Components: ['100'] },
    { Name: '100' },
  ])
  assert.deepEqual(tree.map(n => n.Name), ['All'])
  assert.deepEqual(tree[0].children.map(n => n.Name), ['North', 'South'])
  assert.equal(tree[0].children[0].children[0].Name, '100')
  assert.equal(tree[0].children[1].children[0].Name, '100')
})
