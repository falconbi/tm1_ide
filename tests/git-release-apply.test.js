'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { applySubset, applyView, parseViewPlacement } = require('../core/git-restore')

const calls = []
const tm1 = {
  async saveSubset(dim, name, mdx, hier) { calls.push(['subset-mdx', dim, name, mdx, hier]) },
  async saveStaticSubset(dim, name, members, hier) { calls.push(['subset-static', dim, name, members, hier]) },
  async saveView(cube, name, mdx) { calls.push(['view-mdx', cube, name, mdx]) },
  async saveNativeView(cube, name, opts) { calls.push(['view-native', cube, name, opts]) },
}

test('applySubset keeps the MDX for a dynamic subset, elements for a static one', async () => {
  calls.length = 0
  await applySubset(tm1, { dim: 'DimA', hierarchy: 'DimA', name: 'MDXSub' }, JSON.stringify({ Expression: '{[DimA].[DimA].[X]}' }))
  await applySubset(tm1, { dim: 'DimA', hierarchy: 'DimA', name: 'StaticSub' },
    JSON.stringify({ Elements: [
      { '@id': "Dimensions('DimA')/Hierarchies('DimA')/Elements('X')" },
      { '@id': "Dimensions('DimA')/Hierarchies('DimA')/Elements('Y')" },
    ] }))
  assert.equal(calls[0][0], 'subset-mdx')
  assert.equal(calls[0][3], '{[DimA].[DimA].[X]}')
  assert.equal(calls[1][0], 'subset-static')
  assert.deepEqual(calls[1][3], ['X', 'Y'])
})

test('applyView keeps MDX for MDX views and rebuilds native views from placements', async () => {
  calls.length = 0
  await applyView(tm1, { cube: 'CubeA', name: 'MDXView' }, JSON.stringify({ '@type': 'MDXView', MDX: 'SELECT {[X].[X].[M]} ON COLUMNS FROM [CubeA]' }))
  await applyView(tm1, { cube: 'CubeA', name: 'NatView' }, JSON.stringify({
    '@type': 'NativeView',
    Columns: [{ Subset: { '@id': "Dimensions('D1')/Hierarchies('D1')/Subsets('S1')" } }],
    Rows: [{ Subset: { Hierarchy: { '@id': "Dimensions('D2')/Hierarchies('D2')" }, Expression: '{[D2].[D2].[E1]}' } }],
    Titles: [{ Subset: { Hierarchy: { '@id': "Dimensions('D3')/Hierarchies('D3')" }, Expression: '{[D3].[D3].[E3]}' }, Selected: { '@id': "Dimensions('D3')/Hierarchies('D3')/Elements('E3')" } }],
  }))
  assert.equal(calls[0][0], 'view-mdx')
  assert.equal(calls[0][3], 'SELECT {[X].[X].[M]} ON COLUMNS FROM [CubeA]')
  const n = calls[1]
  assert.equal(n[0], 'view-native')
  assert.deepEqual(n[3].columns, [{ dimension: 'D1', subset: 'S1' }])
  assert.deepEqual(n[3].rows, [{ dimension: 'D2', customExpr: '{[D2].[D2].[E1]}' }])
  assert.deepEqual(n[3].titles, [{ dimension: 'D3', customExpr: '{[D3].[D3].[E3]}', member: 'E3' }])
})

test('parseViewPlacement handles named subsets, expressions and selected members', () => {
  assert.deepEqual(parseViewPlacement({ Subset: { '@id': "Dimensions('D1')/Hierarchies('D1')/Subsets('S1')" } }), { dimension: 'D1', subset: 'S1' })
  assert.deepEqual(
    parseViewPlacement({ Subset: { Hierarchy: { '@id': "Dimensions('D2')/Hierarchies('D2')" }, Expression: '{[D2].[D2].[E]}' }, Selected: { '@id': "Dimensions('D2')/Hierarchies('D2')/Elements('E')" } }),
    { dimension: 'D2', customExpr: '{[D2].[D2].[E]}', member: 'E' })
})