// ── The Lens toolkit (window.Lens) ────────────────────────────────────────────
// Tested building blocks for Lenses, bundled into static/lens-kit/lens-kit.js and
// served by the IDE and the Lens app — never loaded from the internet, so a
// Lens's sandbox (no network) stays intact. Each block understands TM1 results
// via Lens.rows and shares one theme. Libraries: Apache ECharts (Apache-2.0),
// AG Grid Community, React Flow + dagre, Alpine.js (MIT). See THIRD_PARTY_LICENSES.

import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart, PieChart, HeatmapChart, SankeyChart, TreeChart, GaugeChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, VisualMapComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { createGrid, ModuleRegistry, AllCommunityModule, themeQuartz, colorSchemeDark } from 'ag-grid-community'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, Background, Controls, MarkerType } from '@xyflow/react'
import flowCss from '@xyflow/react/dist/style.css?inline'
import dagre from '@dagrejs/dagre'
import Alpine from '@alpinejs/csp'
import { rows, format, better } from './rows.js'
import { COMPONENTS, TOOLKIT_VERSION } from './components.js'

echarts.use([BarChart, LineChart, ScatterChart, PieChart, HeatmapChart, SankeyChart, TreeChart, GaugeChart,
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, VisualMapComponent, TitleComponent, CanvasRenderer])
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
// until saved. Returns { api, changes(), undo(), saved() }.
function grid(el, { columns = [], rows: data = [], height, onEdit } = {}) {
  const t = theme.colors, node = host(el)
  node.innerHTML = ''
  node.style.height = height || node.style.height || Math.min(480, 44 + data.length * 36) + 'px'
  const gridTheme = dark() ? themeQuartz.withPart(colorSchemeDark) : themeQuartz
  const orig = new Map()                       // 'rowIndex|field' -> value before typing
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
      if (!c.editable) return def
      def.editable = p => canEdit(c, p.data)
      if (c.type === 'number') {
        def.valueParser = p => {
          const v = Number(String(p.newValue ?? '').replace(/[,$\s]/g, ''))
          return String(p.newValue ?? '').trim() === '' ? 0 : (Number.isFinite(v) ? v : p.oldValue)
        }
      }
      def.cellStyle = p => orig.has(keyOf(p.data, c.field))
        ? { background: tint(t.amber, 0.22), fontWeight: 600 }
        : canEdit(c, p.data) ? { background: tint(t.accent, 0.08) } : { color: t.faint }
      return def
    }),
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

const Lens = { version: TOOLKIT_VERSION, components: COMPONENTS.slice(), rows, format, theme, kpis, trend, waterfall, bars, grid, flow, save, echarts }
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
