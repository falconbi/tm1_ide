// core/mdxBuilder.js — layout (rows, columns, filters) → MDX. Pinned before it
// moves into the shared pivot (docs/PIVOT_PLAN.md). `todo` = known bug, right answer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMDX } from '../core/mdxBuilder.js'

const one = s => s.replace(/\s+/g, ' ').trim()

test('rows and columns, empty rows suppressed by default', () => {
  const mdx = one(buildMDX({ cube: 'Sales', rows: [{ dimension: 'Region', memberSet: 'all' }], columns: [{ dimension: 'Month', members: ['Jan', 'Feb'] }] }))
  assert.equal(mdx, 'SELECT {[Month].[Month].[Jan], [Month].[Month].[Feb]} ON COLUMNS, NON EMPTY {TM1SUBSETALL([Region].[Region])} ON ROWS FROM [Sales]')
})

test('suppression: none, columns, all', () => {
  const base = { cube: 'C', rows: [{ dimension: 'R', memberSet: 'leaf' }], columns: [{ dimension: 'K', member: 'a' }] }
  assert.ok(!one(buildMDX({ ...base, suppressZeros: 'none' })).includes('NON EMPTY'))
  assert.match(one(buildMDX({ ...base, suppressZeros: 'columns' })), /^SELECT NON EMPTY \{\[K\]\.\[K\]\.\[a\]\} ON COLUMNS, \{TM1FILTERBYLEVEL/)
  assert.equal((one(buildMDX({ ...base, suppressZeros: 'all' })).match(/NON EMPTY/g) || []).length, 2)
})

test('member sets: leaves, top member, a named subset, everything', () => {
  const ax = d => one(buildMDX({ cube: 'C', columns: [d], suppressZeros: 'none' }))
  assert.match(ax({ dimension: 'D', memberSet: 'leaf' }), /\{TM1FILTERBYLEVEL\(\{\[D\]\.\[D\]\.Members\}, 0\)\} ON COLUMNS/)
  assert.match(ax({ dimension: 'D', memberSet: 'root' }), /\{\[D\]\.\[D\]\.DefaultMember\}/)
  assert.match(ax({ dimension: 'D', subset: 'My subset' }), /TM1SubsetToSet\(\[D\]\.\[D\], "My subset", "public"\)/)
  assert.match(ax({ dimension: 'D' }), /\{\[D\]\.\[D\]\.Members\}/)
  assert.match(ax({ dimension: 'D', customExpr: '{[D].[D].[x]}' }), /^SELECT \{\[D\]\.\[D\]\.\[x\]\} ON COLUMNS/)
})

test('three dimensions on one axis nest CrossJoin (TM1 takes two at a time)', () => {
  const mdx = one(buildMDX({ cube: 'C', suppressZeros: 'none', rows: ['A', 'B', 'E'].map(d => ({ dimension: d, member: 'x' })) }))
  assert.match(mdx, /CrossJoin\(CrossJoin\(\{\[A\]\.\[A\]\.\[x\]\}, \{\[B\]\.\[B\]\.\[x\]\}\), \{\[E\]\.\[E\]\.\[x\]\}\) ON ROWS/)
})

test('filters (pages) and unplaced dimensions (bench) go in WHERE; bench defaults to the default member', () => {
  const mdx = one(buildMDX({ cube: 'C', columns: [{ dimension: 'K', member: 'a' }], suppressZeros: 'none',
    pages: [{ dimension: 'Version', member: 'Forecast' }, { dimension: 'Skip' }],
    bench: [{ dimension: 'Currency' }, { dimension: 'Entity', members: ['UK', 'US'] }] }))
  assert.match(mdx, /WHERE \(\[Version\]\.\[Version\]\.\[Forecast\], \[Currency\]\.\[Currency\]\.DefaultMember, \{\[Entity\]\.\[Entity\]\.\[UK\], \[Entity\]\.\[Entity\]\.\[US\]\}\)$/)
  assert.ok(!mdx.includes('[Skip]'), 'a page with no member is left out')
})

test('no rows: a single-axis query', () => {
  assert.equal(one(buildMDX({ cube: 'C', columns: [{ dimension: 'K', member: 'a' }], suppressZeros: 'none' })), 'SELECT {[K].[K].[a]} ON COLUMNS FROM [C]')
})

test('bug 3: names containing ] are escaped as ]] (otherwise the MDX breaks)',
  { todo: 'bug 3 — escape names in the shared pivot (docs/PIVOT_PLAN.md)' }, () => {
  const mdx = one(buildMDX({ cube: 'C', columns: [{ dimension: 'K', member: 'a]b' }], suppressZeros: 'none' }))
  assert.match(mdx, /\[K\]\.\[K\]\.\[a\]\]b\]/)
})

test('bug 3: a subset name containing " is quoted safely',
  { todo: 'bug 3 — escape names in the shared pivot (docs/PIVOT_PLAN.md)' }, () => {
  const mdx = one(buildMDX({ cube: 'C', columns: [{ dimension: 'K', subset: 'Say "hi"' }], suppressZeros: 'none' }))
  assert.match(mdx, /"Say ""hi"""/)
})
