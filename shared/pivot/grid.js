/**
 * Shared pivot · grid — the pivot grid on the free AG Grid: rows and columns
 * from TM1 hierarchies with drill-down (remembered per outer member), stacked
 * multi-dimension column headings, the shared cell colours, and an edit model.
 * Plain JavaScript (no React, no Tailwind) — used by the Lens toolkit and the
 * IDE's View editor alike.
 *
 *   const g = createPivotGrid(el, {
 *     pivot,                     // from cellsetToPivot: { columns, rows, data }
 *     rowHierarchies,            // [hierarchy] per row dimension (tree.js); missing → flat, from the data
 *     colHierarchies,            // the same for column dimensions (optional)
 *     rowNames,                  // header text per row dimension (default: hierarchy name)
 *     keepMode: 'parent',        // or 'replace' (open parents give way to their children)
 *     totals: 'top', colTotals: 'top',   // or 'bottom'
 *     edit: 'save',              // 'save' (typed values held until saved) | 'immediate' | false
 *     onEdit(changes),           // save mode: after every edit
 *     onWrite(change) → Promise, // immediate mode: write one cell; rejects → value put back
 *     rowEditable(tuple),        // false locks a row
 *     onContextMenu({ tuple, members, cell, event }),
 *     onDrill({ axis: 'rows'|'cols', dimIdx, member, members?, scope, count }) → the host re-queries
 *                                // with more members (scope 'children' | 'all' | 'leaves' | 'keep' |
 *                                // 'remove'); a total whose children the query didn't return opens this way,
 *                                // and right-clicking a row or column heading offers it as a menu
 *     stripes, fit, height, storageKey (remember widths), dark, colors,
 *     makeTheme(headerHeight),   // optional: the host's own AG theme (e.g. the IDE's appearance settings)
 *   })
 *   g.changes() → [{ tuple, members, colId, value, old }]; g.undo(); g.saved()
 *   g.setPivot(pivot, rowHierarchies?, colHierarchies?); g.expandAll('rows'|'cols', dimIdx, open)
 *   g.quickFilter(text); g.freezeTop(on); g.stripes(on); g.exportCsv(fileName); g.destroy()
 *   g.setOptions({ totals, colTotals, keepMode, dark, makeTheme, rowNames, edit }) — redraw with new settings
 */
import { createGrid, ModuleRegistry, AllCommunityModule, themeQuartz, colorSchemeDark } from 'ag-grid-community'
import { applyTm1Format } from './format.js'
import { tupleKey, membersByPosition } from './cellset.js'
import {
    buildHierarchy, constrainHierarchy, initExpandedSets, expandedFor, computeVisibleTuples, tuplePrefixes,
    toggleExpanded, setAllExpanded, tupleIsLeaf, indentFor, changedFlags,
} from './tree.js'

ModuleRegistry.registerModules([AllCommunityModule])

const HDR_ROW_H = 28
const BLUE = '#2b7de9'
const CSS = `
.tp-cell{display:flex;align-items:center;height:100%;gap:2px;overflow:hidden}
.tp-tog{width:16px;height:16px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:inherit;opacity:.65;cursor:pointer;border-radius:3px;font-size:10px;padding:0}
.tp-tog:hover{opacity:1;background:rgba(127,127,127,.18)}
.tp-gap{width:16px;flex:none}
.tp-lab{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tp-tot{font-weight:600}
.tp-rep{height:100%;border-left:1px solid currentColor;opacity:.18;margin-left:8px}
.tp-hdr{display:flex;align-items:center;width:100%;height:100%;gap:4px;overflow:hidden}
.tp-hdr .tp-lab{flex:1;font-weight:600}
.tp-hdr button{opacity:0;border:0;background:transparent;color:inherit;cursor:pointer;font-weight:700;width:16px;height:16px;padding:0;border-radius:3px}
.tp-hdr:hover button{opacity:.7}
.tp-hdr button:hover{opacity:1;background:rgba(127,127,127,.18)}
.tp-stack{display:flex;flex-direction:column;width:100%;height:100%}
.tp-stack > div{display:flex;align-items:center;gap:3px;height:${HDR_ROW_H}px;flex:none;overflow:hidden;border-bottom:1px solid rgba(127,127,127,.25)}
.tp-stack > div:last-child{border-bottom:0}
.tp-click{cursor:pointer;user-select:none}
.tp-menu{position:fixed;z-index:3000;min-width:210px;padding:4px 0;border-radius:8px;border:1px solid rgba(127,127,127,.35);box-shadow:0 10px 28px rgba(0,0,0,.22);font:12px system-ui,sans-serif}
.tp-menu button{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:6px 12px;cursor:pointer;font:inherit}
.tp-menu button:hover{background:rgba(127,127,127,.16)}
.tp-menu button[disabled]{opacity:.4;cursor:default;background:transparent}
.tp-menu hr{border:0;border-top:1px solid rgba(127,127,127,.25);margin:4px 0}
.tp-menu .tp-mh{padding:4px 12px 2px;opacity:.6;font-size:11px}
`
let cssDone = false
function injectCss() {
    if (cssDone || typeof document === 'undefined') return
    const s = document.createElement('style'); s.setAttribute('data-tm1-pivot', ''); s.textContent = CSS
    document.head.appendChild(s); cssDone = true
}

// a flat hierarchy (no parents) from the members a query returned — when no tree is given
function flatHierarchy(names, name) {
    return buildHierarchy(names.map(n => ({ Name: n, Type: 'N', Level: 0 })), name)
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

export function createPivotGrid(host, opts = {}) {
    injectCss()
    const node = typeof host === 'string' ? document.querySelector(host) : host
    node.innerHTML = ''
    const o = { keepMode: 'parent', totals: 'top', colTotals: 'top', edit: false, fit: 'width', ...opts }
    let dark = !!o.dark
    // cell colours for the current light/dark mode (the host may pass its own)
    const colours = () => Object.assign(dark
        ? { calcBg: 'rgba(255,255,255,0.05)', totalBg: 'rgba(255,255,255,0.09)', blue: BLUE }
        : { calcBg: '#eef1f0', totalBg: '#e3e8e6', blue: BLUE }, o.colors || {})
    let striped = !!o.stripes

    let pivot = { columns: [], rows: [], data: {} }
    let rowH = [], colH = []                        // hierarchies in use (constrained to the data)
    let rowFull = [], colFull = []                  // the whole hierarchies — for totals whose children aren't loaded
    let allTotalRows = false                        // every row a total → no grey total shading (it would hide the stripes)
    let rowExp = [], colExp = []                    // expand state
    const orig = new Map()                          // 'tupleKey|colId' → value before typing
    const pending = new Set()                       // immediate mode: being written
    let api = null, frozen = false

    // widths remembered per person
    let widths = {}
    if (o.storageKey) { try { widths = JSON.parse(localStorage.getItem(o.storageKey) || '{}') } catch { widths = {} } }
    const saveWidths = () => { if (o.storageKey) try { localStorage.setItem(o.storageKey, JSON.stringify(widths)) } catch { /* storage refused — widths just aren't remembered */ } }

    const autoHeight = o.height === 'auto'
    node.style.height = autoHeight ? '' : (o.height || node.style.height || '480px')

    // ── hierarchies for the current data ───────────────────────────────────
    function useHierarchies(rowsIn, colsIn) {
        const rowMembers = membersByPosition(pivot.rows)
        const colMembers = membersByPosition(pivot.columns.map(c => c.members))
        const nRow = pivot.rows[0]?.length ?? 0, nCol = pivot.columns[0]?.members?.length ?? 0
        const prevRowCounts = rowH.map(h => Object.keys(h.nodes).length).join(), prevColCounts = colH.map(h => Object.keys(h.nodes).length).join()
        rowFull = Array.from({ length: nRow }, (_, i) => rowsIn?.[i] || null)
        colFull = Array.from({ length: nCol }, (_, i) => colsIn?.[i] || null)
        rowH = Array.from({ length: nRow }, (_, i) => {
            const h = rowsIn?.[i]
            return h ? constrainHierarchy(h, rowMembers[i]) : flatHierarchy(rowMembers[i] ?? [], o.rowNames?.[i] ?? `Dim ${i + 1}`)
        })
        colH = Array.from({ length: nCol }, (_, i) => {
            const h = colsIn?.[i]
            return h ? constrainHierarchy(h, colMembers[i]) : flatHierarchy(colMembers[i] ?? [], `Col ${i + 1}`)
        })
        // keep drill-down state when the shape is the same (e.g. after a save); otherwise start fully open
        if (rowH.map(h => Object.keys(h.nodes).length).join() !== prevRowCounts || rowExp.length !== rowH.length) rowExp = initExpandedSets(rowH)
        if (colH.map(h => Object.keys(h.nodes).length).join() !== prevColCounts || colExp.length !== colH.length) colExp = initExpandedSets(colH)
    }

    // ── what shows ─────────────────────────────────────────────────────────
    function visibleColumns() {
        if (!colH.length) return pivot.columns
        const byKey = new Map(pivot.columns.map(c => [tupleKey(c.members), c]))
        const present = tuplePrefixes(pivot.columns.map(c => tupleKey(c.members)))
        return computeVisibleTuples(colH, colExp, o.keepMode, o.colTotals === 'bottom', present)
            .map(t => byKey.get(tupleKey(t))).filter(Boolean)
    }
    function rowData() {
        if (!rowH.length) return pivot.data[''] ? [{ __key: '', ...pivot.data[''] }] : []
        const present = tuplePrefixes(Object.keys(pivot.data))
        const tuples = computeVisibleTuples(rowH, rowExp, o.keepMode, o.totals === 'bottom', present)
            .filter(t => pivot.data[tupleKey(t)])
        const flags = changedFlags(tuples)
        allTotalRows = tuples.length > 0 && tuples.every(t => !tupleIsLeaf(t, rowH))
        return tuples.map((t, r) => {
            const key = tupleKey(t)
            const row = { __key: key, __tuple: t, ...pivot.data[key] }
            t.forEach((id, i) => {
                const n = rowH[i].nodes[id]
                row[`__d${i}`] = id
                row[`__d${i}_label`] = n?.label ?? id
                row[`__d${i}_node`] = n
                row[`__d${i}_changed`] = flags[r][i]
                row[`__d${i}_ctx`] = t.slice(0, i).join('::')
            })
            return row
        })
    }

    // ── edit rules ─────────────────────────────────────────────────────────
    const rowIsLeaf = row => !row.__tuple || tupleIsLeaf(row.__tuple, rowH)
    const colIsLeaf = col => tupleIsLeaf(col.members ?? [], colH)
    function canEdit(row, col) {
        if (!o.edit || !row) return false
        const cell = row[col.id]
        if (!cell || cell.u === 0 || cell.kind !== 'input') return false
        if (!rowIsLeaf(row) || !colIsLeaf(col)) return false
        return !(o.rowEditable && o.rowEditable(row.__tuple ?? []) === false)
    }
    const isPct = cell => /%/.test(cell?.fmt || '') || /%$/.test(cell?.d || '')
    const isText = cell => (cell?.fmt || '').startsWith('@') || typeof cell?.v === 'string'
    const show = (cell, k) => {
        if (!cell) return ''
        if (orig.has(k)) return cell.v == null || cell.v === '' ? '' : (cell.fmt && typeof cell.v === 'number' ? applyTm1Format(cell.v, cell.fmt) : String(cell.v))
        return cell.d ?? ''
    }
    const changes = () => [...orig.entries()].map(([k, old]) => {
        const [key, colId] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)]
        const col = pivot.columns.find(c => c.id === colId)
        return { tuple: key ? key.split('::') : [], members: col?.members ?? [], colId, value: pivot.data[key]?.[colId]?.v ?? null, old }
    })

    // ── drill-down beyond what the query returned ──────────────────────────
    // a total can open when its children are loaded (local) or when the host can fetch them (onDrill)
    const fullKids = (axis, i, id) => ((axis === 'rows' ? rowFull : colFull)[i]?.nodes?.[id]?.children) ?? []
    const loadedKids = (axis, i, id) => ((axis === 'rows' ? rowH : colH)[i]?.nodes?.[id]?.children) ?? []
    const canOpen = (axis, i, id) => loadedKids(axis, i, id).length > 0 || (!!o.onDrill && fullKids(axis, i, id).length > 0)
    // how many members everything below would add (the host warns before a large one)
    function descendantCount(axis, i, id) {
        const nodes = (axis === 'rows' ? rowFull : colFull)[i]?.nodes || {}
        let n = 0; const seen = new Set(); const stack = [...(nodes[id]?.children || [])]
        while (stack.length) { const c = stack.pop(); if (seen.has(c)) continue; seen.add(c); n++; stack.push(...(nodes[c]?.children || [])) }
        return n
    }
    function drill(axis, i, id, scope, extra = {}) {
        if (!o.onDrill) return
        o.onDrill({ axis, dimIdx: i, member: id, scope, count: scope === 'children' ? fullKids(axis, i, id).length : descendantCount(axis, i, id), ...extra })
    }
    function openOrToggle(axis, i, id, ctx) {
        if (loadedKids(axis, i, id).length) {
            if (axis === 'rows') { rowExp = toggleExpanded(rowH, rowExp, i, id, ctx); refreshRows() }
            else { colExp = toggleExpanded(colH, colExp, i, id, ctx); refreshColumns() }
        } else drill(axis, i, id, 'children')
    }
    // right-click a row or column heading: open / close / narrow it
    let menuEl = null
    const closeMenu = () => { if (menuEl) { menuEl.remove(); menuEl = null; document.removeEventListener('mousedown', outside, true) } }
    const outside = e => { if (menuEl && !menuEl.contains(e.target)) closeMenu() }
    function memberMenu(event, axis, i, id, ctx) {
        event.preventDefault(); event.stopPropagation(); closeMenu()
        const H = axis === 'rows' ? rowH : colH, E = axis === 'rows' ? rowExp : colExp
        const node = H[i]?.nodes?.[id], total = canOpen(axis, i, id)
        const open = total && expandedFor(H, E, i, ctx).has(id) && loadedKids(axis, i, id).length > 0
        // the other members at this depth (for "open this level everywhere")
        const peers = Object.values(H[i]?.nodes || {}).filter(n => n.depth === node?.depth && canOpen(axis, i, n.id)).map(n => n.id)
        const items = [
            ['Expand', total && !open, () => openOrToggle(axis, i, id, ctx)],
            ['Expand all levels below', total && !!o.onDrill, () => drill(axis, i, id, 'all')],
            ['Collapse', open, () => openOrToggle(axis, i, id, ctx)],
            ['Expand this level for all', peers.length > 0 && !!o.onDrill, () => drill(axis, i, id, 'children', { members: peers, count: peers.reduce((a, p) => a + fullKids(axis, i, p).length, 0) })],
            null,
            ['Show leaves only', total && !!o.onDrill, () => drill(axis, i, id, 'leaves')],
            ['Keep only this', !!o.onDrill, () => drill(axis, i, id, 'keep')],
            ['Remove this', !!o.onDrill, () => drill(axis, i, id, 'remove')],
        ]
        menuEl = el('div', 'tp-menu')
        const C = dark ? { bg: '#1f2326', ink: '#e6e8ea' } : { bg: '#ffffff', ink: '#1f2328' }
        menuEl.style.background = C.bg; menuEl.style.color = C.ink
        menuEl.appendChild(el('div', 'tp-mh', node?.label ?? id))
        for (const it of items) {
            if (!it) { menuEl.appendChild(el('hr')); continue }
            const [text, ok, fn] = it
            const b = el('button', null, text); b.type = 'button'; b.disabled = !ok
            b.onclick = () => { closeMenu(); fn() }
            menuEl.appendChild(b)
        }
        document.body.appendChild(menuEl)
        const w = menuEl.offsetWidth || 220, h = menuEl.offsetHeight || 240
        menuEl.style.left = Math.max(4, Math.min(event.clientX, (window.innerWidth || 1200) - w - 4)) + 'px'
        menuEl.style.top = Math.max(4, Math.min(event.clientY, (window.innerHeight || 800) - h - 4)) + 'px'
        setTimeout(() => document.addEventListener('mousedown', outside, true), 0)
    }

    // ── cell + header renderers ────────────────────────────────────────────
    function rowCell(p) {
        const i = p.colDef.context.dimIdx, row = p.data
        if (!row) return ''
        const isInner = i === rowH.length - 1
        if (!isInner && !row[`__d${i}_changed`]) return el('div', 'tp-rep')          // repeated outer label
        const nodeObj = row[`__d${i}_node`], id = row[`__d${i}`]
        const box = el('div', 'tp-cell'); box.style.paddingLeft = indentFor(nodeObj) + 'px'
        const ctx = row[`__d${i}_ctx`]
        const total = nodeObj && !nodeObj.isLeaf && canOpen('rows', i, id)
        if (total) {
            const open = loadedKids('rows', i, id).length > 0 && expandedFor(rowH, rowExp, i, ctx).has(id)
            const b = el('button', 'tp-tog', open ? '▾' : '▸'); b.type = 'button'; b.title = open ? 'Collapse' : 'Expand'
            b.onclick = e => { e.stopPropagation(); openOrToggle('rows', i, id, ctx) }
            box.appendChild(b)
        } else box.appendChild(el('span', 'tp-gap'))
        box.appendChild(el('span', 'tp-lab' + (nodeObj && !nodeObj.isLeaf ? ' tp-tot' : ''), row[`__d${i}_label`]))
        box.oncontextmenu = e => memberMenu(e, 'rows', i, id, ctx)
        return box
    }
    class RowDimHeader {
        init(p) {
            const i = p.column.getColDef().context.dimIdx
            this.g = el('div', 'tp-hdr')
            this.g.appendChild(el('span', 'tp-lab', p.displayName))
            const btn = (t, title, open) => { const b = el('button', null, t); b.type = 'button'; b.title = title; b.onclick = e => { e.stopPropagation(); rowExp = setAllExpanded(rowH, rowExp, i, open); refreshRows() }; return b }
            this.g.append(btn('−', 'Collapse all', false), btn('+', 'Expand all', true))
        }
        getGui() { return this.g }
        refresh() { return false }
    }
    class ColHeader {
        init(p) {
            const tuple = p.column.getColDef().context.tuple, changed = p.column.getColDef().context.changed
            const stacked = colH.length > 1
            this.g = el('div', stacked ? 'tp-stack' : 'tp-hdr')
            tuple.forEach((id, i) => {
                const line = stacked ? el('div') : this.g
                const n = colH[i]?.nodes?.[id], total = n && !n.isLeaf && canOpen('cols', i, id)
                const ctx = tuple.slice(0, i).join('::')
                if (!stacked || changed[i]) {
                    if (total) {
                        const open = loadedKids('cols', i, id).length > 0 && expandedFor(colH, colExp, i, ctx).has(id)
                        line.appendChild(el('span', null, open ? '▾' : '▸'))
                        line.classList.add('tp-click')
                        line.onclick = () => openOrToggle('cols', i, id, ctx)
                    }
                    line.appendChild(el('span', 'tp-lab' + (n && !n.isLeaf ? ' tp-tot' : ''), n?.label ?? id))
                    line.oncontextmenu = e => memberMenu(e, 'cols', i, id, ctx)
                }
                if (stacked) this.g.appendChild(line)
            })
        }
        getGui() { return this.g }
        refresh() { return false }
    }

    // ── columns ────────────────────────────────────────────────────────────
    function columnDefs() {
        const dims = rowH.map((h, i) => ({
            colId: `__d${i}`, field: `__d${i}_label`, headerName: o.rowNames?.[i] ?? h.name ?? `Dim ${i + 1}`,
            pinned: 'left', width: widths[`__d${i}`] ?? (i === 0 ? 200 : 160), minWidth: 80, resizable: true,
            context: { dimIdx: i }, cellRenderer: rowCell, headerComponent: RowDimHeader, sortable: false, filter: false,
        }))
        const cols = visibleColumns()
        const flags = changedFlags(cols.map(c => c.members ?? [c.label]))
        const data = cols.map((col, ci) => {
            const leaf = colIsLeaf(col)
            const k = p => (p.data?.__key ?? '') + '|' + col.id
            return {
                colId: col.id, headerName: col.label,
                headerComponent: colH.length ? ColHeader : undefined,
                context: { tuple: col.members ?? [col.label], changed: flags[ci], leaf },
                width: widths[col.id] ?? 110, minWidth: 60, resizable: true, sortable: false, filter: false, type: 'rightAligned',
                valueGetter: p => p.data?.[col.id]?.v ?? null,
                valueFormatter: p => show(p.data?.[col.id], k(p)) || '—',
                editable: p => canEdit(p.data, col),
                cellEditorSelector: p => isPct(p.data?.[col.id]) ? { component: 'agTextCellEditor', params: { useFormatter: true } } : undefined,
                valueParser: p => {
                    const cell = p.data?.[col.id]
                    if (isText(cell)) return p.newValue ?? ''
                    const raw = String(p.newValue ?? '').trim()
                    if (raw === '') return 0
                    const v = Number(raw.replace(/[,%$£€\s]/g, '')) / (isPct(cell) ? 100 : 1)
                    return Number.isFinite(v) ? v : p.oldValue
                },
                valueSetter: p => {
                    const row = p.data, key = row.__key + '|' + col.id
                    const cell = row[col.id] || (row[col.id] = pivot.data[row.__key][col.id] = { v: null, d: '', u: 1, kind: 'input' })
                    const old = cell.v, nv = p.newValue
                    if (String(old ?? '') === String(nv ?? '')) return false
                    cell.v = nv
                    if (o.edit === 'immediate') {
                        pending.add(key)
                        Promise.resolve(o.onWrite && o.onWrite({ tuple: row.__tuple ?? [], members: col.members ?? [], colId: col.id, value: nv, old }))
                            .then(() => { pending.delete(key); cell.d = show(cell, '') || String(nv ?? ''); repaint() },
                                  e => { pending.delete(key); cell.v = old; repaint(); if (o.onError) o.onError(e) })
                        cell.d = typeof nv === 'number' && cell.fmt ? applyTm1Format(nv, cell.fmt) : String(nv ?? '')
                        return true
                    }
                    if (!orig.has(key)) orig.set(key, old)
                    else if (String(orig.get(key) ?? '') === String(nv ?? '')) orig.delete(key)
                    return true
                },
                cellStyle: p => {
                    const cell = p.data?.[col.id], key = k(p)
                    const total = !leaf || !rowIsLeaf(p.data || {}) || cell?.kind === 'total'
                    const C = colours()
                    const st = { background: '', boxShadow: 'none', fontWeight: '', color: cell?.colour || '', cursor: canEdit(p.data, col) ? 'text' : 'default' }
                    if (total) { if (!allTotalRows) st.background = C.totalBg; st.fontWeight = '600' }
                    else if (cell?.kind === 'calc' || cell?.u === 0) st.background = C.calcBg
                    if (orig.has(key) || pending.has(key)) Object.assign(st, { background: C.blue + '29', boxShadow: 'inset 0 0 0 1.5px ' + C.blue, fontWeight: '600' })
                    return st
                },
            }
        })
        return [...dims, ...data]
    }

    // ── grid ───────────────────────────────────────────────────────────────
    const headerHeight = () => Math.max(1, colH.length) * HDR_ROW_H + (colH.length > 1 ? 4 : 8)
    const themeFor = () => {
        if (o.makeTheme) return o.makeTheme(headerHeight())          // the host's look (IDE appearance settings)
        const base = dark ? themeQuartz.withPart(colorSchemeDark) : themeQuartz
        return (striped ? base.withParams({ oddRowBackgroundColor: dark ? 'rgba(255,255,255,0.045)' : 'rgba(20,60,55,0.045)' }) : base)
            .withParams({ headerHeight: headerHeight() })
    }
    function repaint() { if (api) api.refreshCells({ force: true }) }
    function refreshRows() { api.setGridOption('rowData', rowData()); if (frozen) freeze() }
    function refreshColumns() { api.setGridOption('columnDefs', columnDefs()); repaint() }
    function freeze() { const rows = rowData(); api.setGridOption('pinnedTopRowData', frozen && rows.length ? [rows[0]] : null) }

    function build() {
        useHierarchies(o.rowHierarchies, o.colHierarchies)
        api = createGrid(node, {
            theme: themeFor(),
            columnDefs: columnDefs(),
            rowData: rowData(),
            getRowId: p => p.data.__key,
            domLayout: autoHeight ? 'autoHeight' : 'normal',
            suppressMovableColumns: true,
            singleClickEdit: true,
            stopEditingWhenCellsLoseFocus: true,
            enableCellTextSelection: !o.edit,
            onCellValueChanged: () => { repaint(); if (o.edit === 'save' && o.onEdit) o.onEdit(changes()) },
            onCellContextMenu: o.onContextMenu ? p => {
                if (String(p.column.getColId()).startsWith('__d')) return     // row headings have their own menu
                const col = pivot.columns.find(c => c.id === p.column.getColId())
                o.onContextMenu({ tuple: p.data?.__tuple ?? [], members: col?.members ?? [], cell: p.data?.[p.column.getColId()] ?? null, event: p.event })
            } : undefined,
            onColumnResized: e => { if (e.finished && e.column) { widths[e.column.getColId()] = e.column.getActualWidth(); saveWidths() } },
            // size columns only when the person hasn't set widths of their own
            autoSizeStrategy: Object.keys(widths).length ? undefined : o.fit === 'content' ? { type: 'fitCellContents' } : o.fit === 'width' ? { type: 'fitGridWidth' } : undefined,
            defaultColDef: typeof o.fit === 'number' ? { width: o.fit } : undefined,
            preventDefaultOnContextMenu: !!o.onContextMenu,
        })
    }
    if (o.pivot) pivot = o.pivot
    build()

    return {
        get api() { return api },
        changes,
        undo() {
            for (const [k, old] of orig) { const i = k.lastIndexOf('|'); const cell = pivot.data[k.slice(0, i)]?.[k.slice(i + 1)]; if (cell) cell.v = old }
            orig.clear(); repaint(); if (o.edit === 'save' && o.onEdit) o.onEdit([])
        },
        saved() {
            for (const k of orig.keys()) { const i = k.lastIndexOf('|'); const cell = pivot.data[k.slice(0, i)]?.[k.slice(i + 1)]; if (cell) cell.d = show(cell, k) }
            orig.clear(); repaint(); if (o.edit === 'save' && o.onEdit) o.onEdit([])
        },
        // new data (after a query); keeps drill-down when the shape is unchanged
        setPivot(next, rowsIn, colsIn) {
            pivot = next || { columns: [], rows: [], data: {} }
            if (rowsIn) o.rowHierarchies = rowsIn
            if (colsIn) o.colHierarchies = colsIn
            orig.clear()
            useHierarchies(o.rowHierarchies, o.colHierarchies)
            api.setGridOption('theme', themeFor())
            api.setGridOption('columnDefs', columnDefs())
            api.setGridOption('rowData', rowData())
            if (frozen) freeze()
        },
        expandAll(axis, dimIdx, open = true) {
            if (axis === 'cols') { colExp = setAllExpanded(colH, colExp, dimIdx, open); refreshColumns() }
            else { rowExp = setAllExpanded(rowH, rowExp, dimIdx, open); refreshRows() }
        },
        quickFilter(text) { api.setGridOption('quickFilterText', text || undefined); if (text && frozen) { frozen = false; freeze() } },
        freezeTop(on) { frozen = !!on; freeze() },
        stripes(on) { striped = !!on; api.setGridOption('theme', themeFor()) },
        setOptions(next = {}) {
            Object.assign(o, next)
            if ('dark' in next) dark = !!next.dark
            api.setGridOption('theme', themeFor())
            api.setGridOption('columnDefs', columnDefs())
            api.setGridOption('rowData', rowData())
            if (frozen) freeze()
            repaint()
        },
        fitColumns() { api.autoSizeAllColumns() },
        resetWidths() { widths = {}; saveWidths(); api.setGridOption('columnDefs', columnDefs()); api.sizeColumnsToFit() },
        // the grid as it stands (labels, headings, what is shown) — tab-separated, pastes into Excel
        toText() {
            const cols = api.getAllDisplayedColumns()
            const head = cols.map(c => c.getColDef().headerName ?? '').join('\t')
            const lines = []
            api.forEachNodeAfterFilterAndSort(n => {
                lines.push(cols.map(c => {
                    const id = c.getColId()
                    if (id.startsWith('__d')) return n.data?.[`${id}_label`] ?? ''
                    return show(n.data?.[id], (n.data?.__key ?? '') + '|' + id)
                }).join('\t'))
            })
            return [head, ...lines].join('\n')
        },
        exportCsv(fileName) {
            api.exportDataAsCsv({
                fileName,
                processCellCallback: p => {
                    const id = p.column.getColId()
                    if (id.startsWith('__d')) return p.node.data?.[`${id}_label`] ?? ''
                    return p.value ?? ''
                },
            })
        },
        destroy() { closeMenu(); if (api) api.destroy(); api = null },
    }
}
