import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDagreLayout } from '../client/src/lib/cubemap-editor/layout.js'

test('DAGRE layout gives every node a position', () => {
  const out = applyDagreLayout(
    [{ id: 'A' }, { id: 'B' }],
    [{ source: 'A', target: 'B' }]
  )
  assert.equal(out.length, 2)
  for (const node of out) assert.equal(typeof node.position.x, 'number')
})
