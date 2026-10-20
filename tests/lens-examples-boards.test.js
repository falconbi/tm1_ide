'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const { readExample: readTemplate } = require('../core/lens_examples')

// ── Lens examples, clicked through like a person ─────────────────────────
// Each board runs with the REAL toolkit (static/lens-kit/lens-kit.js), a config
// and a fake TM1 behind the bridge; the test clicks and types, then checks what
// reached TM1 (the bridge calls). A broken button in a board fails here, not in
// front of someone.

const KIT = fs.readFileSync(path.join(__dirname, '..', 'static', 'lens-kit', 'lens-kit.js'), 'utf8')

// A cellset in the shape execMDX returns: column members × row tuples.
function cellset(cols, rowTuples, valueAt, flags = () => ({})) {
  const cells = []
  rowTuples.forEach((rt, r) => cols.forEach((c, k) => cells.push({ Ordinal: r * cols.length + k, Value: valueAt(rt, c), ...flags(rt, c) })))
  return {
    Axes: [
      { Tuples: cols.map(c => ({ Members: [{ Name: c[1], UniqueName: `[${c[0]}].[${c[0]}].[${c[1]}]` }] })) },
      ...(rowTuples.length ? [{ Tuples: rowTuples.map(rt => ({ Members: rt.map(([d, n]) => ({ Name: n, UniqueName: `[${d}].[${d}].[${n}]` })) })) }] : []),
    ],
    Cells: cells,
  }
}

// Load a board; tm1(method, payload) answers the bridge. Returns the window and
// every call made.
async function board(name, config, tm1) {
  // A function as the replacement: the toolkit's code contains '$' sequences a
  // replacement string would treat as special.
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
const type = (win, el, value) => { el.value = value; el.dispatchEvent(new win.Event('input', { bubbles: true })) }
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
// Values from the simulated page are objects of another realm: compare as plain data.
const plain = v => JSON.parse(JSON.stringify(v))

// ── Line-item form ───────────────────────────────────────────────────────────
const CAPEX = {
  heading: 'Capex requests', cube: 'Capital', layout: 'cards', itemLabel: 'Request',
  version: { dimension: 'Version', member: 'Target' },
  unit: { dimension: 'organization', level: 0, label: 'Store' },
  period: { dimension: 'Year', members: ['Y2', 'Y3'], label: 'Year' },
  lines: { dimension: 'CapitalList', level: 0 },
  group: { dimension: 'Asset Types', level: 0, label: 'Asset type' },
  fieldsDimension: 'Capital',
  fields: [
    { member: 'Description', label: 'What', type: 'text', required: true },
    { member: 'Purchase Cost', label: 'Cost', type: 'number', format: '$', required: true },
    { member: 'Life', label: 'Life', type: 'number' },
  ],
  totalField: 'Purchase Cost',
  approval: { flag: 'Approved', by: 'Approved By', at: 'Approved At', process: 'Lens Capex Approve', approvers: ['Lens Finance'],
    params: { unit: 'pOrg', period: 'pYear', version: 'pVersion', line: 'pLine', group: 'pAsset', action: 'pAction' } },
  writes: ['Capital'], runs: ['Lens Capex Approve'],
}
// Store 101: line 1 / Furniture holds a request; line 2 / Computers an approved one.
// Life is calculated (rule) for every line — it must not make empty lines show.
function capexTM1({ approver = true } = {}) {
  const lines = { '1|1200': { Description: 'Desks', 'Purchase Cost': 1200 }, '2|1210': { Description: 'Laptops', 'Purchase Cost': 3000, Approved: 'Y', 'Approved By': 'finance_mgr', 'Approved At': '2026-10-14T10:00:00Z' } }
  return (method, p) => {
    if (method === 'whoami') return { user: approver ? 'finance_mgr' : 'east_mgr', groups: approver ? ['Lens Finance'] : ['Lens East'] }
    if (method === 'history') return []
    if (method === 'liveJoin' || method === 'liveSend') return {}
    if (method === 'runProcess') return { status: 'CompletedSuccessfully', message: 'Approved.', result: 'approved', seconds: 0.1 }
    if (method === 'writeCells') return { written: p.cells.length }
    const q = p.mdx
    if (/ElementAttributes/.test(q)) throw new Error('no access')
    if (/SELECT \{\} ON 0, \{TM1FILTERBYLEVEL\(\{TM1SUBSETALL\(\[organization\]/.test(q)) return cellset([], [[['organization', '101']], [['organization', '102']]], () => null)
    if (/SELECT \{\} ON 0, \{TM1FILTERBYLEVEL\(\{TM1SUBSETALL\(\[Asset Types\]/.test(q)) return cellset([], [[['Asset Types', '1200']], [['Asset Types', '1210']]], () => null)
    const fields = ['Description', 'Purchase Cost', 'Life', 'Approved', 'Approved By', 'Approved At']
    const tuples = []
    for (const l of ['1', '2', '3']) for (const a of ['1200', '1210']) tuples.push([['CapitalList', l], ['Asset Types', a]])
    return cellset(fields.map(f => ['Capital', f]), tuples,
      (rt, c) => { const v = (lines[rt[0][1] + '|' + rt[1][1]] || {})[c[1]]; return c[1] === 'Life' ? 12 : v ?? (['Purchase Cost'].includes(c[1]) ? null : '') },
      (rt, c) => ({ RuleDerived: c[1] === 'Life', Consolidated: false }))
  }
}

test('line-item form (cards): only real requests show — a calculated field never makes an empty line appear', async () => {
  const b = await board('line-item-form', CAPEX, capexTM1())
  try {
    await until(() => b.doc.querySelectorAll('.lc').length, 'the cards')
    const cards = [...b.doc.querySelectorAll('.lc')]
    assert.equal(cards.length, 2)
    assert.match(cards[0].textContent, /Desks/); assert.match(cards[1].textContent, /Laptops.*Approved/)
    assert.notEqual(b.doc.getElementById('status').textContent, 'Loading…', 'the loading message clears')
  } finally { b.close() }
})

test('line-item form (cards): an approver opens a card and Approve sends exactly that line to the approve process', async () => {
  const b = await board('line-item-form', CAPEX, capexTM1())
  try {
    await until(() => b.doc.querySelector('.lc [data-toggle]'), 'a card')
    click(b.win, b.doc.querySelector('.lc [data-toggle]'))
    const approve = await until(() => b.doc.querySelector('.lc.open [data-act="approve"]'), 'the Approve button')
    click(b.win, approve)
    const run = await until(() => b.calls.find(c => c.method === 'runProcess'), 'the approve run')
    assert.deepEqual(plain(run.payload), { process: 'Lens Capex Approve', params: { pOrg: '101', pYear: 'Y2', pVersion: 'Target', pLine: '1', pAsset: '1200', pAction: 'Approve' } })
    await until(() => /Approved\./.test(b.doc.getElementById('status').textContent), 'the board to reload and say so')
  } finally { b.close() }
})

test('line-item form (cards): an approved card is locked, and a manager sees no Approve at all', async () => {
  const b = await board('line-item-form', CAPEX, capexTM1({ approver: false }))
  try {
    await until(() => b.doc.querySelectorAll('.lc').length === 2, 'the cards')
    click(b.win, b.doc.querySelectorAll('.lc [data-toggle]')[1])
    await until(() => b.doc.querySelector('.lc.open'), 'the open card')
    assert.ok([...b.doc.querySelectorAll('.lc.open [data-f]')].every(el => el.disabled), 'every field locked')
    assert.equal(b.doc.querySelector('.lc.open [data-act="save"]'), null)
    assert.equal(b.doc.querySelector('[data-act="approve"], [data-act="unapprove"]'), null, 'no approval buttons for a manager')
  } finally { b.close() }
})

test('line-item form (cards): + New request saves text and numbers to the next free line, and refuses a missing required field', async () => {
  const b = await board('line-item-form', CAPEX, capexTM1({ approver: false }))
  try {
    await until(() => b.doc.querySelectorAll('.lc').length === 2, 'the cards')
    click(b.win, b.doc.getElementById('add'))
    const card = await until(() => b.doc.querySelector('.lc.new.open'), 'the new card')
    assert.match(card.textContent, /12.*calculated/, 'the calculated life shows straight away')
    type(b.win, card.querySelector('[data-f="Description"]'), 'Shelving')
    click(b.win, card.querySelector('[data-act="save"]'))
    await until(() => /Fill in Cost/.test(card.textContent), 'the required-field message')
    assert.equal(b.calls.filter(c => c.method === 'writeCells').length, 0, 'nothing saved without a cost')
    type(b.win, card.querySelector('[data-f="Purchase Cost"]'), '4,500')
    click(b.win, card.querySelector('[data-act="save"]'))
    const w = await until(() => b.calls.find(c => c.method === 'writeCells'), 'the save')
    assert.equal(w.payload.cube, 'Capital')
    const at = f => w.payload.cells.find(c => c.coordinates.Capital === f)
    // The first free line for the asset type picked (Furniture — line 1 is taken).
    assert.deepEqual(plain(at('Description')), { coordinates: { Version: 'Target', organization: '101', Year: 'Y2', CapitalList: '2', 'Asset Types': '1200', Capital: 'Description' }, value: 'Shelving', expect: '' })
    assert.equal(at('Purchase Cost').value, 4500)
  } finally { b.close() }
})

test('a board with missing settings says what it needs instead of breaking', async () => {
  for (const name of ['line-item-form', 'input-form']) {
    const b = await board(name, { heading: 'x' }, () => ({}))
    try { assert.match(b.doc.getElementById('grid').textContent, /needs its settings/) } finally { b.close() }
  }
})

// ── Input form ───────────────────────────────────────────────────────────────
const TARGETS = {
  heading: 'Target input', cube: 'Income Statement',
  version: { dimension: 'Version', member: 'Target' }, fixed: { 'Currency Calc': 'Local' },
  unit: { dimension: 'organization', level: 0, label: 'Store' },
  period: { dimension: 'Year', members: ['Y2'], label: 'Year' },
  rows: { dimension: 'Account', under: 'TE', label: 'Account' },
  columns: { dimension: 'Month', members: ['Jan', 'Feb'], total: 'Year' },
  spread: { process: 'Lens Spread Target', unit: 'pOrg', period: 'pYear', row: 'pAccount', total: 'pTotal' },
  writes: ['Income Statement'], runs: ['Lens Spread Target'],
}
function targetsTM1(method, p) {
  if (['history', 'liveJoin', 'liveSend'].includes(method)) return method === 'history' ? [] : {}
  if (method === 'runProcess') return { status: 'CompletedSuccessfully', message: 'Spread.', seconds: 0.1 }
  if (method === 'whoami') return { user: 'east_mgr', groups: [] }
  const q = p.mdx
  if (/ElementAttributes/.test(q)) throw new Error('no access')
  if (/SELECT \{\} ON 0/.test(q)) return cellset([], [[['organization', '101']]], () => null)
  return cellset([['Month', 'Jan'], ['Month', 'Feb'], ['Month', 'Year']], [[['Account', '6100']], [['Account', '6000']]],
    (rt, c) => (c[1] === 'Year' ? 300 : 150),
    (rt, c) => ({ RuleDerived: rt[0][1] === '6000', Consolidated: c[1] === 'Year' }))
}

test('input form: rows load, only input rows can be spread, and Spread sends the right parameters', async () => {
  const b = await board('input-form', TARGETS, targetsTM1)
  try {
    await until(() => b.doc.querySelector('#spRow option'), 'the spread rows')
    assert.deepEqual(plain([...b.doc.querySelectorAll('#spRow option')].map(o => o.value)), ['6100'], 'a calculated row cannot be spread')
    b.doc.getElementById('spTotal').value = '1200'
    b.doc.getElementById('spGo').disabled = false
    click(b.win, b.doc.getElementById('spGo'))
    const run = await until(() => b.calls.find(c => c.method === 'runProcess'), 'the spread run')
    assert.deepEqual(plain(run.payload), { process: 'Lens Spread Target', params: { pOrg: '101', pYear: 'Y2', pAccount: '6100', pTotal: 1200 } })
    await until(() => /Spread\./.test(b.doc.getElementById('spStatus').textContent), 'the board to reload and say so')
  } finally { b.close() }
})
