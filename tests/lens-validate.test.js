'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateLens } = require('../core/lens_bridge')

// The save-time check test-runs every literal MDX it finds in a Lens. A query
// built in pieces at runtime ('SELECT … {' + member + …) must not be run as a
// fragment — that would fail falsely and block a valid Lens.
function fakeClient(log) {
  return {
    async executeMDX(mdx) { log.push(mdx); if (!/FROM \[/.test(mdx)) throw new Error('Syntax error'); return { Cells: [] } },
    async getModelCubes() { return ['Sales'] },
  }
}

test('a complete literal query is test-run', async () => {
  const log = []
  const errors = await validateLens(fakeClient(log), "bridge.call('execMDX', { mdx: 'SELECT {[M].[M].[A]} ON 0 FROM [Sales]' })")
  assert.deepEqual(errors, [])
  assert.equal(log.length, 1)
})

test('a query started as a literal and joined at runtime is skipped, not run as a fragment', async () => {
  const log = []
  const html = "bridge.call('execMDX', { mdx: 'SELECT {' + members + '} ON 0 FROM [Sales]' })"
  const errors = await validateLens(fakeClient(log), html)
  assert.deepEqual(errors, [])
  assert.equal(log.length, 0)
})

test('a broken complete query is still reported', async () => {
  const log = []
  const errors = await validateLens(fakeClient(log), "bridge.call('execMDX', { mdx: 'SELECT nonsense' })")
  assert.equal(errors.length, 1)
  assert.match(errors[0], /MDX failed/)
})
