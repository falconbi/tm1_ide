'use strict'
// Lens.pivot — the toolkit's slice-and-dice on a cube, against a fake TM1 behind
// the bridge: what it asks TM1 (MDX, element trees), moving a dimension between
// rows / columns / filters, picking a filter member, and exactly what Save sends.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')

const KIT = fs.readFileSync(path.join(__dirname, '..', 'static', 'lens-kit', 'lens-kit.js'), 'utf8')
const plain = v => JSON.parse(JSON.stringify(v))
const wait = ms => new Promise(r => setTimeout(r, ms))

// A tiny cube: Measure × Entity × Period × Version. Values: rate per entity.
const TREES = {
  Measure: [{ Name: 'Merit %', Type: 'N', Level: 0 }, { Name: 'Bonus %', Type: 'N', Level: 0 }],
  Entity: [{ Name: 'Group', Type: 'C', Level: 1, Components: ['UK', 'US'] }, { Name: 'UK', Type: 'N', Level: 0 }, { Name: 'US', Type: 'N', Level: 0 }],
  Period: [{ Name: 'Jan', Type: 'N', Level: 0 }, { Name: 'Feb', Type: 'N', Level: 0 }],
}
const value = (m, e, p) => ({ 'Merit %': 0.03, 'Bonus %': 0.1 }[m] + (e === 'US' ? 0.01 : 0) + (p === 'Feb' ? 0.001 : 0))
// read which dimensions are on columns / rows from the MDX the pivot built
function fakeCellset(mdx) {
  const [colPart, rest] = mdx.split(' ON COLUMNS')
  const rowPart = rest.includes(' ON ROWS') ? rest.split(' ON ROWS')[0] : ''
  const where = (mdx.match(/WHERE \((.*)\)/) || [])[1] || ''
  const dimsIn = part => Object.keys(TREES).filter(d => part.includes('[' + d + ']'))
  const membersOf = (d, part) => {
    const listed = [...part.matchAll(new RegExp('\\[' + d.replace(/[%]/g, '') + '\\]\\.\\[' + d + '\\]\\.\\[([^\\]]+)\\]', 'g'))].map(x => x[1])
    return listed.length ? listed : TREES[d].map(x => x.Name)
  }
  const cross = sets => sets.reduce((acc, s) => acc.flatMap(a => s.map(x => [...a, x])), [[]])
  const cd = dimsIn(colPart), rd = dimsIn(rowPart)
  const cols = cross(cd.map(d => membersOf(d, colPart).map(n => [d, n])))
  const rows = rd.length ? cross(rd.map(d => membersOf(d, rowPart).map(n => [d, n]))) : [[]]
  const fixed = Object.fromEntries([...where.matchAll(/\[([^\]]+)\]\.\[[^\]]+\]\.\[([^\]]+)\]/g)].map(x => [x[1], x[2]]))
  const cells = []
  rows.forEach((r, i) => cols.forEach((c, k) => {
    const at = Object.fromEntries([...r, ...c]); Object.assign(at, Object.fromEntries(Object.entries(fixed).filter(([d]) => !(d in at))))
    const total = at.Entity === 'Group'
    cells.push({ Ordinal: i * cols.length + k, Value: total ? null : value(at.Measure, at.Entity, at.Period || 'Jan'), Consolidated: total, Updateable: total ? 0 : 1 })
  }))
  const tup = t => ({ Members: t.map(([d, n]) => ({ Name: n, UniqueName: `[${d}].[${d}].[${n}]` })) })
  return { Axes: [{ Ordinal: 0, Tuples: cols.map(tup) }, ...(rd.length ? [{ Ordinal: 1, Tuples: rows.map(tup) }] : [])], Cells: cells }
}

function page() {
  const calls = []
  const dom = new JSDOM('<!doctype html><div id="pv"></div>', {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
      win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      win.console.warn = () => {}
      win.lensBridge = {
        onLive() {}, onContext() {},
        call: async (method, payload) => {
          calls.push({ method, payload })
          if (method === 'elementTree') return TREES[payload.dimension]
          if (method === 'execMDX') return fakeCellset(payload.mdx)
          if (method === 'writeCells') return { written: payload.cells.length }
          if (method === 'cellTrace') return payload.coordinates.Measure === 'Bonus %'
            ? { Type: 'Simple', Value: 0.1, Statements: [] }
            : { Type: 'Rule', Value: 0.04, Statements: ["['Merit %'] = N: ['Base %'] + ['Uplift %'];"],
                Components: [{ Type: 'Simple', Value: 0.1, Tuple: [{ Name: 'Bonus %', Hierarchy: { Dimension: { Name: 'Measure' } } }] },
                             { Type: 'Simple', Value: 0.03, Cube: { Name: 'Other' }, Tuple: [{ Name: 'Base', Hierarchy: { Dimension: { Name: 'Measure' } } }] }] }
          if (method === 'cellLog') return [{ at: '2026-10-21T01:00:00Z', user: 'finance_mgr', old: 0.03, value: 0.04 }]
          if (method === 'cellNotes') return (win.__notes ||= []).map(t => ({ text: t, author: 'finance_mgr', at: '2026-10-21T02:00:00Z' }))
          if (method === 'addNote') { (win.__notes ||= []).push(payload.text); return { ok: true } }
          throw new Error('unexpected ' + method)
        },
      }
    },
  })
  const s = dom.window.document.createElement('script'); s.textContent = KIT; dom.window.document.head.appendChild(s)
  return { win: dom.window, doc: dom.window.document, calls, close: () => dom.window.close() }
}
const opts = extra => Object.assign({
  cube: 'Assumptions',
  rows: [{ dimension: 'Measure', memberSet: 'all' }],
  columns: [{ dimension: 'Entity', members: ['UK', 'US'] }],
  filters: [{ dimension: 'Period', member: 'Jan', choices: ['Jan', 'Feb'] }, { dimension: 'Version', member: 'Forecast', locked: true }],
  formats: { Measure: { 'Merit %': '0.0%', 'Bonus %': '0.0%' } },
}, extra)

test('draws the layout: rows, columns, filters as chips; values with formats; asks TM1 for the trees it shows', async () => {
  const { doc, win, calls, close } = page()
  const pv = win.Lens.pivot('#pv', opts())
  await pv.ready
  await wait(30)
  const chips = [...doc.querySelectorAll('[data-dim]')].map(c => c.getAttribute('data-dim'))
  assert.deepEqual(plain(chips), ['Measure', 'Entity', 'Period', 'Version'])
  assert.ok(doc.querySelector('[data-dim="Version"]').textContent.includes('🔒'), 'locked filter shows as fixed')
  const mdx = calls.find(c => c.method === 'execMDX').payload.mdx.replace(/\s+/g, ' ')
  assert.match(mdx, /SELECT \{\[Entity\]\.\[Entity\]\.\[UK\], \[Entity\]\.\[Entity\]\.\[US\]\} ON COLUMNS, \{TM1SUBSETALL\(\[Measure\]\.\[Measure\]\)\} ON ROWS FROM \[Assumptions\] WHERE \(\[Period\]\.\[Period\]\.\[Jan\], \[Version\]\.\[Version\]\.\[Forecast\]\)/)
  assert.deepEqual(plain(calls.filter(c => c.method === 'elementTree').map(c => c.payload.dimension).sort()), ['Entity', 'Measure'])
  const cell = doc.querySelector('.ag-center-cols-container [row-id="Merit %"] [col-id="c1"]')
  assert.equal(cell.textContent, '4.0%', 'US merit 3% + 1%')
  pv.grid.destroy(); close()
})

test('moving a dimension re-asks TM1 with the new layout and keeps one dimension on rows', async () => {
  const { win, calls, close } = page()
  const pv = win.Lens.pivot('#pv', opts())
  await pv.ready
  await pv.move('Period', 'columns')
  const mdx = calls.filter(c => c.method === 'execMDX').at(-1).payload.mdx.replace(/\s+/g, ' ')
  assert.ok(!/WHERE \(\[Period\]/.test(mdx), 'Period no longer a filter')
  assert.deepEqual(plain(pv.layout().columns), ['Entity', 'Period'])
  assert.match(mdx, /\{\[Period\]\.\[Period\]\.\[Jan\], \[Period\]\.\[Period\]\.\[Feb\]\}/, 'a filter moved onto an axis brings the choices it offered, not the whole dimension')
  await pv.swap()                                 // ⇄: rows and columns trade places
  assert.deepEqual(plain(pv.layout().rows), ['Entity', 'Period'])
  assert.deepEqual(plain(pv.layout().columns), ['Measure'])
  await pv.swap()
  await pv.move('Measure', 'filters')            // the only row dimension stays
  assert.deepEqual(plain(pv.layout().rows), ['Measure'])
  await pv.move('Version', 'rows')               // locked: stays a filter
  assert.deepEqual(plain(pv.layout().filters), ['Version'])
  pv.grid.destroy(); close()
})

test('editing: type into a company × measure cell; Save writes every coordinate with the old value', async () => {
  const { win, calls, close } = page()
  let changed = 0
  const pv = win.Lens.pivot('#pv', opts({ edit: true, onEdit: ch => { changed = ch.length } }))
  await pv.ready
  const node = pv.grid.api.getRowNode('Merit %')
  assert.equal(pv.grid.api.getColumn('c0').getColDef().editable({ data: node.data }), true)
  node.setDataValue('c0', 0.035)
  await wait(20)
  assert.equal(changed, 1)
  const r = await pv.save()
  assert.equal(r.written, 1)
  const w = calls.find(c => c.method === 'writeCells').payload
  assert.equal(w.cube, 'Assumptions')
  assert.deepEqual(plain(w.cells), [{ coordinates: { Measure: 'Merit %', Entity: 'UK', Period: 'Jan', Version: 'Forecast' }, value: 0.035, expect: 0.03 }])
  assert.equal(pv.changes().length, 0, 'saved → nothing pending')
  pv.grid.destroy(); close()
})

test('a total (Group) is shown but never typed into', async () => {
  const { win, close } = page()
  const pv = win.Lens.pivot('#pv', opts({ edit: true, columns: [{ dimension: 'Entity', memberSet: 'all' }] }))
  await pv.ready
  const ids = plain(pv.grid.api.getColumns().map(c => c.getColId()).filter(i => !i.startsWith('__')))
  assert.equal(ids.length, 3)
  const data = pv.grid.api.getRowNode('Merit %').data
  const groupCol = ids.find(id => pv.grid.api.getColumn(id).getColDef().headerName === 'Group')
  assert.equal(pv.grid.api.getColumn(groupCol).getColDef().editable({ data }), false)
  pv.grid.destroy(); close()
})

test('Advanced: shows only what the builder lists; picking members re-asks TM1; hide empty, totals, copy MDX', async () => {
  const { doc, win, calls, close } = page()
  const pv = win.Lens.pivot('#pv', opts({ advanced: ['members', 'suppress', 'totals', 'mdx'], subsets: { Entity: ['Big two'] }, key: 'adv-test' }))
  await pv.ready
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  assert.ok(doc.querySelector('[data-adv]'), 'Advanced button shown')
  assert.ok(!doc.querySelector('[data-pick]'), 'member pickers hidden until Advanced is opened')
  click(doc.querySelector('[data-adv]'))
  assert.ok(doc.querySelector('[data-suppress]') && doc.querySelector('[data-totals]') && doc.querySelector('[data-copy-mdx]'))
  assert.ok(!doc.querySelector('[data-copy-table]'), 'copy table not listed → not shown')
  // pick: Entity → the named subset
  click(doc.querySelector('[data-pick="Entity"]'))
  await wait(30)
  const picker = doc.querySelector('[data-member-picker]')
  assert.ok(picker, 'member picker opens')
  assert.ok(picker.textContent.includes('Big two') && picker.textContent.includes('Group') && picker.textContent.includes('UK'))
  const radio = [...picker.querySelectorAll('input[name="mp-mode"]')].find(r => r.value === 'subset:Big two')
  radio.checked = true; radio.dispatchEvent(new win.Event('change', { bubbles: true }))
  click(doc.querySelector('[data-mp-apply]'))
  await wait(60)
  const mdx = calls.filter(c => c.method === 'execMDX').at(-1).payload.mdx
  assert.match(mdx, /TM1SubsetToSet\(\[Entity\]\.\[Entity\], "Big two", "public"\)/)
  assert.ok(!doc.querySelector('[data-member-picker]'), 'picker closed after Apply')
  // ticking members
  click(doc.querySelector('[data-pick="Entity"]'))
  await wait(30)
  const tick = doc.querySelector('[data-mp-tick="US"]')
  tick.checked = true; tick.dispatchEvent(new win.Event('change', { bubbles: true }))
  click(doc.querySelector('[data-mp-apply]'))
  await wait(60)
  assert.match(calls.filter(c => c.method === 'execMDX').at(-1).payload.mdx, /\{\[Entity\]\.\[Entity\]\.\[US\]\} ON COLUMNS/)
  // hide empty rows
  const sup = doc.querySelector('[data-suppress]'); sup.value = 'rows'; sup.dispatchEvent(new win.Event('change', { bubbles: true }))
  await wait(60)
  assert.match(calls.filter(c => c.method === 'execMDX').at(-1).payload.mdx, /NON EMPTY/)
  pv.grid.destroy(); close()
})

test('copy table: the grid as tab-separated text', async () => {
  const { win, close } = page()
  const pv = win.Lens.pivot('#pv', opts())
  await pv.ready
  const text = pv.grid.toText().split('\n')
  assert.equal(text[0], 'Measure\tUK\tUS')
  assert.equal(text[1], 'Merit %\t3.0%\t4.0%')
  pv.grid.destroy(); close()
})

test('right-click a cell: Why this number? traces the rule and clicks through; Changes and Notes', async () => {
  const { doc, win, calls, close } = page()
  const pv = win.Lens.pivot('#pv', opts({ notes: true }))
  await pv.ready
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  const cell = doc.querySelector('.ag-center-cols-container [row-id="Merit %"] [col-id="c1"]')
  cell.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }))
  await wait(30)
  const menu = doc.querySelector('[data-cell-menu]')
  assert.ok(menu && menu.textContent.includes('Why this number?'))
  click(menu.querySelector('[data-open="why"]'))
  await wait(30)
  const panel = doc.querySelector('[data-cell-info]')
  assert.ok(panel.textContent.includes('Calculated by a rule') && panel.textContent.includes("['Base %'] + ['Uplift %']"))
  const trace = calls.find(c => c.method === 'cellTrace').payload
  assert.deepEqual(plain(trace.coordinates), { Measure: 'Merit %', Entity: 'US', Period: 'Jan', Version: 'Forecast' })
  click(panel.querySelector('[data-comp="0"]'))                     // click through to Bonus %
  await wait(30)
  assert.equal(calls.filter(c => c.method === 'cellTrace').at(-1).payload.coordinates.Measure, 'Bonus %')
  assert.ok(panel.textContent.includes('Typed in') && panel.querySelector('[data-back]'))
  click(panel.querySelector('[data-tab="changes"]'))
  await wait(30)
  assert.ok(panel.textContent.includes('finance_mgr'))
  click(panel.querySelector('[data-tab="notes"]'))
  await wait(30)
  assert.ok(panel.textContent.includes('No notes on this cell yet'))
  panel.querySelector('[data-note]').value = 'Agreed with HR'
  click(panel.querySelector('[data-add]'))
  await wait(40)
  assert.ok(panel.textContent.includes('Agreed with HR') && panel.textContent.includes('Note added'))
  pv.grid.destroy(); close()
})

test('Lens.grid: with cellMenu, right-click a cell opens the same Why / Who changed it / Notes menu for its TM1 cell', async () => {
  const { doc, win, calls, close } = page()
  doc.body.insertAdjacentHTML('beforeend', '<div id="g2" style="height:300px;width:600px"></div>')
  const g = win.Lens.grid('#g2', {
    columns: [{ field: 'measure', headerName: 'Assumption' }, { field: 'Jan', headerName: 'Jan', type: 'number' }],
    rows: [{ measure: 'Merit %', Jan: 0.03 }],
    cellMenu: (row, field) => field === 'Jan' ? { cube: 'Assumptions', coordinates: { Measure: row.measure, Entity: 'US', Period: 'Jan', Version: 'Forecast' } } : null,
  })
  await wait(40)
  const cell = doc.querySelector('#g2 .ag-center-cols-container [col-id="Jan"]')
  cell.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))
  await wait(30)
  const menu = doc.querySelector('[data-cell-menu]')
  assert.ok(menu, 'menu opens')
  menu.querySelector('[data-open="why"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  await wait(30)
  assert.deepEqual(plain(calls.find(c => c.method === 'cellTrace').payload.coordinates), { Measure: 'Merit %', Entity: 'US', Period: 'Jan', Version: 'Forecast' })
  // a label cell maps to nothing → no menu
  doc.querySelectorAll('[data-cell-menu]').forEach(m => m.remove())
  doc.querySelector('#g2 [col-id="measure"].ag-cell').dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }))
  await wait(20)
  assert.equal(doc.querySelector('[data-cell-menu]'), null)
  g.api.destroy(); close()
})
