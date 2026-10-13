// ── The Lens toolkit (window.Lens) ────────────────────────────────────────────
// Tested building blocks for Lenses, bundled into static/lens-kit/lens-kit.js and
// served by the IDE and the Lens app — never loaded from the internet, so a
// Lens's sandbox (no network) stays intact. Each block understands TM1 results
// via Lens.rows and shares one theme. Libraries: Apache ECharts (Apache-2.0),
// AG Grid Community, React Flow + dagre, Alpine.js (MIT). See THIRD_PARTY_LICENSES.

import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart, PieChart, HeatmapChart, SankeyChart, TreeChart, GaugeChart, SunburstChart, TreemapChart, RadarChart, FunnelChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, VisualMapComponent, TitleComponent, RadarComponent, GraphicComponent, MarkPointComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { createGrid, ModuleRegistry, AllCommunityModule, themeQuartz, colorSchemeDark } from 'ag-grid-community'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, Background, Controls, MarkerType } from '@xyflow/react'
import flowCss from '@xyflow/react/dist/style.css?inline'
import dagre from '@dagrejs/dagre'
import Alpine from '@alpinejs/csp'
import { rows, format, better, localTime } from './rows.js'
import { COMPONENTS, TOOLKIT_VERSION } from './components.js'

echarts.use([BarChart, LineChart, ScatterChart, PieChart, HeatmapChart, SankeyChart, TreeChart, GaugeChart,
  SunburstChart, TreemapChart, RadarChart, FunnelChart,
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, VisualMapComponent, TitleComponent,
  RadarComponent, GraphicComponent, MarkPointComponent, CanvasRenderer])
ModuleRegistry.registerModules([AllCommunityModule])

// ── Theme ──────────────────────────────────────────────────────────────────────
const dark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
const PALETTE = {
  light: { ink: '#16201f', soft: '#4b5756', faint: '#85908f', rule: '#dfe4e3', panel: '#ffffff', bg: '#f6f7f7', accent: '#0f766e', compare: '#16201f', good: '#1d7a46', bad: '#b4372d', amber: '#a86a12', series: ['#0f766e', '#2b5ea7', '#a86a12', '#7c3aed', '#b4372d', '#475569'] },
  dark:  { ink: '#e6ecea', soft: '#b2bdbb', faint: '#7d8987', rule: '#26302f', panel: '#161e1d', bg: '#0f1514', accent: '#3fb8aa', compare: '#e6ecea', good: '#4cc27f', bad: '#ef7d70', amber: '#e2a64a', series: ['#3fb8aa', '#7aa7e8', '#e2a64a', '#a78bfa', '#ef7d70', '#94a3b8'] },
}
const theme = { get colors() { return dark() ? PALETTE.dark : PALETTE.light }, format, better }

function host(el) {
  const node = typeof el === 'string' ? document.querySelector(el) : el
  if (!node) throw new Error('Lens: element not found — ' + el)
  return node
}

// One ECharts instance per element, resized with its container.
function chart(el, option) {
  const node = host(el)
  if (!node.style.height && !node.clientHeight) node.style.height = '260px'
  const existing = echarts.getInstanceByDom(node)
  const c = existing || echarts.init(node, null, { renderer: 'canvas' })
  c.setOption(option, true)
  if (!existing && window.ResizeObserver) new ResizeObserver(() => c.resize()).observe(node)
  return c
}
const axisStyle = t => ({ axisLine: { lineStyle: { color: t.rule } }, axisTick: { show: false }, axisLabel: { color: t.faint }, splitLine: { lineStyle: { color: t.rule } } })

// ── kpis ──────────────────────────────────────────────────────────────────────
function kpis(el, items, { compareLabel } = {}) {
  const t = theme.colors, node = host(el)
  node.style.display = 'grid'
  node.style.gridTemplateColumns = 'repeat(auto-fit, minmax(170px, 1fr))'
  node.style.gap = '10px'
  node.innerHTML = (items || []).map(it => {
    const fmt = it.format || 'number'
    const has = it.compare !== undefined && it.compare !== null
    const diff = has ? Number(it.value) - Number(it.compare) : null
    const ok = has ? better(it.value, it.compare, { cost: !!it.cost }) : true
    const rel = has && Number(it.compare) ? diff / Math.abs(Number(it.compare)) : null
    const label = it.compareLabel || compareLabel || 'comparison'
    return `<div style="background:${t.panel};border:1px solid ${t.rule};border-radius:10px;padding:10px 12px">
      <div style="font-size:11px;color:${t.faint};text-transform:uppercase;letter-spacing:.06em">${esc(it.label)}</div>
      <div style="font-size:24px;font-weight:700;color:${t.ink};font-variant-numeric:tabular-nums">${format(it.value, fmt)}</div>
      ${has ? `<div style="font-size:12.5px;color:${ok ? t.good : t.bad};font-variant-numeric:tabular-nums">${diff >= 0 ? '+' : '−'}${format(Math.abs(diff), fmt).replace('−', '')}${rel === null ? '' : ' (' + (rel >= 0 ? '+' : '−') + Math.abs(rel * 100).toFixed(1) + '%)'} vs ${esc(label)}</div>
      <div style="font-size:12px;color:${t.faint}">${esc(label)} ${format(it.compare, fmt)}${it.note ? ' · ' + esc(it.note) : ''}</div>` : (it.note ? `<div style="font-size:12px;color:${t.faint}">${esc(it.note)}</div>` : '')}
    </div>`
  }).join('')
  return node
}

// ── trend ─────────────────────────────────────────────────────────────────────
// series: [{ name, values, type: 'bar' | 'line', compare: true }]
function trend(el, { categories = [], series = [], format: fmt = 'number', cost = false } = {}) {
  const t = theme.colors
  const cmp = series.find(s => s.compare)
  return chart(el, {
    animationDuration: 500,
    grid: { left: 60, right: 14, top: 30, bottom: 28 },
    legend: { top: 0, right: 0, textStyle: { color: t.soft } },
    tooltip: { trigger: 'axis', valueFormatter: v => format(v, fmt) },
    xAxis: { type: 'category', data: categories, ...axisStyle(t) },
    yAxis: { type: 'value', ...axisStyle(t), axisLabel: { color: t.faint, formatter: v => format(v, fmt) } },
    series: series.map((s, i) => s.compare
      ? { name: s.name, type: 'line', data: s.values, symbolSize: 6, lineStyle: { width: 2, type: 'dashed', color: t.compare }, itemStyle: { color: t.compare } }
      : { name: s.name, type: s.type || 'bar', data: s.values.map((v, k) => ({ value: v, itemStyle: cmp ? { color: better(v, cmp.values[k], { cost }) ? t.accent : t.bad } : { color: t.series[i % t.series.length] } })), barMaxWidth: 34, itemStyle: { borderRadius: [3, 3, 0, 0] }, smooth: s.type === 'line' }),
  })
}

// ── waterfall ─────────────────────────────────────────────────────────────────
// steps: [{ label, value, total: true }, { label, value }, ..., { label, value, total: true }]
function waterfall(el, { steps = [], format: fmt = 'number' } = {}) {
  const t = theme.colors
  let run = 0
  const base = [], up = [], down = [], tot = []
  steps.forEach(s => {
    if (s.total) { base.push(0); up.push('-'); down.push('-'); tot.push(s.value); run = s.value }
    else if (s.value >= 0) { base.push(run); up.push(s.value); down.push('-'); tot.push('-'); run += s.value }
    else { run += s.value; base.push(run); up.push('-'); down.push(-s.value); tot.push('-') }
  })
  const lo = Math.min(0, ...steps.map((s, i) => base[i]))
  return chart(el, {
    animationDuration: 500,
    grid: { left: 60, right: 10, top: 14, bottom: 60 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: ps => { const i = ps[0].dataIndex, s = steps[i]; return esc(s.label) + ': ' + (s.total ? '' : (s.value >= 0 ? '+' : '')) + format(s.value, fmt) } },
    xAxis: { type: 'category', data: steps.map(s => s.label), ...axisStyle(t), axisLabel: { color: t.soft, interval: 0, rotate: 30, fontSize: 11 } },
    yAxis: { type: 'value', min: lo < 0 ? undefined : 0, ...axisStyle(t), axisLabel: { color: t.faint, formatter: v => format(v, fmt) } },
    series: [
      { type: 'bar', stack: 'w', data: base, itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, tooltip: { show: false } },
      { type: 'bar', stack: 'w', data: tot, itemStyle: { color: t.ink, borderRadius: 3 } },
      { type: 'bar', stack: 'w', data: up, itemStyle: { color: t.good, borderRadius: 3 } },
      { type: 'bar', stack: 'w', data: down, itemStyle: { color: t.bad, borderRadius: 3 } },
    ],
  })
}

// ── bars ──────────────────────────────────────────────────────────────────────
// rows: [{ key, label, value, compare }]; onClick(key) for drill-down
function bars(el, { rows: data = [], format: fmt = 'number', cost = false, onClick } = {}) {
  const t = theme.colors
  const node = host(el)
  if (!node.style.height) node.style.height = Math.max(140, data.length * 38 + 30) + 'px'
  const c = chart(node, {
    animationDuration: 500,
    grid: { left: 130, right: 70, top: 8, bottom: 20 },
    tooltip: { trigger: 'item', formatter: p => { const r = data[p.dataIndex]; return esc(r.label) + ': ' + format(r.value, fmt) + (r.compare !== undefined ? ' · comparison ' + format(r.compare, fmt) : '') } },
    xAxis: { type: 'value', ...axisStyle(t), axisLabel: { color: t.faint, formatter: v => format(v, fmt) } },
    yAxis: { type: 'category', inverse: true, data: data.map(r => r.label), ...axisStyle(t), axisLabel: { color: t.ink } },
    series: [
      { type: 'bar', barMaxWidth: 18, data: data.map(r => ({ value: r.value, itemStyle: { color: r.compare === undefined ? t.accent : (better(r.value, r.compare, { cost }) ? t.accent : t.bad), borderRadius: 3 } })),
        label: { show: data.some(r => r.compare !== undefined), position: 'right', color: t.soft, formatter: p => { const r = data[p.dataIndex]; if (r.compare === undefined) return ''; const d = r.value - r.compare; return (d >= 0 ? '+' : '') + format(d, fmt) } } },
      { type: 'scatter', symbol: 'rect', symbolSize: [3, 24], data: data.map(r => r.compare === undefined ? null : r.compare), itemStyle: { color: t.compare }, tooltip: { show: false }, z: 3 },
    ],
  })
  c.off('click')
  if (onClick) { c.on('click', p => { if (p.seriesIndex === 0) onClick(data[p.dataIndex].key ?? data[p.dataIndex].label) }); node.style.cursor = 'pointer' }
  return c
}

// ── grid ──────────────────────────────────────────────────────────────────────
// columns: [{ field, headerName, type: 'number' | 'text', format, editable }]
// An `editable` column takes input only where the row allows it: a row from
// Lens.rows carries _input (false = TM1 calculates that cell), so calculated
// cells stay read-only. Input cells are tinted; typed values are highlighted
// until saved. Returns { api, changes(), undo(), saved(), mark(), setValue(),
// unmark() } — mark/setValue show what someone else is doing (working together).
function grid(el, { columns = [], rows: data = [], height, onEdit, onFocus } = {}) {
  const t = theme.colors, node = host(el)
  node.innerHTML = ''
  node.style.height = height || node.style.height || Math.min(480, 44 + data.length * 36) + 'px'
  const gridTheme = dark() ? themeQuartz.withPart(colorSchemeDark) : themeQuartz
  const orig = new Map()                       // 'rowIndex|field' -> value before typing
  const remote = new Map()                     // 'rowIndex|field' -> { color, label } — someone else's cursor
  const typed = new Map()                      // 'rowIndex|field' -> colour — someone else's unsaved value
  const keyOf = (row, field) => data.indexOf(row) + '|' + field
  const canEdit = (c, row) => !!c.editable && !(row && row._input && row._input[c.field] === false)
  const tint = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0')
  let api = null
  const changes = () => [...orig.keys()].map(k => {
    const [i, field] = [Number(k.slice(0, k.indexOf('|'))), k.slice(k.indexOf('|') + 1)]
    return { row: data[i], field, value: data[i][field], old: orig.get(k) }
  })
  const refresh = () => api && api.refreshCells({ force: true })
  api = createGrid(node, {
    theme: gridTheme,
    rowData: data,
    singleClickEdit: true,
    stopEditingWhenCellsLoseFocus: true,
    defaultColDef: { sortable: true, resizable: true, filter: true, editable: false },
    columnDefs: columns.map(c => {
      const def = c.type === 'number'
        ? { ...c, type: 'rightAligned', valueFormatter: p => format(p.value, c.format || 'number') }
        : { ...c }
      // Styling on every column, editable or not: a watcher's grid is read-only
      // but must still show someone else's cursor and unsaved typing.
      // Every key, every time: the grid only ADDS styles on refresh, so a style
      // left out (e.g. someone's outline that moved on) would stick.
      const plain = { background: '', fontWeight: '', color: '', boxShadow: 'none', fontStyle: '' }
      def.cellStyle = p => {
        const k = keyOf(p.data, c.field), r = remote.get(k), other = typed.get(k)
        const base = orig.has(k) ? Object.assign({}, plain, { background: tint(t.amber, 0.22), fontWeight: '600' })
          : other ? Object.assign({}, plain, { background: other + '2e', fontWeight: '600', fontStyle: 'italic' })
          : !c.editable ? plain
          : canEdit(c, p.data) ? Object.assign({}, plain, { background: tint(t.accent, 0.08) })
          : Object.assign({}, plain, { color: t.faint })
        return r ? Object.assign({}, base, { boxShadow: 'inset 0 0 0 2px ' + r.color, background: r.color + '26', fontWeight: '700' }) : base
      }
      def.tooltipValueGetter = p => { const k = keyOf(p.data, c.field), r = remote.get(k); return r ? r.label : typed.has(k) ? 'Typed by someone else — not saved yet' : null }
      if (!c.editable) return def
      def.editable = p => canEdit(c, p.data)
      if (c.type === 'number') {
        def.valueParser = p => {
          const v = Number(String(p.newValue ?? '').replace(/[,$\s]/g, ''))
          return String(p.newValue ?? '').trim() === '' ? 0 : (Number.isFinite(v) ? v : p.oldValue)
        }
      }
      return def
    }),
    onCellFocused: p => {
      if (!onFocus || p.rowIndex == null || !p.column) return
      const node = api && api.getDisplayedRowAtIndex(p.rowIndex)
      if (node) onFocus(node.data, p.column.getColId ? p.column.getColId() : p.column)
    },
    tooltipShowDelay: 0,
    onCellValueChanged: p => {
      const k = keyOf(p.data, p.colDef.field)
      if (!orig.has(k)) orig.set(k, p.oldValue)
      if (Number(orig.get(k) ?? 0) === Number(p.newValue ?? 0)) orig.delete(k)
      refresh()
      if (onEdit) onEdit(changes())
    },
    autoSizeStrategy: { type: 'fitGridWidth' },
  })
  return {
    api,
    changes,
    // put every typed value back
    undo() { for (const ch of changes()) ch.row[ch.field] = ch.old; orig.clear(); api.setGridOption('rowData', data); if (onEdit) onEdit([]) },
    // the typed values are now in TM1: stop highlighting them
    saved() { orig.clear(); refresh(); if (onEdit) onEdit([]) },
    // Working together: outline the cell someone else is on (one per person —
    // `who` keys it), and show a value they typed (never over my own typing).
    mark(match, field, who, { color, label } = {}) {
      for (const [k, v] of remote) if (v.who === who) remote.delete(k)
      const i = data.findIndex(match)
      if (i >= 0 && field) remote.set(i + '|' + field, { who, color, label })
      refresh()
    },
    unmark(who) { for (const [k, v] of remote) if (v.who === who) remote.delete(k); refresh() },
    // color: show it as someone else's unsaved number (tinted in their colour
    // until they save — a fresh grid after the save clears it).
    setValue(match, field, value, color) {
      const i = data.findIndex(match)
      if (i < 0 || orig.has(i + '|' + field)) return
      data[i][field] = value
      if (color) typed.set(i + '|' + field, color)
      refresh()
    },
  }
}

// ── save ──────────────────────────────────────────────────────────────────────
// Write numbers to TM1 as the signed-in user, through the host (the Lens has no
// network). cells: [{ coordinates: { dim: element, … }, value, expect }] —
// `expect` is the value the screen showed, so a cell someone else changed since
// is caught. The Lens must declare the cube: <meta name="lens-writes" content="Cube">.
// Resolves { written }; rejects with the reason (nothing is half-saved).
function save(cube, cells) {
  if (!window.lensBridge) return Promise.reject(new Error('saving needs the Lens app or the IDE preview'))
  return window.lensBridge.call('writeCells', { cube, cells })
}

// ── flow ──────────────────────────────────────────────────────────────────────
// nodes: [{ id, label, sub, kind: 'root' | 'good' | 'bad' | 'neutral' }]; edges: [{ source, target, label }]
let flowCssInjected = false
function flow(el, { nodes = [], edges = [], direction = 'TB', onClick } = {}) {
  const t = theme.colors, node = host(el)
  if (!flowCssInjected) { const st = document.createElement('style'); st.textContent = flowCss; document.head.appendChild(st); flowCssInjected = true }
  if (!node.style.height && !node.clientHeight) node.style.height = '420px'
  const W = 150, H = 56
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: direction, nodesep: 30, ranksep: 70 })
  g.setDefaultEdgeLabel(() => ({}))
  nodes.forEach(n => g.setNode(String(n.id), { width: W, height: H }))
  edges.forEach(e => g.setEdge(String(e.source), String(e.target)))
  dagre.layout(g)
  const fill = { root: t.accent, good: t.panel, bad: t.panel, neutral: t.panel }
  const border = { root: t.accent, good: t.good, bad: t.bad, neutral: t.rule }
  const rfNodes = nodes.map(n => {
    const p = g.node(String(n.id)) || { x: 0, y: 0 }
    const k = n.kind || 'neutral'
    return {
      id: String(n.id), position: { x: p.x - W / 2, y: p.y - H / 2 },
      data: { label: React.createElement('div', null,
        React.createElement('div', { style: { fontWeight: 700, fontSize: 13 } }, n.label ?? n.id),
        n.sub ? React.createElement('div', { style: { fontSize: 10.5, opacity: 0.8 } }, n.sub) : null) },
      style: { width: W, borderRadius: 9, border: '1.6px solid ' + border[k], background: fill[k], color: k === 'root' ? '#fff' : t.ink, padding: 6, fontFamily: 'inherit' },
    }
  })
  const rfEdges = edges.map((e, i) => ({
    id: 'e' + i, source: String(e.source), target: String(e.target), label: e.label,
    markerEnd: { type: MarkerType.ArrowClosed, color: t.faint }, style: { stroke: t.faint },
    labelStyle: { fill: t.soft, fontSize: 11 }, labelBgStyle: { fill: t.panel },
  }))
  if (node.__lensRoot) node.__lensRoot.unmount()
  const root = createRoot(node)
  node.__lensRoot = root
  root.render(React.createElement(ReactFlow, {
    nodes: rfNodes, edges: rfEdges, fitView: true, nodesConnectable: false, proOptions: { hideAttribution: true },
    onNodeClick: onClick ? (_e, n) => onClick(n.id) : undefined,
  }, React.createElement(Background, { color: t.rule, gap: 18 }), React.createElement(Controls, { showInteractive: false })))
  return root
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

// ── editing ───────────────────────────────────────────────────────────────────
// Start / Finish editing with TM1 data reservations, for an input Lens. Shows
// who is editing (times in the viewer's zone), takes and hands back the
// reservation through a reservation process, hands it back when the Lens
// switches to another slice, and asks "Still editing?" after a quiet spell.
//
// When it applies — <meta name="lens-reservations" content="auto|always|off">
// (or option `mode`): auto (default) = only when the cube REQUIRES reservations;
// always = whenever TM1 allows them; off = never. With no reservation needed
// the bar hides itself and state is 'open'.
//
// The reservation process (declared in lens-runs) takes the target's params
// plus pAction = Take | Release | Check | ReleaseAll, and leaves in Lens
// Messages: Result free | mine | taken, Message, Since (UTC), Detail (the
// cube's DATARESERVATIONMODE). See the Lens Reserve process for an example.
function metaContent(name) {
  const m = document.querySelector('meta[name="' + name + '"]')
  return m ? String(m.getAttribute('content') || '').trim().toLowerCase() : ''
}

function editing(el, { process = 'Lens Reserve', target, mode, idleMinutes = 20, graceMinutes = 5, hasChanges = () => false, save, onChange } = {}) {
  const t = theme.colors, node = host(el)
  mode = (mode || metaContent('lens-reservations') || 'auto').toLowerCase()
  const btn = primary => 'font:inherit;font-size:13px;padding:5px 10px;border-radius:7px;cursor:pointer;border:1px solid ' + (primary ? t.accent : t.rule) + ';background:' + (primary ? t.accent : t.panel) + ';color:' + (primary ? '#fff' : t.ink) + (primary ? ';font-weight:600' : '')
  node.innerHTML =
    '<div data-bar style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border-radius:8px;border:1px solid ' + t.rule + ';background:' + t.bg + '">' +
    '<span data-who style="font-size:13px;font-weight:600;color:' + t.ink + '">Checking who is editing…</span>' +
    '<button data-start hidden style="' + btn(true) + '">Start editing</button>' +
    '<button data-finish hidden style="' + btn(false) + '">Finish editing</button>' +
    '<span data-note style="font-size:12.5px;color:' + t.bad + '"></span></div>' +
    '<div data-idle style="display:none;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;margin-top:8px;border-radius:8px;border:1.5px solid ' + t.amber + ';background:' + t.panel + ';color:' + t.ink + '">' +
    '<b data-q style="font-size:14px">Still editing?</b><span style="font-size:13px">Others can\'t change this while you have it.</span>' +
    '<button data-keep style="' + btn(true) + '">Keep editing</button><button data-done style="' + btn(false) + '">Finish editing</button>' +
    '<span data-count style="font-size:12.5px;color:' + t.faint + ';font-variant-numeric:tabular-nums"></span></div>'
  const q = s => node.querySelector(s)
  const key = p => JSON.stringify(p || {})
  let state = 'free', held = null, lastActive = Date.now(), deadline = 0
  const note = text => { q('[data-note]').textContent = text || '' }
  const call = (action, params) => run(process, Object.assign({}, params, { pAction: action }))

  function apply(r, params) {
    const tm1Mode = String(r.detail || '').toUpperCase()
    const needed = mode === 'off' ? false
      : mode === 'always' ? (tm1Mode !== '' && tm1Mode !== 'OFF')
      : /^REQUIRED/.test(tm1Mode)
    if (!needed) { state = 'open'; held = null; node.hidden = true; return state }
    node.hidden = false
    state = r.result === 'mine' || r.result === 'taken' ? r.result : 'free'
    if (state === 'mine') held = params
    else if (held && key(held) === key(params)) held = null
    q('[data-who]').textContent = r.since ? String(r.message || '').replace(/\.$/, '') + ' since ' + localTime(r.since) + '.' : (r.message || '')
    q('[data-bar]').style.borderColor = state === 'mine' ? t.accent : state === 'taken' ? t.amber : t.rule
    q('[data-start]').hidden = state !== 'free'
    q('[data-finish]').hidden = state !== 'mine'
    note('')
    return state
  }
  const changed = why => { if (onChange) onChange(state, why) }

  const api = {
    get state() { return state },
    // Cells may take input: no reservation needed, or I hold it.
    get canEdit() { return state === 'open' || state === 'mine' },
    // Never rejects: if the check itself fails (e.g. this person may not run
    // the reservation process), state is 'unavailable' — the Lens still shows
    // its numbers, read-only, and the bar says why.
    check() {
      if (mode === 'off') { state = 'open'; node.hidden = true; return Promise.resolve(state) }
      const p = target()
      return call('Check', p).then(r => apply(r, p), e => {
        state = 'unavailable'; held = null; node.hidden = false
        q('[data-who]').textContent = 'Editing isn\'t available: ' + (e && e.message ? e.message : e)
        q('[data-bar]').style.borderColor = t.rule
        q('[data-start]').hidden = q('[data-finish]').hidden = true
        return state
      })
    },
    // The Lens now shows another slice: hand back the one I held, then check.
    refresh() {
      const prev = held
      // Best effort: the timeout layers hand it back anyway if this fails.
      return (prev && key(prev) !== key(target()) ? call('Release', prev).then(() => { held = null }, () => { held = null }) : Promise.resolve()).then(api.check)
    },
    take() {
      const p = target()
      return call('Take', p).then(r => { apply(r, p); lastActive = Date.now(); changed('take'); return state })
    },
    release(why) {
      const p = held || target()
      return call('Release', p).then(r => { apply(r, target()); changed(why || 'release'); return state })
    },
  }

  q('[data-start]').onclick = () => { q('[data-start]').disabled = true; api.take().catch(e => note(e.message)).then(() => { q('[data-start]').disabled = false }) }
  q('[data-finish]').onclick = () => {
    if (hasChanges()) return note('Save or undo your changes before you finish editing.')
    q('[data-finish]').disabled = true
    api.release().catch(e => note(e.message)).then(() => { q('[data-finish]').disabled = false })
  }

  // "Still editing?" — after idleMinutes without typing or clicking, ask; after
  // graceMinutes more, finish automatically (typed numbers stay on screen).
  // display, not the hidden attribute: an inline display would override it.
  const hideIdle = () => { deadline = 0; q('[data-idle]').style.display = 'none'; lastActive = Date.now() }
  ;['keydown', 'mousedown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { if (!deadline) lastActive = Date.now() }, true))
  q('[data-keep]').onclick = hideIdle
  q('[data-done]').onclick = () => {
    hideIdle()
    const first = hasChanges() && save ? Promise.resolve(save()) : Promise.resolve()
    first.then(() => { if (hasChanges()) throw new Error('Not saved, so you are still editing — your changes are on screen.') ; return api.release() })
      .catch(e => note(e.message))
  }
  setInterval(() => {
    if (state !== 'mine') { if (deadline) hideIdle(); return }
    const now = Date.now()
    if (!deadline && now - lastActive > idleMinutes * 60000) {
      deadline = now + graceMinutes * 60000
      q('[data-done]').textContent = hasChanges() && save ? 'Save and finish' : 'Finish editing'
      q('[data-idle]').style.display = 'flex'
    }
    if (deadline) {
      const left = Math.max(0, deadline - now)
      q('[data-count]').textContent = 'finishing automatically in ' + Math.floor(left / 60000) + ':' + String(Math.floor(left / 1000) % 60).padStart(2, '0')
      if (!left) { hideIdle(); api.release('timeout').catch(e => note(e.message)) }
    }
  }, 1000)
  return api
}

// ── live (working together, Lens app only) ────────────────────────────────────
// Who else has this Lens open on the same channel (a row of coloured initials),
// and a way to send and hear events. The server stamps every event with the
// real sender: ev.from = { id, user, color }.
//   const tg = Lens.live('#people', { onEvent: ev => … })
//   tg.join('store:101|Y2'); tg.send('typing', { account, month, value })
function live(el, { onEvent } = {}) {
  const t = theme.colors, node = host(el)
  let me = null, members = [], channel = null
  const initials = u => String(u || '?').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  function paint() {
    // Each person once, however many tabs or connections they have.
    const people = []
    for (const m of members) if (!people.some(p => p.user === m.user)) people.push(me && m.user === me.user ? me : m)
    const others = people.filter(m => !me || m.user !== me.user)
    node.innerHTML = '<div style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:' + t.faint + '">' +
      people.map(m => '<span title="' + esc(m.user + (me && m.id === me.id ? ' (you)' : '')) + '" style="width:26px;height:26px;border-radius:50%;display:inline-grid;place-items:center;font-size:11px;font-weight:700;color:#fff;background:' + m.color + ';box-shadow:0 0 0 2px ' + t.panel + (me && m.id === me.id ? ',0 0 0 3px ' + m.color : '') + '">' + esc(initials(m.user)) + '</span>').join('') +
      '<span style="margin-left:4px">' + (!members.length ? 'Connecting…' : others.length ? esc(others.map(m => m.user).join(', ')) + (others.length === 1 ? ' is' : ' are') + ' here too' : 'Only you here') + '</span></div>'
  }
  paint()
  if (window.lensBridge && window.lensBridge.onLive) {
    window.lensBridge.onLive(ev => {
      if (ev.type === 'hello') { me = ev.you; members = ev.members || [] }
      else if (ev.type === 'join') { if (!members.some(m => m.id === ev.member.id)) members.push(ev.member) }
      else if (ev.type === 'leave') { members = members.filter(m => m.id !== ev.id) }
      else { if (onEvent) onEvent(ev); return }
      paint()
      if (onEvent && (ev.type === 'join' || ev.type === 'leave')) onEvent(ev)
    })
  }
  return {
    get me() { return me },
    get members() { return members.slice() },
    join(ch) {
      if (ch === channel) return Promise.resolve()
      channel = ch; me = null; members = []; paint()
      return window.lensBridge.call('liveJoin', { channel: ch }).catch(() => { node.hidden = true })
    },
    send(type, data) { return window.lensBridge.call('liveSend', { event: Object.assign({}, data, { type }) }).catch(() => {}) },
  }
}

// ── history (Lens app only) ───────────────────────────────────────────────────
// Recent saves and runs through this Lens for one slice the person can see,
// newest first: Lens.history({ organization: '101', Year: 'Y2' }, { limit, skip:
// ['Lens Reserve'] }) — skip leaves out processes that would only be noise.
function history(match, { limit = 30, skip = [] } = {}) {
  return window.lensBridge.call('history', { match: match || {}, limit, skip })
}

// ── run ───────────────────────────────────────────────────────────────────────
// Run a TI process as the signed-in user (an action button). params: { pName:
// 'text' | number } — only parameters the process has. The Lens must declare
// it: <meta name="lens-runs" content="Process">. Resolves { status, seconds,
// message, result, since } (what the process reported; result is a short
// outcome such as free / mine / taken; since a UTC time for Lens.localTime);
// rejects with the reason.
function run(process, params) {
  if (!window.lensBridge) return Promise.reject(new Error('running a process needs the Lens app or the IDE preview'))
  return window.lensBridge.call('runProcess', { process, params: params || {} })
}

const Lens = { version: TOOLKIT_VERSION, components: COMPONENTS.slice(), rows, format, localTime, theme, kpis, trend, waterfall, bars, grid, flow, editing, live, history, save, run, echarts }
const missing = COMPONENTS.filter(n => typeof Lens[n] !== 'function')
if (missing.length) throw new Error('Lens toolkit is missing: ' + missing.join(', '))

window.Lens = Lens
// Alpine (CSP build — no code evaluation, so it works under every Lens frame's
// security header): register behaviour with Alpine.data(...) and reference it
// from x-data / @click by name.
window.Alpine = Alpine
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Alpine.start())
else Alpine.start()

export default Lens
