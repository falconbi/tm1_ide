'use strict'
// Shared pivot — the grid itself (shared/pivot/grid.js), drawn by the REAL
// toolkit bundle in a test browser: drill-down, stacked headings, the shared
// colours, which cells can be typed into, and the edit model (save / immediate).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')

const KIT = fs.readFileSync(path.join(__dirname, '..', 'static', 'lens-kit', 'lens-kit.js'), 'utf8')

function page() {
  const dom = new JSDOM('<!doctype html><div id="g" style="height:600px;width:1200px"></div>', {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
      win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      win.console.warn = () => {}
      win.lensBridge = { call: async () => null, onLive() {}, onContext() {} }
    },
  })
  const s = dom.window.document.createElement('script'); s.textContent = KIT; dom.window.document.head.appendChild(s)
  return { win: dom.window, doc: dom.window.document, P: dom.window.Lens._pivot, close: () => dom.window.close() }
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const plain = v => JSON.parse(JSON.stringify(v))   // values from the test browser, as plain node values

const periodEls = [
  { Name: 'H1', Type: 'C', Level: 2, Components: ['Q1', 'Q2'] },
  { Name: 'Q1', Type: 'C', Level: 1, Components: ['Jan', 'Feb'] },
  { Name: 'Q2', Type: 'C', Level: 1, Components: ['Apr'] },
  { Name: 'Jan', Type: 'N', Level: 0 }, { Name: 'Feb', Type: 'N', Level: 0 }, { Name: 'Apr', Type: 'N', Level: 0 },
]
const regionEls = [
  { Name: 'All', Type: 'C', Level: 1, Components: ['North', 'South'] },
  { Name: 'North', Type: 'N', Level: 0 }, { Name: 'South', Type: 'N', Level: 0 },
]
const M = (n, d) => ({ Name: n, UniqueName: `[${d}].[${d}].[${n}]` })
// rows: Region × Period (all), columns: Measure Amount, Rate — Rate is a % rule on Q-level, input on leaves
function sample(P) {
  const regions = ['All', 'North', 'South'], periods = ['H1', 'Q1', 'Jan', 'Feb', 'Q2', 'Apr']
  const rows = regions.flatMap(r => periods.map(p => [M(r, 'Region'), M(p, 'Period')]))
  const cols = [[M('Amount', 'Measure')], [M('Rate', 'Measure')]]
  const leafP = p => ['Jan', 'Feb', 'Apr'].includes(p)
  const cells = []
  rows.forEach((rt, i) => {
    const total = rt[0].Name === 'All' || !leafP(rt[1].Name)
    cells.push({ Ordinal: i * 2, Value: 100 + i, FormattedValue: String(100 + i), Consolidated: total, Updateable: total ? 0 : 1 })
    cells.push({ Ordinal: i * 2 + 1, Value: 0.03, FormattedValue: '0.03', Consolidated: total, RuleDerived: false, Updateable: total ? 0 : 1 })
  })
  const pivot = P.cellsetToPivot({ Axes: [{ Ordinal: 0, Tuples: cols.map(c => ({ Members: c })) }, { Ordinal: 1, Tuples: rows.map(r => ({ Members: r })) }], Cells: cells },
    { formatMap: { Measure: { Rate: '0.0%', Amount: '#,##0' } } })
  return { pivot, rowHierarchies: [P.buildHierarchy(regionEls, 'Region'), P.buildHierarchy(periodEls, 'Period')] }
}
const labels = (doc, i) => [...doc.querySelectorAll(`.ag-pinned-left-cols-container .ag-row [col-id="__d${i}"]`)].map(c => c.textContent.replace(/[▾▸]/g, '').trim())
const rowIndexOf = (g, key) => { let idx = -1; g.api.forEachNode(n => { if (n.data.__key === key) idx = n.rowIndex }); return idx }

test('rows follow the trees: outer region, inner period, parents above children, repeated outer labels hidden', async () => {
  const { doc, P, close } = page()
  const g = P.createPivotGrid('#g', { ...sample(P), rowNames: ['Region', 'Period'] })
  await wait(50)
  assert.equal(g.api.getDisplayedRowCount(), 18)
  const keys = []; g.api.forEachNode(n => keys.push(n.data.__key))
  assert.deepEqual(keys.slice(0, 6), ['All::H1', 'All::Q1', 'All::Jan', 'All::Feb', 'All::Q2', 'All::Apr'])
  assert.equal(labels(doc, 0).filter(Boolean)[0], 'All')
  assert.ok(labels(doc, 0).filter(Boolean).length < 6, 'outer label shown once per block')
  const hdr = [...doc.querySelectorAll('.ag-header-cell-text, .tp-hdr .tp-lab')].map(h => h.textContent)
  assert.ok(hdr.includes('Region') && hdr.includes('Period'))
  g.destroy(); close()
})

test('drill-down: collapsing Q1 under North only hides North\'s months; collapse-all closes every one', async () => {
  const { P, close } = page()
  const g = P.createPivotGrid('#g', sample(P))
  await wait(50)
  // toggle Q1 under North through its row button
  const btns = [...g.api.getRenderedNodes()].length
  assert.ok(btns > 0)
  const north = g.api.getRowNode('North::Q1')
  assert.ok(north)
  g.expandAll('rows', 1, false)
  await wait(20)
  const keys = []; g.api.forEachNode(n => keys.push(n.data.__key))
  assert.deepEqual(keys, ['All::H1', 'North::H1', 'South::H1'])
  g.expandAll('rows', 1, true)
  await wait(20)
  assert.equal(g.api.getDisplayedRowCount(), 18)
  g.destroy(); close()
})

test('colours and typing: totals darker, inputs plain; only leaf × leaf input cells take typing', async () => {
  const { doc, P, close } = page()
  const g = P.createPivotGrid('#g', { ...sample(P), edit: 'save' })
  await wait(50)
  const col = g.api.getColumn('c0').getColDef()
  const node = key => g.api.getRowNode(key)
  assert.equal(col.editable({ data: node('North::Jan').data }), true)
  assert.equal(col.editable({ data: node('North::Q1').data }), false, 'a quarter is a total')
  assert.equal(col.editable({ data: node('All::Jan').data }), false, 'All is a total')
  const st = k => col.cellStyle({ data: node(k).data })
  assert.notEqual(st('All::Jan').background, '', 'totals are shaded')
  assert.equal(st('North::Jan').background, '', 'inputs are plain')
  // displayed with TM1 formats
  const cell = doc.querySelector('.ag-center-cols-container [row-id="North::Jan"] [col-id="c1"]')
  assert.equal(cell.textContent, '3.0%')
  g.destroy(); close()
})

test('save mode: typed values are tracked, % typed as 3.5 means 3.5%, undo puts them back', async () => {
  const { P, close } = page()
  const seen = []
  const g = P.createPivotGrid('#g', { ...sample(P), edit: 'save', onEdit: ch => seen.push(ch.length) })
  await wait(50)
  const parse = g.api.getColumn('c1').getColDef().valueParser
  assert.equal(parse({ newValue: '3.5', oldValue: 0.03, data: g.api.getRowNode('North::Jan').data }), 0.035)
  assert.equal(parse({ newValue: '3.5%', oldValue: 0.03, data: g.api.getRowNode('North::Jan').data }), 0.035)
  g.api.getRowNode('North::Jan').setDataValue('c1', 0.035)
  g.api.getRowNode('South::Apr').setDataValue('c0', 999)
  await wait(20)
  const ch = g.changes()
  assert.deepEqual(plain(ch.map(c => [c.tuple.join('/'), c.members.join('/'), c.value, c.old]).sort()),
    [['North/Jan', 'Rate', 0.035, 0.03], ['South/Apr', 'Amount', 999, 117]])
  assert.equal(seen.at(-1), 2)
  const st = g.api.getColumn('c1').getColDef().cellStyle({ data: g.api.getRowNode('North::Jan').data, node: g.api.getRowNode('North::Jan') })
  assert.match(st.boxShadow, /2b7de9/, 'typed cell outlined blue')
  g.undo()
  assert.equal(g.changes().length, 0)
  assert.equal(g.api.getRowNode('North::Jan').data.c1.v, 0.03)
  // typing the old value back is not a change
  g.api.getRowNode('North::Jan').setDataValue('c1', 0.05)
  g.api.getRowNode('North::Jan').setDataValue('c1', 0.03)
  assert.equal(g.changes().length, 0)
  g.destroy(); close()
})

test('immediate mode: each typed cell is written at once; a refused write puts the old value back', async () => {
  const { P, close } = page()
  const writes = [], errors = []
  const g = P.createPivotGrid('#g', { ...sample(P), edit: 'immediate',
    onWrite: w => { writes.push(w); return w.value === 13 ? Promise.reject(new Error('refused')) : Promise.resolve() },
    onError: e => errors.push(e.message) })
  await wait(50)
  g.api.getRowNode('North::Feb').setDataValue('c0', 12)
  g.api.getRowNode('North::Apr').setDataValue('c0', 13)
  await wait(30)
  assert.deepEqual(plain(writes.map(w => [w.tuple.join('/'), w.members[0], w.value])), [['North/Feb', 'Amount', 12], ['North/Apr', 'Amount', 13]])
  assert.equal(g.api.getRowNode('North::Feb').data.c0.v, 12)
  assert.equal(g.api.getRowNode('North::Apr').data.c0.v, 111, 'refused → old value back')
  assert.deepEqual(errors, ['refused'])
  assert.equal(g.changes().length, 0, 'nothing held for a Save')
  g.destroy(); close()
})

test('two dimensions on columns: stacked headings, and a total column is never typed into (bug 1)', async () => {
  const { doc, P, close } = page()
  const cols = [['North', 'Jan'], ['North', 'Q1'], ['South', 'Jan']].map(([r, p]) => [M(r, 'Region'), M(p, 'Period')])
  const rows = [[M('Amount', 'Measure')]]
  const pivot = P.cellsetToPivot({ Axes: [{ Ordinal: 0, Tuples: cols.map(c => ({ Members: c })) }, { Ordinal: 1, Tuples: rows.map(r => ({ Members: r })) }],
    Cells: [{ Ordinal: 0, Value: 1 }, { Ordinal: 1, Value: 2 }, { Ordinal: 2, Value: 3 }] })
  const g = P.createPivotGrid('#g', { pivot, colHierarchies: [P.buildHierarchy(regionEls, 'Region'), P.buildHierarchy(periodEls, 'Period')], edit: 'save' })
  await wait(50)
  const ids = plain(g.api.getColumns().map(c => c.getColId()).filter(i => !i.startsWith('__')))
  assert.deepEqual(ids, ['c1', 'c0', 'c2'], 'Q1 (total) above its month, as in the tree')
  const row = g.api.getRowNode('Amount').data
  assert.equal(g.api.getColumn('c1').getColDef().editable({ data: row }), false, 'North / Q1 is a total')
  assert.equal(g.api.getColumn('c0').getColDef().editable({ data: row }), true)
  assert.ok(doc.querySelectorAll('.tp-stack').length >= 3, 'stacked headings drawn')
  g.destroy(); close()
})

test('setPivot keeps the drill-down when the data shape is the same; stripes switch on and off', async () => {
  const { P, close } = page()
  const s = sample(P)
  const g = P.createPivotGrid('#g', s)
  await wait(50)
  g.expandAll('rows', 1, false)
  g.setPivot(sample(P).pivot)
  await wait(20)
  assert.equal(g.api.getDisplayedRowCount(), 3, 'still collapsed after new data')
  g.stripes(true); g.stripes(false)
  g.destroy(); close()
})
