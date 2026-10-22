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
import * as pivotKit from '../pivot/index.js'
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
// More: rowEditable(row) → false locks a whole row (e.g. an approved line);
// onSelect(row) — a click selects a row; a column with options: [...] edits by
// a drop-down; g.addRow(row) adds a row (e.g. a new request).
// fit: 'width' (default) stretches columns to fill the grid; 'content' sizes each
// column to its values and heading (tight); a number gives every column that many px.
// height: CSS height, or 'auto' to fit every row with no inner scroll (short tables).
// stripes: shade every other row when the Lens passes stripes:true; g.stripes(on) switches it.
// A column's options may be a function (row) → list | null: a drop-down on the
// rows that return a list, ordinary typing on the rest.
// cellMenu: (row, field) → { cube, coordinates } | null — where a cell lives in TM1; with it,
// right-click gives Why this number? / Who changed it / Notes (notes: true allows adding one).
function grid(el, { columns = [], rows: data = [], height, onEdit, onFocus, onSelect, rowEditable, fit = 'width', stripes = false, key, cellMenu, notes = false } = {}) {
  const t = theme.colors, node = host(el)
  node.innerHTML = ''
  // height 'auto': the grid grows to fit every row (no scrollbar of its own) — for short tables
  const autoHeight = height === 'auto'
  node.style.height = autoHeight ? '' : height || node.style.height || Math.min(480, 44 + data.length * 36) + 'px'
  const baseTheme = dark() ? themeQuartz.withPart(colorSchemeDark) : themeQuartz
  const stripedTheme = baseTheme.withParams({ oddRowBackgroundColor: dark() ? 'rgba(255,255,255,0.045)' : 'rgba(20,60,55,0.045)' })
  const gridTheme = stripes ? stripedTheme : baseTheme
  const orig = new Map()                       // 'rowIndex|field' -> value before typing
  const remote = new Map()                     // 'rowIndex|field' -> { color, label } — someone else's cursor
  const typed = new Map()                      // 'rowIndex|field' -> colour — someone else's unsaved value
  const pending = new Map()                    // 'rowIndex|field' -> label — saved, not yet handed in (e.g. submitted)
  const keyOf = (row, field) => data.indexOf(row) + '|' + field
  const canEdit = (c, row) => !!c.editable && !(row && row._input && row._input[c.field] === false) && !(rowEditable && row && rowEditable(row) === false)
  const tint = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0')
  let api = null
  // Persist the column layout (order / width / pinned / hidden) per Lens + user.
  // Same idea as Lens.pivot's key, but for a plain grid.
  const layoutKey = key ? 'lens-grid:' + key : null
  const readLayout = () => { try { const v = JSON.parse(localStorage.getItem(layoutKey) || 'null'); return Array.isArray(v) ? v : null } catch (e) { return null } }
  const writeLayout = () => {
    if (!layoutKey || !api) return
    try {
      const state = api.getColumnState().map(c => ({ colId: c.colId, width: c.width, pinned: c.pinned, hide: c.hide }))
      localStorage.setItem(layoutKey, JSON.stringify(state))
    } catch (e) { /* storage refused */ }
  }
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
    defaultColDef: Object.assign({ sortable: true, resizable: true, filter: true, editable: false }, typeof fit === 'number' ? { width: fit } : {}),
    columnDefs: columns.map(c => {
      const optsFor = row => typeof c.options === 'function' ? c.options(row) : c.options
      const listRow = row => typeof c.options === 'function' && !!optsFor(row)   // a drop-down row in a number column
      const fmtFor = row => (typeof c.format === 'function' ? c.format(row) : c.format) || 'number'   // format may depend on the row
      const def = c.type === 'number'
        ? { ...c, type: 'rightAligned', valueFormatter: p => listRow(p.data) ? (p.value ?? '') : format(p.value, fmtFor(p.data)) }
        : { ...c }
      delete def.options
      if (typeof c.format === 'function') delete def.format
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
      if (typeof c.options === 'function' || (c.type === 'number' && (typeof c.format === 'function' || c.format === '%'))) {
        // per row: a drop-down where the row has options; on a % cell the edit box starts
        // from what is shown ('3.0%', not 0.03), so what people type is read as a percentage
        def.cellEditorSelector = p => {
          const o = typeof c.options === 'function' ? optsFor(p.data) : c.options
          if (o) return { component: 'agSelectCellEditor', params: { values: o } }
          if (c.type === 'number' && fmtFor(p.data) === '%') return { component: 'agTextCellEditor', params: { useFormatter: true } }
          return undefined
        }
      } else if (c.options) { def.cellEditor = 'agSelectCellEditor'; def.cellEditorParams = { values: c.options } }
      if (c.type === 'number') {
        def.valueParser = p => {
          if (listRow(p.data)) return p.newValue
          // on a % cell people type the percentage: '3' or '3%' is 3% (0.03)
          const pct = fmtFor(p.data) === '%'
          const v = Number(String(p.newValue ?? '').replace(/[,$%\s]/g, '')) / (pct ? 100 : 1)
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
    preventDefaultOnContextMenu: !!cellMenu,
    onCellContextMenu: cellMenu ? p => {
      const where = p.data && cellMenu(p.data, p.column.getColId())
      if (where && where.cube && where.coordinates) openCellMenu(p.event, { cube: where.cube, coordinates: where.coordinates, notes })
    } : undefined,
    rowSelection: onSelect ? { mode: 'singleRow', checkboxes: false, enableClickSelection: true } : undefined,
    onSelectionChanged: onSelect ? () => { const r = api.getSelectedRows(); onSelect(r[0] || null) } : undefined,
    onGridReady: p => { const saved = layoutKey && readLayout(); if (saved) { try { p.api.applyColumnState({ state: saved, applyOrder: true }) } catch (e) { /* bad saved layout */ } } },
    onColumnMoved: () => writeLayout(),
    onColumnResized: e => { if (e.finished !== false) writeLayout() },
    onColumnVisible: () => writeLayout(),
    onColumnPinned: () => writeLayout(),
    onCellValueChanged: p => {
      const k = keyOf(p.data, p.colDef.field)
      if (!orig.has(k)) orig.set(k, p.oldValue)
      const a = orig.get(k), b = p.newValue
      if (String(a ?? '') === String(b ?? '') || (Number.isFinite(Number(a ?? 0)) && Number.isFinite(Number(b ?? 0)) && Number(a ?? 0) === Number(b ?? 0))) orig.delete(k)
      refresh()
      if (onEdit) onEdit(changes())
    },
    domLayout: autoHeight ? 'autoHeight' : 'normal',
    autoSizeStrategy: fit === 'content' ? { type: 'fitCellContents' } : typeof fit === 'number' ? undefined : { type: 'fitGridWidth' },
  })
  return {
    api,
    changes,
    // shade every other row, or not
    stripes(on) { api.setGridOption('theme', on ? stripedTheme : baseTheme) },
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
    addRow(row) { data.push(row); api.applyTransaction({ add: [row] }); return row },
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

// ── cellInfo ──────────────────────────────────────────────────────────────────
// A cell's story in a side panel — three tabs, all TM1's own records, read as
// the person: Why (the rule trace: the rule used and the values it read; click
// one to trace that too), Changes (TM1's transaction log for this cell — loads
// on demand, it can take a few seconds), Notes (TM1 cell comments; adding one
// needs notes: true and the cube declared in <meta name="lens-notes">).
//   Lens.cellInfo({ cube, coordinates: { dim: element, … }, tab: 'why' | 'changes' | 'notes', notes: true })
let cellPanel = null
// The small right-click menu over a cell — opens Lens.cellInfo on the chosen tab.
function openCellMenu(event, { cube, coordinates, notes }) {
  const t = theme.colors
  if (event && event.preventDefault) event.preventDefault()
  document.querySelectorAll('[data-cell-menu]').forEach(m => m.remove())
  const m = document.createElement('div'); m.setAttribute('data-cell-menu', '')
  m.style.cssText = 'position:fixed;z-index:58;min-width:190px;background:' + t.panel + ';color:' + t.ink + ';border:1px solid ' + t.rule + ';border-radius:9px;box-shadow:0 10px 28px rgba(0,0,0,.2);padding:4px;font-size:13px'
  m.style.left = Math.min(event?.clientX ?? 100, (window.innerWidth || 800) - 200) + 'px'
  m.style.top = Math.min(event?.clientY ?? 100, (window.innerHeight || 600) - 120) + 'px'
  const item = (k, l) => '<button type="button" data-open="' + k + '" style="display:block;width:100%;text-align:left;font:inherit;padding:6px 10px;border:0;border-radius:6px;background:none;color:inherit;cursor:pointer">' + l + '</button>'
  m.innerHTML = item('why', 'Why this number?') + item('changes', 'Who changed it') + item('notes', 'Notes')
  document.body.appendChild(m)
  const close = () => { m.remove(); document.removeEventListener('mousedown', away, true) }
  const away = e => { if (!m.contains(e.target)) close() }
  setTimeout(() => document.addEventListener('mousedown', away, true), 0)
  m.onclick = e => {
    const b = e.target.closest && e.target.closest('[data-open]'); if (!b) return
    close(); cellInfo({ cube, coordinates, tab: b.getAttribute('data-open'), notes: !!notes })
  }
}
function cellInfo({ cube, coordinates, tab = 'why', notes = false, format: fmt } = {}) {
  const t = theme.colors
  if (!cellPanel) {
    cellPanel = document.createElement('div')
    cellPanel.setAttribute('data-cell-info', '')
    document.body.appendChild(cellPanel)
  }
  const panel = cellPanel
  panel.style.cssText = 'position:fixed;top:0;right:0;height:100%;width:420px;max-width:94vw;background:' + t.panel + ';color:' + t.ink + ';border-left:1px solid ' + t.rule + ';box-shadow:-12px 0 32px rgba(0,0,0,.18);z-index:55;display:flex;flex-direction:column;font-size:13px'
  const stack = [{ cube, coordinates }]                  // Why: the cells traced so far (click-through)
  let current = tab
  const here = () => stack[stack.length - 1]
  const call = (m, p) => window.lensBridge.call(m, p)
  const val = v => v == null || v === '' ? '—' : typeof v === 'number' ? (fmt ? format(v, fmt) : v.toLocaleString(undefined, { maximumFractionDigits: 4 })) : esc(v)
  const tabBtn = (k, l) => '<button type="button" data-tab="' + k + '" style="font:inherit;font-size:12.5px;padding:6px 12px;border:0;border-bottom:2px solid ' + (current === k ? t.accent : 'transparent') + ';background:none;color:' + (current === k ? t.ink : t.faint) + ';cursor:pointer;font-weight:' + (current === k ? 600 : 400) + '">' + l + '</button>'
  const coordsLine = co => Object.entries(co).map(([d, e]) => '<span title="' + esc(d) + '">' + esc(e) + '</span>').join(' · ')
  function frame(body) {
    panel.innerHTML =
      '<div style="padding:12px 14px 6px;border-bottom:1px solid ' + t.rule + '">' +
        '<div style="display:flex;align-items:center;gap:8px"><b style="flex:1">' + esc(cube) + '</b><button type="button" data-x title="Close" style="font:inherit;font-size:18px;line-height:1;border:0;background:none;color:' + t.faint + ';cursor:pointer">×</button></div>' +
        '<div style="font-size:12px;color:' + t.faint + ';margin:2px 0 6px">' + coordsLine(coordinates) + '</div>' +
        '<div>' + tabBtn('why', 'Why this number') + tabBtn('changes', 'Changes') + tabBtn('notes', 'Notes') + '</div>' +
      '</div><div data-body style="overflow:auto;flex:1;padding:12px 14px">' + body + '</div>'
  }
  const say = (txt, bad) => '<div style="color:' + (bad ? t.bad : t.faint) + '">' + esc(txt) + '</div>'
  const kindOf = r => /rule/i.test(r.Type || '') || (r.Statements || []).length ? 'Calculated by a rule' : /consol/i.test(r.Type || '') ? 'A total' : 'Typed in (input)'
  const tupleOf = tuple => Object.fromEntries((tuple || []).map(m => [m.Hierarchy?.Dimension?.Name ?? '', m.Name]))
  async function showWhy() {
    frame(say('Tracing…'))
    const h = here()
    try {
      const r = await call('cellTrace', { cube: h.cube, coordinates: h.coordinates })
      const comps = (r.Components || []).slice().sort((a, b) => Math.abs(Number(b.Value) || 0) - Math.abs(Number(a.Value) || 0))
      const shown = comps.slice(0, 60)
      const diff = co => Object.entries(co).filter(([d, e]) => String(h.coordinates[d]) !== String(e)).map(([, e]) => esc(e)).join(' · ') || 'same cell'
      frame(
        (stack.length > 1 ? '<button type="button" data-back style="font:inherit;font-size:12px;border:0;background:none;color:' + t.accent + ';cursor:pointer;padding:0 0 8px">← back</button><div style="font-size:12px;color:' + t.faint + ';margin-bottom:6px">' + esc(h.cube) + ' · ' + coordsLine(h.coordinates) + '</div>' : '') +
        '<div style="font-size:22px;font-weight:700;font-variant-numeric:tabular-nums">' + val(r.Value) + '</div>' +
        '<div style="color:' + t.faint + ';margin-bottom:10px">' + kindOf(r) + (comps.length ? ' · from ' + comps.length + ' value' + (comps.length > 1 ? 's' : '') : '') + '</div>' +
        ((r.Statements || []).length ? '<div style="font-size:11px;color:' + t.faint + ';text-transform:uppercase;letter-spacing:.06em;margin:4px 0">The rule</div><pre style="white-space:pre-wrap;font:12px ui-monospace,monospace;background:' + t.bg + ';border:1px solid ' + t.rule + ';border-radius:8px;padding:8px;margin:0 0 12px">' + esc(r.Statements.join('\n')) + '</pre>' : '') +
        (shown.length ? '<div style="font-size:11px;color:' + t.faint + ';text-transform:uppercase;letter-spacing:.06em;margin:4px 0">It used — click one to see why</div>' +
          shown.map((c, i) => {
            const co = tupleOf(c.Tuple), cb = c.Cube?.Name || h.cube
            return '<button type="button" data-comp="' + i + '" style="display:flex;width:100%;gap:10px;align-items:center;text-align:left;font:inherit;padding:6px 4px;border:0;border-bottom:1px solid ' + t.rule + ';background:none;color:inherit;cursor:pointer">' +
              '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (cb !== h.cube ? '<b>' + esc(cb) + '</b> · ' : '') + diff(co) + '</span>' +
              '<span style="font-variant-numeric:tabular-nums">' + val(c.Value) + '</span><span style="color:' + t.faint + '">›</span></button>'
          }).join('') + (comps.length > shown.length ? say('…and ' + (comps.length - shown.length) + ' more') : '') : ''))
      panel.querySelectorAll('[data-comp]').forEach(b => { b.onclick = () => {
        const c = shown[Number(b.getAttribute('data-comp'))]
        stack.push({ cube: c.Cube?.Name || h.cube, coordinates: Object.assign({}, h.coordinates, tupleOf(c.Tuple)) }); showWhy()
      } })
      const back = panel.querySelector('[data-back]'); if (back) back.onclick = () => { stack.pop(); showWhy() }
    } catch (e) { frame(say(e && e.message ? e.message : String(e), true)) }
  }
  async function showChanges() {
    frame(say('Reading TM1\'s change log for this cell… this can take a few seconds.'))
    try {
      const rows = await call('cellLog', { cube, coordinates, top: 30 })
      frame(rows.length ? rows.map(r => '<div style="padding:7px 0;border-bottom:1px solid ' + t.rule + '"><div style="display:flex;gap:8px"><b style="flex:1">' + esc(r.user || '') + '</b><span style="color:' + t.faint + '">' + esc(localTime ? localTime(r.at) : r.at) + '</span></div><div style="font-variant-numeric:tabular-nums">' + val(r.old) + ' → <b>' + val(r.value) + '</b></div></div>').join('') : say('No changes recorded for this cell in TM1\'s log.'))
    } catch (e) { frame(say(e && e.message ? e.message : String(e), true)) }
  }
  async function showNotes(msg) {
    frame(say('Loading notes…'))
    try {
      const list = await call('cellNotes', { cube, coordinates })
      frame((msg ? say(msg) : '') +
        (list.length ? list.map(n => '<div style="padding:8px 0;border-bottom:1px solid ' + t.rule + '"><div style="display:flex;gap:8px;font-size:12px;color:' + t.faint + '"><span style="flex:1">' + esc(n.author || '') + '</span><span>' + esc(localTime ? localTime(n.at) : n.at) + '</span></div><div style="white-space:pre-wrap">' + esc(n.text) + '</div></div>').join('') : say('No notes on this cell yet.')) +
        (notes ? '<div style="margin-top:12px;display:grid;gap:6px"><textarea data-note rows="3" placeholder="Add a note to this cell…" style="font:inherit;padding:6px 8px;border:1px solid ' + t.rule + ';border-radius:7px;background:' + t.bg + ';color:' + t.ink + ';resize:vertical"></textarea><button type="button" data-add style="justify-self:start;font:inherit;padding:5px 12px;border:0;border-radius:7px;background:' + t.accent + ';color:#fff;font-weight:600;cursor:pointer">Add note</button></div>' : ''))
      const add = panel.querySelector('[data-add]')
      if (add) add.onclick = () => {
        const text = panel.querySelector('[data-note]').value.trim(); if (!text) return
        add.disabled = true
        call('addNote', { cube, coordinates, text }).then(() => showNotes('Note added.'), e => { add.disabled = false; showNotes(e && e.message ? e.message : String(e)) })
      }
    } catch (e) { frame(say(e && e.message ? e.message : String(e), true)) }
  }
  const show = k => { current = k; return k === 'changes' ? showChanges() : k === 'notes' ? showNotes() : showWhy() }
  panel.onclick = e => {
    const x = e.target.closest && e.target.closest('[data-x]'); if (x) { panel.style.display = 'none'; return }
    const tb = e.target.closest && e.target.closest('[data-tab]'); if (tb) show(tb.getAttribute('data-tab'))
  }
  panel.style.display = 'flex'
  return show(current)
}

// ── pivot ─────────────────────────────────────────────────────────────────────
// Slice and dice on one cube, with drill-down (the shared pivot — the same grid
// as the IDE's View editor). Dimensions sit on rows, columns or filters; the
// person drags the chips the builder lets move, drills into totals, and — with
// edit — types into input cells; save() writes them (Lens.save, checked against
// the old values). The layout each person arranges is remembered for them.
//   const pv = Lens.pivot('#pv', {
//     cube: 'Assumptions',
//     rows:    [{ dimension: 'Measure', memberSet: 'all' }],
//     columns: [{ dimension: 'Entity', members: ['UK', 'US', 'NZ'] }],
//     filters: [{ dimension: 'Period', member: '2026-06', choices: [...] }, { dimension: 'Version', member: 'Forecast', locked: true }],
//     edit: true, onEdit: changes => …, formats: { Measure: { 'Merit %': '0.0%' } }, key: 'assumptions',
//   })
//   pv.changes(); pv.save() → Promise; pv.undo(); pv.refresh(); pv.move(dim, 'rows'|'columns'|'filters'); pv.swap(); pv.grid
// Every cube dimension must be placed (rows, columns or filters) for saving.
function pivot(el, cfg = {}) {
  const P = pivotKit, node = host(el), t = theme.colors
  if (!cfg.cube) throw new Error('Lens.pivot needs a cube')
  const all = [...(cfg.rows || []), ...(cfg.columns || []), ...(cfg.filters || [])]
  const spec = {}; for (const p of all) spec[p.dimension] = Object.assign({}, p)
  const movable = d => !spec[d].locked && (!cfg.movable || cfg.movable.includes(d))
  let layout = { rows: (cfg.rows || []).map(p => p.dimension), columns: (cfg.columns || []).map(p => p.dimension), filters: (cfg.filters || []).map(p => p.dimension) }
  const member = {}; for (const p of cfg.filters || []) member[p.dimension] = p.member
  // Advanced (each feature only if the builder lists it): 'members' (pick members / named
  // subsets on an axis — cfg.subsets: { dim: [names] }), 'suppress', 'totals', 'copy', 'mdx'
  const adv = new Set(cfg.advanced || [])
  let picks = {}, suppress = cfg.suppress || 'none', totals = cfg.totals || 'top', advOpen = false, lastMdx = ''
  const storeKey = cfg.key ? 'lens-pivot:' + cfg.key : null
  try {
    const saved = storeKey && JSON.parse(localStorage.getItem(storeKey) || 'null')
    const dims = saved && [...saved.rows, ...saved.columns, ...saved.filters]
    if (dims && dims.length === all.length && dims.every(d => spec[d]) && saved.rows.length) {
      layout = { rows: saved.rows, columns: saved.columns, filters: saved.filters }; Object.assign(member, saved.member || {})
      if (adv.has('members')) picks = saved.picks || {}
      if (adv.has('suppress') && saved.suppress) suppress = saved.suppress
      if (adv.has('totals') && saved.totals) totals = saved.totals
    }
  } catch (e) { /* nothing remembered */ }
  const remember = () => { if (storeKey) try { localStorage.setItem(storeKey, JSON.stringify({ ...layout, member, picks, suppress, totals })) } catch (e) { /* storage refused */ } }

  const trees = {}, choices = {}
  const tree = d => trees[d] || (trees[d] = window.lensBridge.call('elementTree', { dimension: d, hierarchy: spec[d].hierarchy }).then(els => els, () => null))
  const label = d => spec[d].label || d

  node.innerHTML = ''
  const bar = document.createElement('div'), gridEl = document.createElement('div')
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-bottom:10px;font-size:12px'
  node.append(bar, gridEl)
  let g = null, busy = null, onChange = cfg.onEdit

  function drawBar() {
    const zone = (key, title) => '<span data-zone="' + key + '" style="display:inline-flex;gap:6px;align-items:center;min-height:28px;padding:2px 6px;border:1px dashed ' + t.rule + ';border-radius:8px">' +
      '<span style="color:' + t.faint + ';text-transform:uppercase;letter-spacing:.06em;font-size:10.5px">' + title + '</span>' +
      layout[key].map(d => chip(d, key)).join('') + '</span>'
    const chip = (d, key) => {
      const move = movable(d)
      let inner = esc(label(d))
      if (key === 'filters') {
        const list = choices[d]
        inner += list && move !== false && !spec[d].locked
          ? ' <select data-member="' + esc(d) + '" style="font:inherit;font-size:12px;border:0;background:transparent;color:inherit;max-width:180px">' + list.map(m => '<option' + (m === member[d] ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select>'
          : ': <b>' + esc(member[d] ?? '') + '</b>'
      }
      if (key !== 'filters' && adv.has('members') && advOpen) inner += ' <button type="button" data-pick="' + esc(d) + '" title="Choose members or a subset" style="font:inherit;font-size:11px;border:0;background:transparent;color:' + t.accent + ';cursor:pointer;padding:0 0 0 2px">' + (picks[d] ? '▾ ' + esc(pickLabel(picks[d])) : '▾') + '</button>'
      return '<span data-dim="' + esc(d) + '"' + (move ? ' draggable="true"' : '') + ' title="' + (move ? 'Drag to rows, columns or filters' : 'Fixed by the Lens') + '" style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;border:1px solid ' + t.rule + ';background:' + t.panel + ';color:' + t.ink + ';cursor:' + (move ? 'grab' : 'default') + '">' + (move ? '' : '🔒 ') + inner + '</span>'
    }
    const swapOk = layout.columns.length && layout.rows.concat(layout.columns).every(movable)
    bar.innerHTML = zone('rows', 'Rows') +
      '<button type="button" data-swap title="Swap rows and columns"' + (swapOk ? '' : ' disabled') + ' style="font:inherit;font-size:14px;line-height:1;padding:4px 8px;border-radius:7px;border:1px solid ' + t.rule + ';background:' + t.panel + ';color:' + t.ink + ';cursor:' + (swapOk ? 'pointer' : 'default') + ';opacity:' + (swapOk ? 1 : 0.4) + '">⇄</button>' +
      zone('columns', 'Columns') + zone('filters', 'Filters') +
      (adv.size ? '<button type="button" data-adv style="margin-left:auto;font:inherit;font-size:12px;padding:4px 10px;border-radius:7px;border:1px solid ' + t.rule + ';background:' + (advOpen ? t.accent : t.panel) + ';color:' + (advOpen ? '#fff' : t.ink) + ';cursor:pointer">Advanced ' + (advOpen ? '▴' : '▾') + '</button>' : '') +
      (advOpen ? advRow() : '')
  }
  const pickLabel = p => p.subset ? p.subset : p.memberSet === 'leaf' ? 'lowest level' : p.members ? p.members.length + ' chosen' : 'all'
  const sel = (attr, opts, cur) => '<select ' + attr + ' style="font:inherit;font-size:12px;padding:2px 6px;border:1px solid ' + t.rule + ';border-radius:6px;background:' + t.panel + ';color:' + t.ink + '">' + opts.map(o => '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>'
  const small = (attr, text) => '<button type="button" ' + attr + ' style="font:inherit;font-size:12px;padding:3px 9px;border-radius:6px;border:1px solid ' + t.rule + ';background:' + t.panel + ';color:' + t.ink + ';cursor:pointer">' + text + '</button>'
  function advRow() {
    const parts = []
    if (adv.has('members')) parts.push('<span style="color:' + t.faint + '">▾ on a row or column chip chooses its members</span>')
    if (adv.has('suppress')) parts.push('<label style="display:inline-flex;gap:6px;align-items:center">Hide empty ' + sel('data-suppress', [['none', 'nothing'], ['rows', 'rows'], ['columns', 'columns'], ['all', 'rows and columns']], suppress) + '</label>')
    if (adv.has('totals')) parts.push('<label style="display:inline-flex;gap:6px;align-items:center">Totals ' + sel('data-totals', [['top', 'above'], ['bottom', 'below']], totals) + '</label>')
    if (adv.has('copy')) parts.push(small('data-copy-table', 'Copy table'))
    if (adv.has('mdx')) parts.push(small('data-copy-mdx', 'Copy MDX'))
    return '<div style="flex-basis:100%;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:6px 8px;border-radius:8px;background:' + t.panel + ';border:1px solid ' + t.rule + '">' + parts.join('') + '<span data-adv-note style="color:' + t.faint + '"></span></div>'
  }
  // copy text from inside the Lens frame (a hidden text box — works where the clipboard API is refused)
  function copyText(text, what) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
    document.body.appendChild(ta); ta.select()
    let ok = false; try { ok = document.execCommand('copy') } catch (e) { ok = false }
    ta.remove()
    const note = bar.querySelector('[data-adv-note]'); if (note) note.textContent = ok ? what + ' copied' : 'Copy was refused by the browser'
  }
  // drag a chip to another zone
  bar.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('[data-dim]'); if (c) e.dataTransfer.setData('text/plain', c.getAttribute('data-dim')) })
  bar.addEventListener('dragover', e => { if (e.target.closest && e.target.closest('[data-zone]')) e.preventDefault() })
  bar.addEventListener('drop', e => {
    const z = e.target.closest && e.target.closest('[data-zone]'); if (!z) return
    e.preventDefault()
    run(() => move(e.dataTransfer.getData('text/plain'), z.getAttribute('data-zone')))
  })
  bar.addEventListener('click', e => {
    const at = s => e.target.closest && e.target.closest(s)
    if (at('[data-swap]')) run(swap)
    else if (at('[data-adv]')) { advOpen = !advOpen; drawBar() }
    else if (at('[data-copy-table]')) { if (g) copyText(g.toText(), 'Table') }
    else if (at('[data-copy-mdx]')) copyText(lastMdx, 'MDX')
    else if (at('[data-pick]')) {
      const b = at('[data-pick]'), d = b.getAttribute('data-pick')
      if (g && g.changes().length) { report(new Error('Save or undo your changes before changing members.')); return }
      tree(d).then(els => P.openMemberPicker({
        anchor: b, title: label(d), elements: els || [], subsets: (cfg.subsets || {})[d] || [],
        current: picks[d] || spec[d], colors: { panel: t.panel, ink: t.ink, faint: t.faint, rule: t.rule, accent: t.accent },
        onApply: choice => { picks[d] = choice; remember(); run(rebuild) },
      }))
    }
  })
  bar.addEventListener('change', e => {
    const d = e.target.getAttribute && e.target.getAttribute('data-member')
    if (d) { member[d] = e.target.value; remember(); run(load) }
    if (e.target.hasAttribute && e.target.hasAttribute('data-suppress')) { suppress = e.target.value; remember(); run(load) }
    if (e.target.hasAttribute && e.target.hasAttribute('data-totals')) { totals = e.target.value; remember(); if (g) g.setOptions({ totals, colTotals: totals }) }
  })
  function move(d, to) {
    if (!spec[d] || !movable(d)) return
    const from = ['rows', 'columns', 'filters'].find(k => layout[k].includes(d))
    if (!from || from === to) return
    if (from !== 'filters' && layout[from].length === 1 && from === 'rows') return   // keep at least one row dimension
    if (g && g.changes().length) { report(new Error('Save or undo your changes before moving dimensions.')); return }
    layout[from] = layout[from].filter(x => x !== d); layout[to] = [...layout[to], d]
    if (to === 'filters' && member[d] == null) member[d] = spec[d].member
    remember(); return rebuild()
  }
  // rows ⇄ columns in one go (only when both sides can move and columns aren't empty)
  function swap() {
    if (!layout.columns.length || !layout.rows.concat(layout.columns).every(movable)) return
    if (g && g.changes().length) { report(new Error('Save or undo your changes before swapping.')); return }
    layout = { rows: layout.columns, columns: layout.rows, filters: layout.filters }
    remember(); return rebuild()
  }
  const report = e => { if (cfg.onError) cfg.onError(e); else console.error(e) }

  // a dimension on rows/columns: its own members/set, or — for a filter moved onto an axis — the choices it offered
  const axis = d => {
    const p = Object.assign({}, spec[d], picks[d] ? { members: undefined, memberSet: undefined, subset: undefined, ...picks[d] } : {})
    const members = p.members || (!p.memberSet && !p.subset ? p.choices : null)
    return { dimension: d, hierarchy: p.hierarchy, members, memberSet: p.memberSet || (members || p.subset ? undefined : 'all'), subset: p.subset }
  }
  async function filterChoices() {
    await Promise.all(layout.filters.filter(d => !choices[d] && movable(d)).map(async d => {
      if (spec[d].choices) { choices[d] = spec[d].choices; return }
      const els = await tree(d)
      choices[d] = els ? els.map(x => x.Name) : null
    }))
    for (const d of layout.filters) if (member[d] == null) member[d] = (choices[d] || [])[0]
  }
  async function query() {
    const mdx = P.buildMDX({ cube: cfg.cube, rows: layout.rows.map(axis), columns: layout.columns.map(axis),
      pages: layout.filters.map(d => ({ dimension: d, hierarchy: spec[d].hierarchy, member: member[d] })), suppressZeros: suppress })
    lastMdx = mdx
    const r = await window.lensBridge.call('execMDX', { mdx })
    if (r && r.truncated) throw new Error('This layout returns more than the cell limit — filter it down or move a dimension to filters.')
    return P.cellsetToPivot(r, { formatMap: cfg.formats || {} })
  }
  async function treesFor(dims) {
    const els = await Promise.all(dims.map(tree))
    return els.map((e, i) => e ? P.buildHierarchy(e, label(dims[i])) : null)
  }
  async function rebuild() {
    await filterChoices(); drawBar()
    const [data, rowsH, colsH] = await Promise.all([query(), treesFor(layout.rows), treesFor(layout.columns)])
    if (g) g.destroy()
    g = P.createPivotGrid(gridEl, {
      pivot: data, rowHierarchies: rowsH, colHierarchies: colsH, rowNames: layout.rows.map(label),
      edit: cfg.edit ? 'save' : false, onEdit: ch => onChange && onChange(ch), rowEditable: cfg.rowEditable,
      stripes: cfg.stripes, fit: cfg.fit || 'content', height: cfg.height || 'auto', totals, colTotals: totals,
      storageKey: storeKey ? storeKey + ':w:' + layout.rows.join('|') + '>' + layout.columns.join('|') : null,
      dark: dark(), colors: { calcBg: t.calcBg, totalBg: t.totalBg },
      onContextMenu: cfg.cellMenu === false ? undefined : cellMenu,
    })
    if (onChange) onChange([])
  }
  // right-click a cell: Why this number? / Who changed it / Notes
  function cellMenu({ tuple, members, event }) {
    const co = {}
    layout.rows.forEach((d, i) => { co[d] = tuple[i] }); layout.columns.forEach((d, i) => { co[d] = members[i] }); layout.filters.forEach(d => { co[d] = member[d] })
    openCellMenu(event, { cube: cfg.cube, coordinates: co, notes: !!cfg.notes })
  }

  async function load() {
    if (!g) return rebuild()
    const [data, rowsH, colsH] = await Promise.all([query(), treesFor(layout.rows), treesFor(layout.columns)])
    g.setPivot(data, rowsH, colsH)
    if (onChange) onChange([])
  }
  const run = f => { busy = (busy || Promise.resolve()).then(f).catch(e => { report(e); throw e }); return busy }
  const ready = run(rebuild)

  return {
    ready,
    get grid() { return g },
    layout: () => JSON.parse(JSON.stringify({ ...layout, member })),
    changes: () => (g ? g.changes() : []),
    undo() { if (g) g.undo() },
    refresh: () => run(load),
    stripes(on) { cfg.stripes = !!on; if (g) g.stripes(on) },
    onEdit(fn) { onChange = fn },
    // move a dimension to 'rows' | 'columns' | 'filters' (what dragging a chip does)
    move: (d, to) => run(() => move(d, to)),
    swap: () => run(swap),
    // write the typed values: every coordinate from the layout; expect = the value before typing
    save() {
      const ch = g ? g.changes() : []
      if (!ch.length) return Promise.resolve({ written: 0 })
      const cells = ch.map(c => {
        const co = {}
        layout.rows.forEach((d, i) => { co[d] = c.tuple[i] })
        layout.columns.forEach((d, i) => { co[d] = c.members[i] })
        layout.filters.forEach(d => { co[d] = member[d] })
        return { coordinates: co, value: c.value, expect: c.old }
      })
      return save(cfg.cube, cells).then(r => { g.saved(); return run(load).then(() => r) })
    },
  }
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
    // Quiet by design: nothing when you're alone; otherwise small overlapping
    // initials of the others (not you), muted, name on hover. Each person once,
    // however many tabs or connections they have.
    const people = []
    for (const m of members) if (!people.some(p => p.user === m.user)) people.push(m)
    const others = people.filter(m => !me || m.user !== me.user)
    if (!others.length) { node.innerHTML = ''; return }
    node.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:' + t.faint + '" title="' + esc(others.map(m => m.user).join(', ') + ' — here too') + '">' +
      '<span style="display:inline-flex">' + others.slice(0, 4).map((m, i) => '<span style="width:20px;height:20px;border-radius:50%;display:inline-grid;place-items:center;font-size:9.5px;font-weight:700;color:#fff;background:' + m.color + ';opacity:.85;box-shadow:0 0 0 2px ' + t.panel + ';margin-left:' + (i ? '-6px' : '0') + '">' + esc(initials(m.user)) + '</span>').join('') + '</span>' +
      '<span>' + (others.length === 1 ? esc(others[0].user) : others.length + ' others') + ' here too</span></span>'
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
  const say = e => describe ? describe(e) : e.kind === 'note'
    ? 'added a note: “' + (e.text || '') + '”'
    : e.kind === 'write'
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
    '<div style="display:flex;gap:6px">' + chip('all', 'All') + chip('write', 'Changes') + chip('run', 'Actions') + chip('note', 'Notes') + '</div></div>' +
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

// ── whoami ────────────────────────────────────────────────────────────────────
// The signed-in person and their TM1 groups: Lens.whoami() → { user, groups } —
// e.g. show Approve only to approvers. Never security on its own: the server
// and TM1 still enforce every save and every process.
let whoCache = null
function whoami() {
  if (!whoCache) whoCache = window.lensBridge.call('whoami', {}).catch(() => ({ user: '', groups: [] }))
  return whoCache
}
whoami.inGroup = (who, groups) => {
  const mine = new Set((who && who.groups || []).map(g => String(g).toLowerCase()))
  return mine.has('admin') || (groups || []).some(g => mine.has(String(g).toLowerCase()))
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

// _pivot: the shared pivot's building blocks (docs/PIVOT_PLAN.md) — internal until Lens.pivot
const Lens = { _pivot: pivotKit, pivot, cellInfo, version: TOOLKIT_VERSION, components: COMPONENTS.slice(), rows, format, localTime, theme, kpis, trend, waterfall, bars, grid, flow, editing, live, history, historyPanel, legend, config, whoami, save, run, echarts }
const missing = COMPONENTS.filter(n => typeof Lens[n] !== 'function')
if (missing.length) throw new Error('Lens toolkit is missing: ' + missing.join(', '))

window.Lens = Lens

// ── home link ─────────────────────────────────────────────────────────────────
// A Lens whose config names its app's home page (config.home: 'WFP-Home', with an
// optional homeLabel: 'Workforce') gets a quiet "⌂ Workforce" link at the top
// left, opening that page. The home page itself names no home, so has none.
function drawHomeLink() {
  const home = config('home')
  if (!home || typeof document === 'undefined' || document.querySelector('[data-lens-home]')) return
  const t = theme.colors
  const bar = document.createElement('div')
  bar.style.cssText = 'max-width:1700px;margin:0 auto;padding:8px 18px 0;box-sizing:border-box'
  const a = document.createElement('button')
  a.type = 'button'; a.setAttribute('data-lens-home', ''); a.title = 'Back to ' + (config('homeLabel') || 'the home page')
  a.textContent = '⌂ ' + (config('homeLabel') || 'Home')
  a.style.cssText = 'font:inherit;font-size:12.5px;border:0;background:transparent;color:' + t.faint + ';cursor:pointer;padding:2px 4px;border-radius:5px'
  a.onmouseenter = () => { a.style.color = t.ink }
  a.onmouseleave = () => { a.style.color = t.faint }
  a.onclick = () => { if (window.lensBridge) window.lensBridge.call('openLens', { name: home }).catch(() => {}) }
  bar.appendChild(a)
  document.body.insertBefore(bar, document.body.firstChild)
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', drawHomeLink)
  else drawHomeLink()
}
// Alpine (CSP build — no code evaluation, so it works under every Lens frame's
// security header): register behaviour with Alpine.data(...) and reference it
// from x-data / @click by name.
window.Alpine = Alpine
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Alpine.start())
else Alpine.start()

export default Lens
