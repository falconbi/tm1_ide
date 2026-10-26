'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup, fakeTm1 } = require('./_mcp-harness')

// The MCP tool must use the same Period Builder generator as the IDE, and save
// exactly the three processes the UI creates.
test('build_period_dimension saves the three Period Builder processes', async () => {
  const made = []
  const builder = fakeTm1('builder', {
    async getProcess() { throw Object.assign(new Error('not found'), { response: { status: 404 } }) },
    async createOrReplaceProcess(p) { made.push(p); return { Name: p.name } },
  })
  const h = setup({ mode: 'build', builder })
  const r = await h.call('build_period_dimension', {
    dimensionName: 'Test Period',
    fyStartMonth: 4,
    firstFY: 2026,
    lastFY: 2027,
    selectedSubsets: ['all-periods', 'all-fy', 'current-period', 'current-fy', 'ytd'],
  })
  assert.equal(r.isError, false, r.text)
  assert.deepEqual(made.map(p => p.name), [
    'Test Period.Build Period Dimension',
    'Test Period.Refresh Subsets',
    'Test Period.Rollover',
  ])
  assert.match(made[0].prolog, /Test Period/)
  assert.ok(made[0].parameters.some(p => p.Name === 'pCurrentPeriod'))
  assert.equal(r.data.saved.length, 3)
  assert.ok(h.changes.length >= 3)
})
