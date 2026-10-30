'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const { readExample: readTemplate, listExamples: listTemplates } = require('../core/lens_examples')

// ── The Lens examples, clicked through like a person ───────────
// Each template runs with the REAL toolkit and a fake TM1 behind the bridge;
// the test reads what it shows and checks exactly what reaches TM1 (the bridge
// calls) when someone saves or clicks.

const KIT = fs.readFileSync(path.join(__dirname, '..', 'static', 'lens-kit', 'lens-kit.js'), 'utf8')

// A cellset in the shape execMDX returns: column members × row tuples.
function cellset(cols, rowTuples, valueAt, flags = () => ({})) {
  const cells = []
  const rts = rowTuples.length ? rowTuples : [null]
  rts.forEach((rt, r) => cols.forEach((c, k) => cells.push({ Ordinal: r * cols.length + k, Value: valueAt(rt, c), ...flags(rt, c) })))
  return {
    Axes: [
      { Tuples: cols.map(c => ({ Members: [{ Name: c[1], UniqueName: `[${c[0]}].[${c[0]}].[${c[1]}]` }] })) },
      ...(rowTuples.length ? [{ Tuples: rowTuples.map(rt => ({ Members: rt.map(([d, n]) => ({ Name: n, UniqueName: `[${d}].[${d}].[${n}]` })) })) }] : []),
    ],
    Cells: cells,
  }
}
const one = v => ({ Axes: [{ Tuples: [{ Members: [{ Name: 'x', UniqueName: '[x].[x].[x]' }] }] }], Cells: [{ Ordinal: 0, Value: v }] })

async function board(name, config, tm1) {
  const kit = '<script>' + KIT.replace(/<\/script>/g, () => '<\\/script>') + '</script>'
  const html = readTemplate(name).replace('<script src="/lens-kit/lens-kit.js"></script>', () => kit)
  const calls = []
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.__lensConfig = config
      win.__lensTheme = null
      win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
      win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      win.CSS = { escape: s => String(s).replace(/["\\]/g, '\\$&') }
      win.print = () => { calls.push({ method: 'print' }) }
      // Charts draw on a canvas jsdom doesn't have: a stand-in that measures text.
      const ctx = new Proxy({}, { get: (o, k) => k === 'measureText' ? (t => ({ width: String(t).length * 6 })) : k === 'getImageData' ? (() => ({ data: [] })) : (() => {}) })
      win.HTMLCanvasElement.prototype.getContext = () => ctx
      win.console.warn = () => {}
      win.lensBridge = {
        call: async (method, payload) => { calls.push({ method, payload }); return tm1(method, payload) },
        onLive() {}, onContext() {},
      }
    },
  })
  return { win: dom.window, doc: dom.window.document, calls, close: () => dom.window.close() }
}

const until = async (fn, what, ms = 4000) => {
  const t0 = Date.now()
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await new Promise(r => setTimeout(r, 20)) }
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
const plain = v => JSON.parse(JSON.stringify(v))
const common = (method) => {
  if (method === 'whoami') return { user: 'finance_mgr', groups: ['Lens Finance'] }
  if (method === 'history') return []
  if (method === 'liveJoin' || method === 'liveSend') return {}
  if (method === 'openLens') return { ok: true }
  return undefined
}

test('every example has its code, what it shows and an example config', () => {
  const list = listTemplates()
  for (const name of ['input-form', 'line-item-form', 'assumptions-table', 'dashboard', 'variance-report', 'detail-list', 'app-home', 'process-page', 'narrative-document', 'disclosure-accounts']) {
    const t = list.find(x => x.name === name)
    assert.ok(t, `${name} is in the library`)
    assert.ok(t.title && t.description && t.icon, `${name} has a title, description and icon`)
    assert.ok(t.settings && Object.keys(t.settings).length, `${name} explains its settings`)
    assert.ok(t.example && Object.keys(t.example).length, `${name} has an example config`)
    assert.match(readTemplate(name), /<script src="\/lens-kit\/lens-kit\.js"><\/script>/, `${name} uses the toolkit`)
  }
})

test('assumptions table: a row per element with its numbers and text, read at the fixed members', async () => {
  const cfg = { cube: 'Capital', rows: { dimension: 'Asset Types', members: ['1200', '1210'] }, columns: { dimension: 'Capital', items: [{ member: 'Life', type: 'number' }, { member: 'Justification', type: 'text' }] }, fixed: { organization: '101', Year: 'Y2' }, writes: ['Capital'] }
  const b = await board('assumptions-table', cfg, (m, p) => {
    const c = common(m); if (c !== undefined) return c
    if (m === 'writeCells') return { written: p.cells.length }
    if (/ElementAttributes/.test(p.mdx)) throw new Error('no access')
    return cellset([['Capital', 'Life'], ['Capital', 'Justification']], [[['Asset Types', '1200']], [['Asset Types', '1210']]], (rt, c) => c[1] === 'Life' ? 60 : 'note')
  })
  try {
    await until(() => b.doc.querySelectorAll('.ag-center-cols-container .ag-row').length === 2, 'two rows')
    const txt = b.doc.getElementById('grid').textContent
    assert.match(txt, /1200/); assert.match(txt, /60/); assert.match(txt, /note/)
    assert.equal(b.doc.getElementById('save').disabled, true, 'nothing to save until something is typed')
    const q = b.calls.find(x => x.method === 'execMDX' && /FROM \[Capital\]/.test(x.payload.mdx)).payload.mdx
    assert.match(q, /WHERE \(\[organization\]\.\[organization\]\.\[101\],\[Year\]\.\[Year\]\.\[Y2\]\)/, 'read at the fixed members')
  } finally { b.close() }
})

test('dashboard: headline tiles show each number with its comparison; picking a region re-reads', async () => {
  const cfg = { cube: 'Income Statement', where: { Version: 'Actual', Year: 'Y2' }, pick: { dimension: 'organization', members: ['Total Company', '100'], label: 'Region' },
    kpis: [{ label: 'Net profit', value: { Account: 'NP' }, compare: { Account: 'NP', Version: 'Target' } }], compareLabel: 'Target' }
  const b = await board('dashboard', cfg, (m, p) => {
    const c = common(m); if (c !== undefined) return c
    if (/ElementAttributes/.test(p.mdx)) throw new Error('no access')
    if (/SELECT \{\} ON 0/.test(p.mdx)) return cellset([], [[['organization', 'Total Company']], [['organization', '100']]], () => null)
    return one(/\[Target\]/.test(p.mdx) ? 900 : 1200)
  })
  try {
    await until(() => /1,200/.test(b.doc.getElementById('kpis').textContent), 'the tile')
    assert.match(b.doc.getElementById('kpis').textContent, /Net profit/)
    assert.match(b.doc.getElementById('kpis').textContent, /900/)
    const mdx = b.calls.filter(x => x.method === 'execMDX').map(x => x.payload.mdx).filter(q => /\[NP\]/.test(q))
    assert.ok(mdx.every(q => /\[organization\]\.\[organization\]\.\[Total Company\]/.test(q)), 'read at the picked region')
    const before = b.calls.length
    b.doc.getElementById('pick').value = '100'
    b.doc.getElementById('pick').dispatchEvent(new b.win.Event('change'))
    await until(() => b.calls.slice(before).some(x => x.method === 'execMDX' && /\[organization\]\.\[organization\]\.\[100\]/.test(x.payload.mdx)), 're-read for region 100')
    await until(() => b.doc.getElementById('status').textContent === '', 'the re-read to finish')
  } finally { b.close() }
})

test('variance report: variance and better/worse per line; costs are better when lower', async () => {
  const cfg = { cube: 'Income Statement', rows: { dimension: 'Account', members: ['6100', '6200'] }, actual: { label: 'Actual', at: { Version: 'Actual' } }, compare: { label: 'Target', at: { Version: 'Target' } }, costAll: true }
  const b = await board('variance-report', cfg, (m, p) => {
    const c = common(m); if (c !== undefined) return c
    if (/ElementAttributes/.test(p.mdx)) throw new Error('no access')
    const isAct = /\[Version\]\.\[Version\]\.\[Actual\]\} ON 0/.test(p.mdx)
    const col = isAct ? 'Actual' : 'Target'
    return cellset([['Version', col]], [[['Account', '6100']], [['Account', '6200']]], rt => isAct ? (rt[0][1] === '6100' ? 120 : 80) : 100)
  })
  try {
    await until(() => b.doc.querySelectorAll('#grid .ag-center-cols-container .ag-row').length === 2, 'two lines')
    const txt = b.doc.getElementById('grid').textContent
    assert.match(txt, /▼ worse/, '6100 spent 120 against 100 — worse for a cost')
    assert.match(txt, /▲ better/, '6200 spent 80 against 100 — better for a cost')
  } finally { b.close() }
})

test('detail list: only lines with something in them, with a count and total', async () => {
  const cfg = { cube: 'Capital', lines: [{ dimension: 'CapitalList', members: ['1', '2', '3'] }], fieldsDimension: 'Capital', fields: [{ member: 'Description', type: 'text' }, { member: 'Purchase Cost', format: '$' }], totalField: 'Purchase Cost' }
  const b = await board('detail-list', cfg, (m, p) => {
    const c = common(m); if (c !== undefined) return c
    if (/ElementAttributes/.test(p.mdx)) throw new Error('no access')
    const vals = { 1: ['Desks', 1200], 2: ['Laptops', 3000], 3: ['', null] }
    return cellset([['Capital', 'Description'], ['Capital', 'Purchase Cost']], [[['CapitalList', '1']], [['CapitalList', '2']], [['CapitalList', '3']]], (rt, c) => vals[rt[0][1]][c[1] === 'Description' ? 0 : 1])
  })
  try {
    await until(() => /line/.test(b.doc.getElementById('total').textContent), 'the total')
    assert.match(b.doc.getElementById('total').textContent, /2 lines · total \$4,200/)
  } finally { b.close() }
})

test('app home: counts as tiles, "needs you" only for the right group, and a tile opens its Lens', async () => {
  const cfg = { heading: 'Capex', counts: [{ label: 'requests', mdx: 'Q-ALL ON 1' }, { label: 'waiting', mdx: 'Q-WAIT ON 1', tone: 'warn' }],
    needsMe: [{ label: '{n} requests waiting for your approval', mdx: 'Q-WAIT ON 1', groups: ['Lens Finance'], open: 'Capex-Requests' }, { label: 'not for me', mdx: 'Q-ALL ON 1', groups: ['Lens East'] }],
    pages: [{ lens: 'Capex-Requests', title: 'Requests' }, { lens: 'Capex-Secret', title: 'Secret', groups: ['Lens East'] }] }
  const b = await board('app-home', cfg, (m, p) => {
    const c = common(m); if (c !== undefined) return c
    const n = p.mdx === 'Q-ALL ON 1' ? 3 : 1
    return cellset([['Capital', 'Purchase Cost']], Array.from({ length: n }, (_, i) => [['CapitalList', String(i + 1)]]), () => 1)
  })
  try {
    await until(() => b.doc.querySelectorAll('.tile').length === 2 && /waiting for your approval/.test(b.doc.getElementById('needs').textContent), 'tiles and needs')
    assert.deepEqual([...b.doc.querySelectorAll('.tile .n')].map(x => x.textContent), ['3', '1'])
    assert.match(b.doc.getElementById('needs').textContent, /^1 requests waiting for your approval/)
    assert.doesNotMatch(b.doc.getElementById('needs').textContent, /not for me/, 'a group the viewer is not in')
    assert.deepEqual([...b.doc.querySelectorAll('.page b')].map(x => x.textContent), ['Requests'], 'a page for another group is hidden')
    click(b.win, b.doc.querySelector('.page'))
    await until(() => b.calls.some(x => x.method === 'openLens'), 'open')
    assert.deepEqual(plain(b.calls.find(x => x.method === 'openLens').payload), { name: 'Capex-Requests' })
  } finally { b.close() }
})

test('process page: a step with nothing remaining shows Done; clicking a step opens its Lens', async () => {
  const cfg = { steps: [{ title: 'Set targets', lens: 'Target-Input', remaining: { label: '{n} left', mdx: 'Q-ZERO ON 1' } }, { title: 'Approve', lens: 'Capex-Requests', remaining: { label: '{n} waiting', mdx: 'Q-TWO ON 1' }, groups: ['Lens Finance'] }] }
  const b = await board('process-page', cfg, (m, p) => {
    const c = common(m); if (c !== undefined) return c
    const n = p.mdx === 'Q-TWO ON 1' ? 2 : 0
    return cellset([['Capital', 'Purchase Cost']], Array.from({ length: n }, (_, i) => [['CapitalList', String(i + 1)]]), () => 1)
  })
  try {
    await until(() => b.doc.querySelectorAll('.step').length === 2, 'two steps')
    const [s1, s2] = b.doc.querySelectorAll('.step')
    assert.match(s1.textContent, /Done/)
    assert.match(s2.textContent, /2 waiting/)
    assert.ok(s2.classList.contains('mine'), 'the viewer is in Lens Finance — their step')
    click(b.win, s2)
    await until(() => b.calls.some(x => x.method === 'openLens'), 'open')
    assert.equal(b.calls.find(x => x.method === 'openLens').payload.name, 'Capex-Requests')
  } finally { b.close() }
})

test('narrative document: live numbers fill the text; an editor saves the text to its cell', async () => {
  const at = { Version: 'Explanation', Account: 'NP' }
  const cfg = { cube: 'Income Statement', sections: [{ title: 'Summary', at }], numbers: { np: { at: { Version: 'Actual', Account: 'NP' }, format: '$' } }, editors: ['Lens Finance'], writes: ['Income Statement'] }
  let text = 'Net profit was {{np}}.'
  const b = await board('narrative-document', cfg, (m, p) => {
    const c = common(m); if (c !== undefined) return c
    if (m === 'writeCells') return { written: p.cells.length }
    return one(/\[Explanation\]/.test(p.mdx) ? text : 14936288)
  })
  try {
    await until(() => /Net profit was/.test(b.doc.getElementById('doc').textContent), 'the text')
    assert.match(b.doc.getElementById('doc').textContent, /Net profit was \$14,936,288\./)
    assert.equal(b.doc.getElementById('edit').hidden, false, 'an editor sees Edit')
    click(b.win, b.doc.getElementById('edit'))
    const ta = await until(() => b.doc.querySelector('textarea'), 'the editor')
    ta.value = 'Net profit was {{np}}, ahead of plan.'
    click(b.win, b.doc.getElementById('save'))
    await until(() => b.calls.some(x => x.method === 'writeCells'), 'the save')
    const w = plain(b.calls.find(x => x.method === 'writeCells').payload)
    assert.equal(w.cube, 'Income Statement')
    assert.deepEqual(w.cells, [{ coordinates: at, value: 'Net profit was {{np}}, ahead of plan.', expect: 'Net profit was {{np}}.' }])
    await until(() => b.doc.getElementById('status').textContent === 'Saved.', 'the reload after saving')
  } finally { b.close() }
})

test('disclosure accounts: rounded, negatives in brackets, headings and totals laid out', async () => {
  const cfg = { cube: 'Income Statement', lineDimension: 'Account', columns: [{ label: 'Year 2', at: { Version: 'Actual' } }, { label: 'Year 1', at: { Version: 'Prior' } }], rounding: 'thousands',
    statements: [{ title: 'Income statement', lines: [{ label: 'Revenue', member: '4999' }, { label: 'Expenses' }, { label: 'Costs', member: 'TE', sign: -1 }, { label: 'Net profit', member: 'NP', style: 'total' }] }] }
  const b = await board('disclosure-accounts', cfg, (m, p) => {
    const c = common(m); if (c !== undefined) return c
    const vals = { '4999': [73606160, 92589659], TE: [13964993, 10339548], NP: [59641167, 82250111] }
    return cellset([['Version', 'Actual'], ['Version', 'Prior']], [[['Account', '4999']], [['Account', 'TE']], [['Account', 'NP']]], (rt, c) => vals[rt[0][1]][c[1] === 'Actual' ? 0 : 1])
  })
  try {
    await until(() => b.doc.querySelectorAll('table.fs tbody tr').length === 4, 'the statement')
    const rows = [...b.doc.querySelectorAll('table.fs tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => td.textContent.trim()))
    assert.deepEqual(rows[0], ['Revenue', '', '73,606', '92,590'])
    assert.deepEqual(rows[1], ['Expenses', '', '', ''], 'a heading has no numbers')
    assert.deepEqual(rows[2], ['Costs', '', '(13,965)', '(10,340)'], 'shown negative, in brackets')
    assert.ok(b.doc.querySelectorAll('table.fs tbody tr')[3].classList.contains('total'))
    click(b.win, b.doc.getElementById('print'))
    assert.ok(b.calls.some(x => x.method === 'print'), 'Print / PDF prints')
  } finally { b.close() }
})

test('every new template with missing settings says what it needs instead of breaking', async () => {
  for (const [name, el] of [['assumptions-table', 'grid'], ['dashboard', 'kpis'], ['variance-report', 'grid'], ['detail-list', 'grid'], ['app-home', 'pages'], ['process-page', 'steps'], ['narrative-document', 'doc'], ['disclosure-accounts', 'page']]) {
    const b = await board(name, { heading: 'x' }, (m) => common(m) ?? {})
    try { await until(() => /needs its settings/.test(b.doc.getElementById(el).textContent), name + ' to ask for settings') } finally { b.close() }
  }
})
