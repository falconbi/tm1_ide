import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectComplexMDX, viewerAxesToBuilderConfig } from '../client/src/lib/view-editor/complex-mdx.js'

test('detects a complex MDX function and leaves plain MDX alone', () => {
  assert.deepEqual(detectComplexMDX('SELECT FILTER([Account].Members, 1) ON 0 FROM [Plan]'), ['FILTER'])
  assert.equal(detectComplexMDX('SELECT {[Account].[Account].[100]} ON 0 FROM [Plan]'), null)
})

test('converts rows, columns and titles to builder config', () => {
  const cfg = viewerAxesToBuilderConfig({
    rows: [{ dimension: 'Account', member: '100' }],
    columns: [{ dimension: 'Period', members: ['Jan', 'Feb'] }],
    pages: [{ dimension: 'Version', member: 'Actual' }],
  })
  assert.equal(cfg.Account.axis, 'rows')
  assert.equal(cfg.Account.subsetExpression, '{[Account].[Account].[100]}')
  assert.equal(cfg.Period.subsetExpression, '{[Period].[Period].[Jan], [Period].[Period].[Feb]}')
  assert.equal(cfg.Version.axis, 'filter')
  assert.equal(cfg.Version.subsetExpression, 'Actual')
})
