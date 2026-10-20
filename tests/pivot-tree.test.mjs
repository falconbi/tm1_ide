// The pivot's drill-down logic (client/src/lib/pivot-tree.js) — pinned before it
// moves into the shared pivot (docs/PIVOT_PLAN.md). Tests marked `todo` state the
// RIGHT behaviour for a known bug: reported, not failing, until the fix lands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allExpanded, computeVisibleNodes, computeVisibleTuples, initExpandedSets,
  buildHierarchyFromElements, constrainHierarchy, rowIndent, buildColNodeMap, columnIsLeaf,
} from '../client/src/lib/pivot-tree.js'

// FY ─ H1 ─ Q1 ─ Jan, Feb
//    │    └ Q2 ─ Apr
//    └ H2 ─ Q3 ─ Jul
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
// All ─ North ─ N1, N2      (uneven: Solo is a leaf directly under the top)
//     └ Solo
const regionEls = [
  { Name: 'All', Type: 'C', Level: 2, Components: ['North', 'Solo'] },
  { Name: 'North', Type: 'C', Level: 1, Components: ['N1', 'N2'] },
  { Name: 'N1', Type: 'N', Level: 0 }, { Name: 'N2', Type: 'N', Level: 0 }, { Name: 'Solo', Type: 'N', Level: 0 },
]
const period = buildHierarchyFromElements(periodEls, 'Period')
const region = buildHierarchyFromElements(regionEls, 'Region')

test('an element list becomes a tree: roots, children, leaves, deepest level', () => {
  assert.deepEqual(period.roots, ['FY'])
  assert.deepEqual(period.nodes.H1.children, ['Q1', 'Q2'])
  assert.equal(period.nodes.Jan.isLeaf, true)
  assert.equal(period.nodes.Q1.isLeaf, false)
  assert.equal(period.maxLevel, 3)
  assert.equal(period.name, 'Period')
  assert.equal(buildHierarchyFromElements([], 'X'), null)
})

test('everything expanded: parents above their children (or below, totals at bottom)', () => {
  const all = allExpanded(period.nodes)
  assert.deepEqual([...all].sort(), ['FY', 'H1', 'H2', 'Q1', 'Q2', 'Q3'])
  assert.deepEqual(computeVisibleNodes(period.roots, period.nodes, all, 'parent'),
    ['FY', 'H1', 'Q1', 'Jan', 'Feb', 'Q2', 'Apr', 'H2', 'Q3', 'Jul'])
  assert.deepEqual(computeVisibleNodes(period.roots, period.nodes, all, 'parent', true),
    ['Jan', 'Feb', 'Q1', 'Apr', 'Q2', 'H1', 'Jul', 'Q3', 'H2', 'FY'])
})

test("'replace' mode shows an open parent's children instead of the parent", () => {
  const all = allExpanded(period.nodes)
  assert.deepEqual(computeVisibleNodes(period.roots, period.nodes, all, 'replace'), ['Jan', 'Feb', 'Apr', 'Jul'])
  const onlyFY = new Set(['FY'])
  assert.deepEqual(computeVisibleNodes(period.roots, period.nodes, onlyFY, 'replace'), ['H1', 'H2'])
})

test('a collapsed parent hides everything under it', () => {
  const open = new Set(['FY', 'H1'])            // Q1, Q2, H2 closed
  assert.deepEqual(computeVisibleNodes(period.roots, period.nodes, open, 'parent'), ['FY', 'H1', 'Q1', 'Q2', 'H2'])
  assert.deepEqual(computeVisibleNodes(period.roots, period.nodes, new Set(), 'parent'), ['FY'])
})

test('two dimensions on rows: the inner one remembers its drill-down per outer member', () => {
  const sets = [new Set(['All', 'North']), new Map([
    ['N1', new Set(['FY'])],                    // under N1: only FY opened (H1, H2 shown closed)
    ['N2', new Set()],                          // under N2: FY closed
  ])]
  const rows = computeVisibleTuples([region, period], sets, 'parent').map(t => t.join('/'))
  assert.ok(rows.includes('N1/H1') && rows.includes('N1/H2') && !rows.includes('N1/Q1'))
  assert.ok(rows.includes('N2/FY') && !rows.includes('N2/H1'))
  // an outer member with no remembered state shows the inner dimension fully open
  assert.ok(rows.includes('Solo/Jan') && rows.includes('Solo/Jul'))
  // outer order follows the outer tree
  assert.equal(rows[0], 'All/FY')
})

test("collapse-all on an inner dimension ('*') applies under every outer member", () => {
  const sets = [allExpanded(region.nodes), new Map([['*', new Set()]])]
  const rows = computeVisibleTuples([region, period], sets, 'parent').map(t => t.join('/'))
  assert.ok(rows.every(r => r.endsWith('/FY')), 'only FY under each region')
  assert.equal(rows.length, Object.keys(region.nodes).length)
})

test('initial state: the outer dimension fully open, inner dimensions on their default', () => {
  const s = initExpandedSets([region, period])
  assert.deepEqual([...s[0]].sort(), ['All', 'North'])
  assert.ok(s[1] instanceof Map && s[1].size === 0)
  assert.deepEqual(computeVisibleTuples([], [], 'parent'), [])
})

test('pruning a tree to the members a query returned', () => {
  const pruned = constrainHierarchy(period, ['FY', 'H1', 'Q1', 'Jan'])
  assert.deepEqual(Object.keys(pruned.nodes).sort(), ['FY', 'H1', 'Jan', 'Q1'])
  assert.deepEqual(pruned.nodes.H1.children, ['Q1'])
  assert.deepEqual(pruned.roots, ['FY'])
  assert.equal(constrainHierarchy(period, []), period, 'nothing returned → tree unchanged')
})

test('bug 6: a total whose children were filtered out is still a total (not editable)',
  { todo: 'bug 6 — fixed in the shared pivot (docs/PIVOT_PLAN.md)' }, () => {
  const pruned = constrainHierarchy(period, ['FY', 'H1'])   // H1's quarters not returned
  assert.equal(pruned.nodes.H1.isLeaf, false)
})

test('indent: each level down the tree indents one more step', () => {
  // even hierarchy — level counted up from leaves gives the same answer as depth
  assert.equal(rowIndent(period.nodes.FY.level, period.maxLevel), 0)
  assert.equal(rowIndent(period.nodes.Q1.level, period.maxLevel), 28)
  assert.equal(rowIndent(period.nodes.Jan.level, period.maxLevel), 42)
})

test('bug 2: in an uneven tree a leaf directly under the top is indented one step, not to the bottom',
  { todo: 'bug 2 — indent by depth from the top (docs/PIVOT_PLAN.md)' }, () => {
  assert.equal(rowIndent(region.nodes.Solo.level, region.maxLevel), 14)
})

test('one dimension on columns: a total column is not a leaf; a month is', () => {
  const columns = [{ id: 'c0', label: 'Q1', members: ['Q1'] }, { id: 'c1', label: 'Jan', members: ['Jan'] }]
  const byKey = Object.fromEntries(columns.map(c => [c.members.join('::'), c]))
  const map = buildColNodeMap([period], byKey)
  assert.deepEqual(map, { c0: 'Q1', c1: 'Jan' })
  assert.equal(columnIsLeaf(columns[0], map, [period]), false)
  assert.equal(columnIsLeaf(columns[1], map, [period]), true)
})

test('bug 1: two dimensions on columns — a total column is still recognised as a total',
  { todo: 'bug 1 — check every column dimension (docs/PIVOT_PLAN.md)' }, () => {
  const columns = [{ id: 'c0', label: 'North / Q1', members: ['North', 'Q1'] }]
  const byKey = Object.fromEntries(columns.map(c => [c.members.join('::'), c]))
  const map = buildColNodeMap([region, period], byKey)
  assert.equal(columnIsLeaf(columns[0], map, [region, period]), false)
})

test('bug 4: more than 4 dimensions on an axis keep their hierarchies',
  { todo: 'bug 4 — View editor has 4 fixed slots per axis; covered by component tests in the shared pivot' }, () => {
  assert.fail('not testable until the View editor uses the shared pivot')
})

test('bug 5: click-to-edit and the editable rule agree on total columns',
  { todo: 'bug 5 — onCellClicked reads a colIsLeaf flag never set; covered by component tests in the shared pivot' }, () => {
  assert.fail('not testable until HierarchyGrid is rendered in tests')
})
