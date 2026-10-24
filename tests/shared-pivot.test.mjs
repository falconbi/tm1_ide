// Shared pivot — the pure parts (shared/pivot): drill-down, MDX, cellset → pivot data.
// The behaviour first pinned for the IDE's old copy (pivot-tree / mdx-builder tests, now gone),
// with bugs 1, 2, 3, 6 and items 12, 13 of docs/lenses/PIVOT_PLAN.md fixed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildHierarchy, constrainHierarchy, allExpanded, initExpandedSets, computeVisibleNodes, computeVisibleTuples,
  tuplePrefixes, toggleExpanded, setAllExpanded, tupleIsLeaf, indentFor, changedFlags,
} from '../shared/pivot/tree.js'
import { buildMDX } from '../shared/pivot/mdx.js'
import { cellsetToPivot, membersByPosition, elementOf } from '../shared/pivot/cellset.js'

const periodEls = [
  { Name: 'FY', Type: 'C', Level: 3, Components: ['H1', 'H2'] },
  { Name: 'H1', Type: 'C', Level: 2, Components: ['Q1', 'Q2'] },
  { Name: 'H2', Type: 'C', Level: 2, Components: ['Q3'] },
  { Name: 'Q1', Type: 'C', Level: 1, Components: ['Jan', 'Feb'] },
  { Name: 'Q2', Type: 'C', Level: 1, Components: ['Apr'] },
  { Name: 'Q3', Type: 'C', Level: 1, Components: ['Jul'] },
  { Name: 'Jan', Type: 'N', Level: 0 }, { Name: 'Feb', Type: 'N', Level: 0 },
  { Name: 'Apr', Type: 'N', Level: 0 }, { Name: 'Jul', Type: 'N', Level: 0 },
]
const regionEls = [
  { Name: 'All', Type: 'C', Level: 2, Components: ['North', 'Solo'] },
  { Name: 'North', Type: 'C', Level: 1, Components: ['N1', 'N2'] },
  { Name: 'N1', Type: 'N', Level: 0 }, { Name: 'N2', Type: 'N', Level: 0 }, { Name: 'Solo', Type: 'N', Level: 0 },
]
const period = buildHierarchy(periodEls, 'Period')
const region = buildHierarchy(regionEls, 'Region')

// ── tree ───────────────────────────────────────────────────────────────────
test('a tree from TM1 elements: roots, children, leaves, levels and depth from the top', () => {
  assert.deepEqual(period.roots, ['FY'])
  assert.equal(period.nodes.Q1.isLeaf, false)
  assert.equal(period.nodes.Jan.depth, 3)
  assert.equal(period.maxDepth, 3)
  assert.equal(region.nodes.Solo.depth, 1)
  assert.equal(buildHierarchy([], 'X'), null)
})

test('drill-down rows: same results as the IDE copy (parents above / below, replace, collapsed)', () => {
  const all = allExpanded(period.nodes)
  assert.deepEqual(computeVisibleNodes(period.roots, period.nodes, all, 'parent'), ['FY', 'H1', 'Q1', 'Jan', 'Feb', 'Q2', 'Apr', 'H2', 'Q3', 'Jul'])
  assert.deepEqual(computeVisibleNodes(period.roots, period.nodes, all, 'parent', true), ['Jan', 'Feb', 'Q1', 'Apr', 'Q2', 'H1', 'Jul', 'Q3', 'H2', 'FY'])
  assert.deepEqual(computeVisibleNodes(period.roots, period.nodes, all, 'replace'), ['Jan', 'Feb', 'Apr', 'Jul'])
  assert.deepEqual(computeVisibleNodes(period.roots, period.nodes, new Set(['FY', 'H1']), 'parent'), ['FY', 'H1', 'Q1', 'Q2', 'H2'])
})

test('the inner dimension remembers its drill-down per outer member; toggling one leaves the others', () => {
  let sets = initExpandedSets([region, period])
  sets = toggleExpanded([region, period], sets, 1, 'FY', 'N1')       // close FY under N1 only
  const rows = computeVisibleTuples([region, period], sets, 'parent').map(t => t.join('/'))
  assert.ok(rows.includes('N1/FY') && !rows.includes('N1/H1'))
  assert.ok(rows.includes('N2/H1') && rows.includes('Solo/Jul'))
  sets = setAllExpanded([region, period], sets, 1, false)            // collapse Period everywhere
  assert.ok(computeVisibleTuples([region, period], sets, 'parent').every(t => t[1] === 'FY'))
  sets = toggleExpanded([region, period], sets, 1, 'FY', 'N2')       // reopen FY under N2 only
  const again = computeVisibleTuples([region, period], sets, 'parent').map(t => t.join('/'))
  assert.ok(again.includes('N2/H1') && !again.includes('N1/H1'))
})

test('scale: only combinations that have data are walked — same order, far fewer rows', () => {
  const sets = initExpandedSets([region, period])
  const keys = ['All::FY', 'North::Q1', 'N1::Jan', 'Solo::Jul']
  const pruned = computeVisibleTuples([region, period], sets, 'parent', false, tuplePrefixes(keys)).map(t => t.join('::'))
  assert.deepEqual(pruned, ['All::FY', 'North::Q1', 'N1::Jan', 'Solo::Jul'])
  const full = computeVisibleTuples([region, period], sets, 'parent').map(t => t.join('::'))
  assert.equal(full.length, 50)
  assert.deepEqual(full.filter(k => keys.includes(k)), pruned, 'same order as the full walk')
})

test('bug 6 fixed: a total whose children were filtered out stays a total', () => {
  const pruned = constrainHierarchy(period, ['FY', 'H1'])
  assert.equal(pruned.nodes.H1.isLeaf, false)
  assert.deepEqual(pruned.nodes.H1.children, [])
  assert.deepEqual(pruned.roots, ['FY'])
  const sub = constrainHierarchy(period, ['Q1', 'Jan'])              // top filtered out: Q1 becomes the top
  assert.equal(sub.nodes.Q1.depth, 0)
  assert.equal(sub.nodes.Jan.depth, 1)
})

test('bug 2 fixed: indent by depth from the top, even in uneven trees', () => {
  assert.equal(indentFor(region.nodes.Solo), 14)
  assert.equal(indentFor(region.nodes.N1), 28)
  assert.equal(indentFor(period.nodes.Jan), 42)
})

test('bug 1 fixed: a column is a total if ANY of its members is a total', () => {
  assert.equal(tupleIsLeaf(['North', 'Q1'], [region, period]), false)
  assert.equal(tupleIsLeaf(['N1', 'Q1'], [region, period]), false)
  assert.equal(tupleIsLeaf(['N1', 'Jan'], [region, period]), true)
  assert.equal(tupleIsLeaf(['Unknown'], [region]), true)
})

test('repeated outer labels: which positions changed from the tuple before', () => {
  assert.deepEqual(changedFlags([['A', 'x'], ['A', 'y'], ['B', 'y']]), [[true, true], [false, true], [true, false]])
})

// ── mdx ────────────────────────────────────────────────────────────────────
const one = s => s.replace(/\s+/g, ' ').trim()
test('MDX: same output as the IDE builder for ordinary names', () => {
  assert.equal(one(buildMDX({ cube: 'Sales', rows: [{ dimension: 'Region', memberSet: 'all' }], columns: [{ dimension: 'Month', members: ['Jan', 'Feb'] }] })),
    'SELECT {[Month].[Month].[Jan], [Month].[Month].[Feb]} ON COLUMNS, NON EMPTY {TM1SUBSETALL([Region].[Region])} ON ROWS FROM [Sales]')
  assert.match(one(buildMDX({ cube: 'C', suppressZeros: 'none', rows: ['A', 'B', 'E'].map(d => ({ dimension: d, member: 'x' })) })),
    /CrossJoin\(CrossJoin\(\{\[A\]\.\[A\]\.\[x\]\}, \{\[B\]\.\[B\]\.\[x\]\}\), \{\[E\]\.\[E\]\.\[x\]\}\) ON ROWS/)
  assert.match(one(buildMDX({ cube: 'C', columns: [{ dimension: 'K', member: 'a' }], suppressZeros: 'none', pages: [{ dimension: 'V', member: 'F' }], bench: [{ dimension: 'Cur' }] })),
    /WHERE \(\[V\]\.\[V\]\.\[F\], \[Cur\]\.\[Cur\]\.DefaultMember\)$/)
})

test('bug 3 fixed: names with ] and " are escaped; hierarchies can be named', () => {
  const mdx = one(buildMDX({ cube: 'C]x', suppressZeros: 'none', columns: [{ dimension: 'K', member: 'a]b' }], rows: [{ dimension: 'R', subset: 'Say "hi"' }] }))
  assert.match(mdx, /\[K\]\.\[K\]\.\[a\]\]b\]/)
  assert.match(mdx, /TM1SubsetToSet\(\[R\]\.\[R\], "Say ""hi""", "public"\)/)
  assert.match(mdx, /FROM \[C\]\]x\]/)
  assert.match(one(buildMDX({ cube: 'C', columns: [{ dimension: 'Period', hierarchy: 'Fiscal', member: 'Q1' }], suppressZeros: 'none' })), /\[Period\]\.\[Fiscal\]\.\[Q1\]/)
})

// ── cellset ────────────────────────────────────────────────────────────────
const m = (name, dim) => ({ Name: name, UniqueName: `[${dim}].[${dim}].[${String(name).replace(/]/g, ']]')}]` })
const cs = (rows, cols, cells) => ({ Axes: [{ Ordinal: 0, Tuples: cols.map(c => ({ Members: c })) }, { Ordinal: 1, Tuples: rows.map(r => ({ Members: r })) }], Cells: cells })

test('items 12 + 13 fixed: each cell keeps its real value, its display text and its kind', () => {
  const p = cellsetToPivot(cs([[m('N1', 'Region')], [m('North', 'Region')]], [[m('Jan', 'Period')], [m('Q1', 'Period')]], [
    { Ordinal: 0, Value: 1234.5, FormattedValue: '1,234.50', Updateable: 1 },
    { Ordinal: 1, Value: 5, FormattedValue: '5', RuleDerived: true, Updateable: 0 },
    { Ordinal: 2, Value: 10, FormattedValue: '10', Consolidated: true },
    { Ordinal: 3, Value: null, FormattedValue: '' },
  ]))
  assert.deepEqual(p.columns.map(c => c.members), [['Jan'], ['Q1']])
  assert.deepEqual(p.rows, [['N1'], ['North']])
  assert.deepEqual(p.data.N1.c0, { v: 1234.5, d: '1,234.50', u: 1, kind: 'input' })
  assert.equal(p.data.N1.c1.kind, 'calc')
  assert.equal(p.data.North.c0.kind, 'total')
  assert.equal(p.data.North.c1.v, null)
})

test('formats from attributes apply to the display only; zero sent as text is read back as a number', () => {
  const p = cellsetToPivot(cs([[m('Rate', 'Measure')]], [[m('Jan', 'Period')]], [{ Ordinal: 0, Value: null, FormattedValue: 'n:0.035' }]),
    { formatMap: { Measure: { Rate: '0.0%' } } })
  assert.equal(p.data.Rate.c0.v, 0.035)
  assert.equal(p.data.Rate.c0.d, '3.5%')
  assert.equal(p.data.Rate.c0.fmt, '0.0%')
})

test('suppression: empty rows and columns can be dropped', () => {
  const raw = cs([[m('A', 'R')], [m('B', 'R')]], [[m('x', 'K')], [m('y', 'K')]], [
    { Ordinal: 0, Value: 1 }, { Ordinal: 1, Value: 0 }, { Ordinal: 2, Value: 0 }, { Ordinal: 3, Value: null }])
  const rowsOnly = cellsetToPivot(raw, { suppressZeros: 'rows' })
  assert.deepEqual(rowsOnly.rows, [['A']])
  const both = cellsetToPivot(raw, { suppressZeros: 'all' })
  assert.deepEqual(both.columns.map(c => c.id), ['c0'])
})

test('names containing ] round-trip; members per position for pruning trees', () => {
  assert.equal(elementOf('[K].[K].[a]]b]', 'x'), 'a]b')
  assert.deepEqual(membersByPosition([['A', 'x'], ['A', 'y'], ['B', 'x']]), [['A', 'B'], ['x', 'y']])
})
