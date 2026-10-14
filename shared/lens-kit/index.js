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
import THEMES from '../lens-themes.json'

echarts.use([BarChart, LineChart, ScatterChart, PieChart, HeatmapChart, SankeyChart, TreeChart, GaugeChart,
  SunburstChart, TreemapChart, RadarChart, FunnelChart,
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, VisualMapComponent, TitleComponent,
  RadarComponent, GraphicComponent, MarkPointComponent, CanvasRenderer])
ModuleRegistry.registerModules([AllCommunityModule])

// ── Theme ──────────────────────────────────────────────────────────────────────
// The viewer's own choice (the Lens app hands it over as window.__lensTheme =
// { mode: 'light' | 'dark' | 'system', palette: 'teal' | 'ocean' | … }); with
// none — or a Lens whose config says theme: 'fixed' — it follows the computer.
const chosen = () => (typeof window !== 'undefined' && window.__lensTheme) || {}
const systemDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
const dark = () => chosen().mode === 'dark' || (chosen().mode !== 'light' && systemDark())
function paletteFor(name, isDark) {
  const t = THEMES.themes[name] || THEMES.themes[THEMES.default]
  return Object.assign({}, THEMES.base[isDark ? 'dark' : 'light'], t[isDark ? 'dark' : 'light'])
}
const theme = {
  get colors() { return paletteFor(chosen().palette, dark()) },
  get mode() { return dark() ? 'dark' : 'light' },
  get name() { return THEMES.themes[chosen().palette] ? chosen().palette : THEMES.default },
  format, better,
}
// The colours as CSS variables, so a Lens styles itself with the viewer's
// theme: background: var(--lens-bg); color: var(--lens-ink); … (and
// color-scheme, so form controls and scrollbars match).
const VAR_KEYS = ['bg', 'panel', 'ink', 'soft', 'faint', 'rule', 'accent', 'good', 'bad', 'amber', 'calcBg', 'totalBg']
function applyThemeVars() {
  if (typeof document === 'undefined') return
  const c = theme.colors, root = document.documentElement
  for (const k of VAR_KEYS) root.style.setProperty('--lens-' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), c[k])
  root.style.colorScheme = theme.mode
  root.setAttribute('data-lens-theme', theme.name + ' ' + theme.mode)
}
applyThemeVars()
if (typeof window !== 'undefined' && window.matchMedia) {
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeVars) } catch { /* older browsers */ }
}

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
const BLUE = '#2b7de9'   // typed-not-saved fill/border and the saved-not-submitted corner, both themes
theme.blue = BLUE         // for a Lens's own legend (Lens.legend draws the standard one)
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
  const pending = new Map()                    // 'rowIndex|field' -> label — saved, not yet handed in (e.g. submitted)
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
      // One scheme for every Lens and every viewer (the editor and anyone
      // watching see the same): blue fill + blue border = typed, not saved
      // (mine or someone else's); blue corner = saved, not yet submitted;
      // grey = calculated by a rule; darker grey = a total; white = input.
      // Someone else's cursor: a thin outline in their colour.
      // Every key, every time: the grid only ADDS styles on refresh, so a style
      // left out (e.g. an outline that moved on) would stick.
      const plain = { background: '', backgroundImage: 'none', fontWeight: '', color: '', boxShadow: 'none', fontStyle: '' }
      def.cellStyle = p => {
        const k = keyOf(p.data, c.field), r = remote.get(k)
        const kind = p.data && p.data._kind ? p.data._kind[c.field] : null
        let st = Object.assign({}, plain)
        if (kind === 'total') st.background = t.totalBg
        else if (kind === 'calc') st.background = t.calcBg
        if (orig.has(k) || typed.has(k)) Object.assign(st, { background: tint(BLUE, 0.16), boxShadow: 'inset 0 0 0 1.5px ' + BLUE, fontWeight: '600' })
        else if (pending.has(k)) st.backgroundImage = 'linear-gradient(225deg, ' + BLUE + ' 0, ' + BLUE + ' 7px, transparent 7px)'
        if (r) st.boxShadow = 'inset 0 0 0 2px ' + r.color
        return st
      }
      def.tooltipValueGetter = p => {
        const k = keyOf(p.data, c.field), r = remote.get(k)
        return r ? r.label : typed.has(k) ? 'Typed by ' + typed.get(k) + ' — not saved yet' : pending.get(k) || null
      }
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
    // Mark cells saved but not yet handed in (e.g. since the last Submit):
    // [{ match, field, label }] replaces the set; label shows on hover.
    setPending(list) {
      pending.clear()
      for (const p of list || []) { const i = data.findIndex(p.match); if (i >= 0) pending.set(i + '|' + p.field, p.label || 'Changed — not submitted yet') }
      refresh()
    },
    // Flash the cells whose values differ from `before` (a snapshot() taken
    // earlier) — e.g. after someone else saved or spread, so the eye goes there.
    snapshot() { return data.map(r => Object.assign({}, r)) },
    // key(row) identifies a row in both (default: its Lens.rows label).
    flashChanges(before, { key = r => r._label, fields } = {}) {
      const cols = fields || columns.filter(c => c.type === 'number').map(c => c.field)
      const same = (a, b) => (a == null ? 0 : Number(a)) === (b == null ? 0 : Number(b))
      const was = new Map(before.map(r => [key(r), r]))
      api.forEachNode(node => {
        const old = was.get(key(node.data))
        if (!old) return
        const changed = cols.filter(f => !same(old[f], node.data[f]))
        if (changed.length) api.flashCells({ rowNodes: [node], columns: changed, flashDuration: 2200, fadeDuration: 1400 })
      })
    },

    // by: show it as someone else's unsaved number (blue, "Typed by <by> — not
    // saved yet" on hover) until they save — a fresh grid after the save clears it.
    setValue(match, field, value, by) {
      const i = data.findIndex(match)
      if (i < 0 || orig.has(i + '|' + field)) return
      data[i][field] = value
      if (by) typed.set(i + '|' + field, by)
      refresh()
    },
  }
}

// ── legend ────────────────────────────────────────────────────────────────────
// The standard key for Lens.grid's colours — the same words everywhere.
// show: any of 'typed', 'pending', 'calc', 'total' (default: all four).
function legend(el, { show = ['typed', 'pending', 'calc', 'total'] } = {}) {
  const t = theme.colors, node = host(el)
  const sw = style => '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:6px;border:1px solid ' + t.rule + ';' + style + '"></span>'
  const items = {
    typed: sw('background:' + BLUE + '29;box-shadow:inset 0 0 0 1.5px ' + BLUE) + 'typed, not saved',
    pending: sw('background:' + t.panel + ' linear-gradient(225deg,' + BLUE + ' 0,' + BLUE + ' 6px,transparent 6px)') + 'saved, not submitted',
    calc: sw('background:' + t.calcBg) + 'calculated',
    total: sw('background:' + t.totalBg) + 'total',
  }
  node.innerHTML = '<span style="display:inline-flex;gap:14px;flex-wrap:wrap;font-size:12px;color:' + t.faint + '">' + show.filter(k => items[k]).map(k => '<span>' + items[k] + '</span>').join('') + '</span>'
  return node
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

// ── historyPanel ──────────────────────────────────────────────────────────────
// A History button (with a count of what's new since you last looked) that
// opens a side panel: search, All / Changes / Actions, newest first, times in
// the viewer's zone. Feed it Lens.history results with set(list); describe(e)
// turns an entry into words (default: a plain description).
//   const hp = Lens.historyPanel('#historyBtn', { describe: e => '…' }); hp.set(list)
function historyPanel(el, { describe, title = 'History' } = {}) {
  const t = theme.colors, btnHost = host(el)
  let list = [], seenTop = null, open = false, filter = 'all'
  const say = e => describe ? describe(e) : e.kind === 'write'
    ? 'changed ' + (e.changes || []).length + ' cell' + ((e.changes || []).length === 1 ? '' : 's')
    : 'ran ' + e.process + (e.status && e.status !== 'CompletedSuccessfully' ? ' — refused' : '')
  btnHost.innerHTML = '<button type="button" data-h style="font:inherit;font-size:13px;padding:5px 10px;border-radius:7px;cursor:pointer;border:1px solid ' + t.rule + ';background:' + t.panel + ';color:' + t.ink + '">🕘 ' + esc(title) + ' <span data-n style="display:none;margin-left:4px;font-size:11px;font-weight:700;color:#fff;background:' + t.accent + ';border-radius:999px;padding:1px 7px"></span></button>'
  const panel = document.createElement('div')
  panel.style.cssText = 'position:fixed;top:0;right:0;height:100%;width:400px;max-width:92vw;background:' + t.panel + ';color:' + t.ink + ';border-left:1px solid ' + t.rule + ';box-shadow:-12px 0 32px rgba(0,0,0,.18);z-index:50;display:none;flex-direction:column;font-size:13px'
  const chip = (k, l) => '<button type="button" data-f="' + k + '" style="font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;cursor:pointer;border:1px solid ' + t.rule + ';background:transparent;color:' + t.soft + '">' + l + '</button>'
  panel.innerHTML = '<div style="padding:12px 14px;border-bottom:1px solid ' + t.rule + ';display:grid;gap:8px">' +
    '<div style="display:flex;align-items:center;gap:8px"><b style="font-size:15px">' + esc(title) + '</b><span data-sub style="color:' + t.faint + ';font-size:12px"></span>' +
    '<button type="button" data-x title="Close" style="margin-left:auto;font:inherit;font-size:18px;line-height:1;border:0;background:transparent;color:' + t.faint + ';cursor:pointer">×</button></div>' +
    '<input data-q type="search" placeholder="Search — who, account, month, note…" style="font:inherit;font-size:13px;padding:6px 9px;border:1px solid ' + t.rule + ';border-radius:7px;background:' + t.bg + ';color:' + t.ink + '">' +
    '<div style="display:flex;gap:6px">' + chip('all', 'All') + chip('write', 'Changes') + chip('run', 'Actions') + '</div></div>' +
    '<div data-list style="overflow:auto;flex:1;padding:4px 14px 14px"></div>'
  document.body.appendChild(panel)
  const q = s => panel.querySelector(s)
  function paint() {
    const text = q('[data-q]').value.trim().toLowerCase()
    panel.querySelectorAll('[data-f]').forEach(b => { const on = b.getAttribute('data-f') === filter; b.style.background = on ? t.accent : 'transparent'; b.style.color = on ? '#fff' : t.soft; b.style.borderColor = on ? t.accent : t.rule })
    const shown = list.filter(e => (filter === 'all' || e.kind === filter) && (!text || (e.user + ' ' + say(e)).toLowerCase().includes(text)))
    q('[data-sub]').textContent = shown.length + (shown.length === list.length ? '' : ' of ' + list.length)
    q('[data-list]').innerHTML = shown.length ? shown.map(e => '<div style="padding:9px 0;border-bottom:1px solid ' + t.rule + '">' +
      '<div style="display:flex;gap:8px;align-items:baseline"><b>' + esc(e.user) + '</b><span style="margin-left:auto;color:' + t.faint + ';font-size:11.5px;white-space:nowrap">' + esc(localTime(e.at)) + '</span></div>' +
      '<div style="color:' + t.soft + ';margin-top:2px">' + esc(say(e)) + '</div></div>').join('')
      : '<p style="color:' + t.faint + '">' + (list.length ? 'Nothing matches.' : 'Nothing yet.') + '</p>'
  }
  function badge() {
    const n = open || seenTop === null ? 0 : list.findIndex(e => e.at === seenTop)
    const count = n < 0 ? list.length : n
    const b = btnHost.querySelector('[data-n]')
    b.style.display = count ? 'inline' : 'none'; b.textContent = count
  }
  const show = v => { open = v; panel.style.display = v ? 'flex' : 'none'; if (v) { seenTop = list[0] ? list[0].at : seenTop; paint(); q('[data-q]').focus() } badge() }
  btnHost.querySelector('[data-h]').onclick = () => show(!open)
  q('[data-x]').onclick = () => show(false)
  q('[data-q]').oninput = paint
  panel.querySelectorAll('[data-f]').forEach(b => { b.onclick = () => { filter = b.getAttribute('data-f'); paint() } })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) show(false) })
  return {
    // New entries (newest first). The first set() counts as seen.
    set(entries) {
      list = entries || []
      if (seenTop === null) seenTop = list[0] ? list[0].at : ''
      if (open) { seenTop = list[0] ? list[0].at : seenTop; paint() }
      badge()
    },
    open() { show(true) },
    close() { show(false) },
    // A different slice (e.g. another store): its history starts as seen.
    reset() { seenTop = null; list = []; badge(); if (open) paint() },
  }
}

// ── config ────────────────────────────────────────────────────────────────────
// The Lens's settings (its config, edited in the IDE's Config tab) — bindings
// and behaviour, so the same code can serve different cubes, versions, rows.
//   const cfg = Lens.config()            // { cube: 'Income Statement', … }
//   const cube = Lens.config('cube', 'Income Statement')   // one key, with a default
function config(key, fallback) {
  const all = (typeof window !== 'undefined' && window.__lensConfig) || {}
  if (key === undefined) return JSON.parse(JSON.stringify(all))
  return all[key] === undefined ? fallback : JSON.parse(JSON.stringify(all[key]))
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

const Lens = { version: TOOLKIT_VERSION, components: COMPONENTS.slice(), rows, format, localTime, theme, kpis, trend, waterfall, bars, grid, flow, editing, live, history, historyPanel, legend, config, save, run, echarts }
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
