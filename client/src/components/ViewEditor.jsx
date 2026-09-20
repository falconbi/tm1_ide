import { useState, useMemo, useCallback, useEffect, useRef, useReducer } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable, useDraggable } from '@dnd-kit/core'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { subsetApplyCallbacks } from '@/lib/subsetCallbacks'
import { useCubeDimensions, useSubsets, useElementsTree, useViews, useExecuteMDX, useViewAxes, useSaveView, useSetDefaultView, usePawBookUsage, useDimAttributes, useViewUsage, useMultiFormatAttrs, useConflictCheck, useGenerateViewMDX, useConfig } from '@/hooks/useApi'
import { toast } from 'sonner'
import { RefreshCw, Loader2, Table2, GripVertical, GripHorizontal, X, LayoutGrid, Rows3, Columns3, Filter, ZapOff, Zap, ChevronLeft, ChevronRight, PencilLine, Save, Code2, Eye, ChevronDown, BookOpen, ChevronUp, Locate, MapPin, WrapText, Braces, History, AlertTriangle, Search, Cog, Box, FileSearch, Rss, Sparkles, Clock, Check, ArrowUpDown } from 'lucide-react'
import TransactionLogPanel from '@/components/TransactionLogPanel'
import CellContextMenu from '@/components/CellContextMenu'
import { cn, tm1NumericComparator } from '@/lib/utils'
import { useGridAppearance } from '@/lib/grid-appearance'
import { stripTm1TypePrefix, applyTm1Format, extractRuleCalls, splitArgs, resolveArg, matchingCloseParen, splitTopLevelOps, rhsOf, splitComparison } from '@/lib/tm1-rule-parser'

ModuleRegistry.registerModules([AllCommunityModule])

// Saved sessions — local drafts for experimenting before settling on the final
// view. Same pattern as SubsetEditor's sessions: named snapshots in localStorage,
// not saved to TM1, not shared with anyone else.
const VIEW_SESSIONS_KEY = 'tm1-view-sessions'
function loadViewSessions() { try { return JSON.parse(localStorage.getItem(VIEW_SESSIONS_KEY) || '[]') } catch { return [] } }
function saveViewSessionEntry(entry) {
    const list = loadViewSessions().filter(s => s.name !== entry.name)
    list.unshift({ ...entry, time: Date.now() })
    localStorage.setItem(VIEW_SESSIONS_KEY, JSON.stringify(list.slice(0, 30)))
}

import { buildMDX } from '@core/mdxBuilder.js'
import HierarchyGrid from '@/components/HierarchyGrid'
import GridToolbar from '@/components/GridToolbar'
import { ConflictBanner, ConflictSaveWarning } from '@/components/ConflictBanner'
import DiffViewerModal from '@/components/DiffViewerModal'
import { Component } from 'react'

class GridErrorBoundary extends Component {
    constructor(props) { super(props); this.state = { error: null } }
    static getDerivedStateFromError(error) { return { error } }
    render() {
        if (this.state.error) {
            return (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground p-8">
                    <AlertTriangle size={28} className="text-amber-500" />
                    <p className="font-medium text-foreground">View could not be rendered</p>
                    <p className="text-xs text-center max-w-xs">{this.state.error.message}</p>
                    <button
                        className="mt-2 px-3 py-1.5 rounded border text-xs hover:bg-muted"
                        onClick={() => this.setState({ error: null })}
                    >Retry</button>
                </div>
            )
        }
        return this.props.children
    }
}

class TraceErrorBoundary extends Component {
    constructor(props) { super(props); this.state = { error: null } }
    static getDerivedStateFromError(error) { return { error } }
    render() {
        if (this.state.error) {
            return (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground p-6">
                    <AlertTriangle size={16} className="text-amber-500" />
                    <p className="font-medium text-foreground">Trace could not be rendered</p>
                    <p className="text-center text-red-400 break-all">{String(this.state.error?.message ?? this.state.error)}</p>
                    <button
                        className="mt-1 px-3 py-1 rounded border text-[10px] hover:bg-muted"
                        onClick={() => this.setState({ error: null })}
                    >Retry</button>
                </div>
            )
        }
        return this.props.children
    }
}

// MDX functions the visual builder cannot represent — triggers MDX-only lock
const COMPLEX_MDX_PATTERNS = [
    ['STRTOMEMBER',    /\bSTRTOMEMBER\b/i],
    ['DRILLDOWNMEMBER',/\bDRILLDOWNMEMBER\b/i],
    ['DRILLUPMEMBER',  /\bDRILLUPMEMBER\b/i],
    ['SUBSET',         /\bSUBSET\s*\(/i],
    ['GENERATE',       /\bGENERATE\s*\(/i],
    ['FILTER',         /\bFILTER\s*\(/i],
    ['ORDER',          /\bORDER\s*\(/i],
    ['TOPCOUNT',       /\bTOPCOUNT\b/i],
    ['BOTTOMCOUNT',    /\bBOTTOMCOUNT\b/i],
    ['.PROPERTIES',    /\.PROPERTIES\s*\(/i],
    ['HIERARCHIZE',    /\bHIERARCHIZE\b/i],
]

function detectComplexMDX(mdx) {
    if (!mdx) return null
    const found = COMPLEX_MDX_PATTERNS.filter(([, re]) => re.test(mdx)).map(([name]) => name)
    return found.length ? found : null
}

// ── Cellset → HierarchyGrid transforms ───────────────────────────────────────

function buildHierarchyFromElements(elements, name) {
    if (!elements?.length) return null
    const nodes = {}
    for (const el of elements) {
        nodes[el.Name] = {
            id:       el.Name,
            label:    el.Name,
            level:    el.Level ?? 0,
            isLeaf:   el.Type !== 'C',
            children: el.Components ?? [],
        }
    }
    const childSet = new Set(elements.flatMap(e => e.Components ?? []))
    const roots    = elements.filter(e => !childSet.has(e.Name)).map(e => e.Name)
    const maxLevel = Math.max(0, ...elements.map(e => e.Level ?? 0))
    return { nodes, roots, maxLevel, name }
}

// Prune hierarchy to only members present in the cellset result.
// Consolidations only appear if they were actually returned by TM1.
// Children list is filtered to only present members; isLeaf recomputed.
function constrainHierarchy(hierarchy, presentMembers) {
    if (!hierarchy || !presentMembers?.length) return hierarchy
    const presentSet = new Set(presentMembers)
    const { nodes: allNodes, name } = hierarchy

    const nodes = {}
    for (const id of presentMembers) {
        const node = allNodes[id]
        if (!node) continue
        const children = (node.children ?? []).filter(c => presentSet.has(c))
        nodes[id] = { ...node, children, isLeaf: children.length === 0 }
    }

    const childSet = new Set(Object.values(nodes).flatMap(n => n.children))
    const roots    = Object.keys(nodes).filter(id => !childSet.has(id))
    const maxLevel = Math.max(0, ...Object.values(nodes).map(n => n.level ?? 0))
    return { nodes, roots, maxLevel, name }
}

function lookupFormat(dim, elem, formatMap) {
    if (!elem) return null
    const scoped = formatMap[dim]?.[elem]
    if (scoped) return scoped
    for (const d of Object.keys(formatMap)) {
        const f = formatMap[d]?.[elem]
        if (f && typeof f === 'string') return f
    }
    return null
}

function cellsetToHierarchyData(cellset, formatMap = {}, pageMembers = [], suppressZeros = 'none', useFormat = true) {
    if (!cellset?.Axes?.length) return null
    const colAxis = cellset.Axes.find(a => a.Ordinal === 0)
    const rowAxis = cellset.Axes.find(a => a.Ordinal === 1)
    if (!colAxis) return null

    const colTuples = colAxis.Tuples ?? []
    const rowTuples = rowAxis?.Tuples ?? []

    // Include members array so HierarchyGrid can build tuple keys for multi-dim cols
    let columns = colTuples.map((t, i) => ({
        id:      `c${i}`,
        label:   (t.Members ?? []).map(m => m.Name).join(' / '),
        members: (t.Members ?? []).map(m => m.Name),
    }))

    const cellMap = {}
    ;(cellset.Cells ?? []).forEach(c => { cellMap[c.Ordinal] = c })

    const isValEmpty = v => {
        if (v == null || v === 0) return true
        if (typeof v === 'string') {
            const t = v.trim()
            if (t === '') return true
            if (!isNaN(Number(t)) && Number(t) === 0) return true
        }
        return false
    }

    const supRows = suppressZeros === 'rows' || suppressZeros === 'all' || suppressZeros === true
    const supCols = suppressZeros === 'columns' || suppressZeros === 'all'

    const data = {}
    const colHasData = {}
    rowTuples.forEach((tuple, ri) => {
        const tupleKey = (tuple.Members ?? []).map(m => m.Name).join('::')
        if (!tupleKey) return

        if (supRows) {
            const cellsThisRow = columns.map((_, ci) => cellMap[ri * columns.length + ci])
            const allZero = cellsThisRow.every(c => isValEmpty(c?.Value))
            if (allZero) return
        }

        if (!data[tupleKey]) data[tupleKey] = {}
        columns.forEach((col, ci) => {
            const cell = cellMap[ri * columns.length + ci]
            if (!isValEmpty(cell?.Value)) colHasData[col.id] = true
            const colTuple = colTuples[ci]
            const colMembers = (colTuple?.Members ?? []).map(m => ({ dim: parseDimFromUniqueName(m.UniqueName), elem: elementFromUniqueName(m.UniqueName) || m.Name }))
            const rowMembers = (tuple?.Members ?? []).map(m => ({ dim: parseDimFromUniqueName(m.UniqueName), elem: elementFromUniqueName(m.UniqueName) || m.Name }))
            const allMembers = [...rowMembers, ...colMembers]
            let fmt = null
            for (const m of allMembers) {
                fmt = lookupFormat(m.dim, m.elem, formatMap)
                if (fmt) break
            }
            if (!fmt) {
                for (const p of pageMembers) {
                    for (const d of Object.keys(formatMap)) {
                        const f = formatMap[d]?.[p]
                        if (f && typeof f === 'string') { fmt = f; break }
                    }
                    if (fmt) break
                }
            }
            const rawVal = cell?.Value
            const fv = cell?.FormattedValue
            // TM1 often returns Value:null with FormattedValue:"0.00" for zero cells —
            // derive a number so the format string is still applied (else 0 shows "0.00").
            const numVal = rawVal != null
                ? rawVal
                : (fv != null && fv !== '' && !Number.isNaN(Number(stripTm1TypePrefix(fv))) ? Number(stripTm1TypePrefix(fv)) : null)
            let display
            if (fmt && numVal != null) {
                display = useFormat ? applyTm1Format(numVal, fmt) : String(numVal)
            } else if (useFormat && fv != null && fv !== '') {
                display = stripTm1TypePrefix(fv)
            } else {
                display = rawVal ?? null
            }
            data[tupleKey][col.id] = display
            data[tupleKey][`${col.id}__u`] = cell?.Updateable ?? 1
            if (fmt?.startsWith('@')) {
                data[tupleKey][`${col.id}__fmt`] = '@'
                const colour = fmt.slice(1).trim()
                if (colour) data[tupleKey][`${col.id}__colour`] = colour
            }
        })
    })

    if (supCols && Object.keys(data).length) {
        const emptyColIds = columns.filter(col => !colHasData[col.id]).map(col => col.id)
        if (emptyColIds.length) {
            for (const key of Object.keys(data)) {
                for (const cid of emptyColIds) delete data[key][cid]
            }
            columns = columns.filter(c => !emptyColIds.includes(c.id))
        }
    }

    return { columns, data }
}

// Convert ViewEditor axis state → GuidedMDXBuilder dimConfig format
function viewerAxesToBuilderConfig(axes) {
    const toExpr = (dim, d, isFilter) => {
        if (d.memberSet === 'leaf') return `{TM1FILTERBYLEVEL({[${dim}].[${dim}].Members}, 0)}`
        if (d.memberSet === 'root') return `{[${dim}].[${dim}].DefaultMember}`
        if (d.memberSet === 'all')  return `{TM1SUBSETALL([${dim}].[${dim}])}`
        if (d.subset)               return `TM1SubsetToSet([${dim}].[${dim}], "${d.subset}", "public")`
        if (d.members?.length > 1)  return `{${d.members.map(m => `[${dim}].[${dim}].[${m}]`).join(', ')}}`
        if (d.member)               return isFilter ? d.member : `{[${dim}].[${dim}].[${d.member}]}`
        return ''
    }
    const config = {}
    for (const d of axes.rows)    config[d.dimension] = { axis: 'rows',    subsetExpression: toExpr(d.dimension, d, false) }
    for (const d of axes.columns) config[d.dimension] = { axis: 'columns', subsetExpression: toExpr(d.dimension, d, false) }
    for (const d of axes.pages)   config[d.dimension] = { axis: 'filter',  subsetExpression: toExpr(d.dimension, d, true) }
    return config
}

function formatMDX(mdx) {
    if (!mdx?.trim()) return mdx
    // Pass 1 — collapse whitespace and split on SELECT structure keywords
    let s = mdx.replace(/\s+/g, ' ').trim()
    s = s
        .replace(/\bSELECT\b\s*/gi,               'SELECT\n  ')
        .replace(/\s*\bNON EMPTY\b\s*/gi,          ' NON EMPTY ')
        .replace(/\s*\bON COLUMNS\s*,\s*/gi,       ' ON COLUMNS,\n  ')
        .replace(/\s*\bON COLUMNS\b/gi,            ' ON COLUMNS')
        .replace(/\s*\bON ROWS\s*,\s*/gi,          ' ON ROWS,\n  ')
        .replace(/\s*\bON ROWS\b/gi,               ' ON ROWS')
        .replace(/\s*\bON 0\s*,\s*/gi,             ' ON COLUMNS,\n  ')
        .replace(/\s*\bON 0\b/gi,                  ' ON COLUMNS')
        .replace(/\s*\bON 1\s*,\s*/gi,             ' ON ROWS,\n  ')
        .replace(/\s*\bON 1\b/gi,                  ' ON ROWS')
        .replace(/\s*\bFROM\b\s*/gi,               '\nFROM ')
        .replace(/\s*\bWHERE\b\s*/gi,              '\nWHERE ')
        .trim()
    // Pass 2 — brace-indent each line that contains { } expressions
    return s.split('\n').map(line => {
        const lead = line.match(/^(\s*)/)[1]
        const body = line.trimStart()
        if (!body.includes('{')) return line
        let out = '', depth = 0
        for (let i = 0; i < body.length; i++) {
            const ch = body[i]
            if      (ch === '{') { out += '{\n' + lead + '  '.repeat(depth + 1); depth++ }
            else if (ch === '}') { depth = Math.max(0, depth - 1); out = out.trimEnd() + '\n' + lead + '  '.repeat(depth) + '}' }
            else if (ch === ',' && depth > 0) { out += ',\n' + lead + '  '.repeat(depth) }
            else { out += ch }
        }
        return lead + out.trim()
    }).join('\n').trim()
}
// ── Cellset → AG Grid ─────────────────────────────────────────────────────────

function parseDimFromUniqueName(un) {
    return un?.match(/^\[([^\]]+)\]/)?.[1] ?? ''
}

function elementFromUniqueName(un) {
    return un?.match(/\[([^\]]+)\]$/)?.[1] ?? ''
}

function parseCellset(data, formatMap = {}, pageMembers = [], useFormat = true) {
    if (!data?.Axes?.length) return null
    const colAx = data.Axes.find(a => a.Ordinal === 0)
    const rowAx = data.Axes.find(a => a.Ordinal === 1)
    if (!colAx) return null

    const colTuples = colAx.Tuples ?? []
    const rowTuples = rowAx ? (rowAx.Tuples ?? []) : []

    const cols = colTuples.map(t => (t.Members ?? []).map(m => m.Name).join(' / '))
    const rowDimNames = (rowTuples[0]?.Members ?? []).map(m => parseDimFromUniqueName(m.UniqueName))
    const rows = rowTuples.map(t => (t.Members ?? []).map(m => m.Name))

    const numCols = cols.length
    const cellMap = {}
    ;(data.Cells ?? []).forEach(c => { cellMap[c.Ordinal] = c })

    const grid = (rows.length ? rows : [[]]).map((_, ri) =>
        colTuples.map((tuple, ci) => {
            const c = cellMap[ri * numCols + ci]
            if (!c) return ''
            const elemNames = (tuple.Members ?? []).map(m => elementFromUniqueName(m.UniqueName) || m.Name)
            const fmtKey = elemNames.find(n => formatMap[n]) || pageMembers.find(n => formatMap[n])
            if (fmtKey) {
                const fv = c.FormattedValue
                // Value may be null with FormattedValue "0.00" for zero cells — derive a number
                const num = c.Value != null
                    ? c.Value
                    : (fv != null && fv !== '' && !Number.isNaN(Number(stripTm1TypePrefix(fv))) ? Number(stripTm1TypePrefix(fv)) : c.Value)
                return num != null ? (useFormat ? applyTm1Format(num, formatMap[fmtKey]) : String(num)) : ''
            }
            const fv = c.FormattedValue
            if (useFormat && fv !== '' && fv != null) return stripTm1TypePrefix(fv)
            const v = c.Value
            return v != null ? String(v) : ''
        })
    )

    return { cols, rows, rowDimNames, grid }
}

function buildGridData(parsed) {
    if (!parsed) return { colDefs: [], rowData: [] }
    const { cols, rows, rowDimNames, grid } = parsed
    const rowDimCount = rowDimNames.length || 1

    const rowColDefs = Array.from({ length: rowDimCount }, (_, i) => ({
        field: `__row_${i}__`,
        headerName: rowDimNames[i] ?? '',
        pinned: 'left',
        width: 160,
        minWidth: 60,
        resizable: true,
        cellStyle: (params) => {
            if (i < rowDimCount - 1 && params.node.rowIndex > 0) {
                const prev = params.api.getDisplayedRowAtIndex(params.node.rowIndex - 1)?.data?.[`__row_${i}__`]
                if (prev === params.value) return { fontWeight: 600, color: 'var(--ag-row-border-color, #ccc)' }
            }
            return { fontWeight: 600 }
        },
    }))

    const colDefs = [
        ...rowColDefs,
        ...cols.map((c, i) => ({
            field: `c${i}`, headerName: c, width: 110, minWidth: 60, resizable: true,
            comparator: tm1NumericComparator,
            valueFormatter: p => (p.value === '' || p.value == null) ? '—' : String(p.value),
            cellStyle: p => (p.value === '' || p.value == null) ? { color: '#888' } : {},
        })),
    ]

    const rowData = grid.map((row, ri) => {
        const obj = { __ri__: ri, __tupleKey__: (rows[ri] ?? []).join('::') }
        const members = rows[ri] ?? []
        Array.from({ length: rowDimCount }, (_, i) => { obj[`__row_${i}__`] = members[i] ?? '' })
        row.forEach((v, ci) => { obj[`c${ci}`] = v })
        return obj
    })

    return { colDefs, rowData }
}

// ── Subset/member popover ─────────────────────────────────────────────────────

function Checkbox({ active }) {
    return (
        <span className={cn('w-3 h-3 shrink-0 rounded border flex items-center justify-center',
            active ? 'bg-primary border-primary' : 'border-border')}>
            {active && <span className="text-primary-foreground text-[8px] font-bold">✓</span>}
        </span>
    )
}

function TreeNodes({ nodes, depth, isFilter, checked, expanded, toggleMember, toggleExpand, dimMember, onCheckDescendants }) {
    return nodes.map(node => {
        const isC    = node.Type === 'C'
        const isOpen = expanded.has(node.Name)
        const active = isFilter ? dimMember === node.Name : checked?.has(node.Name)
        return (
            <div key={node.Name}>
                <div className={cn('flex items-center gap-1 w-full pr-2 py-1 hover:bg-muted group',
                    isC ? 'font-medium' : 'text-muted-foreground',
                    active && 'text-primary font-medium')}
                    style={{ paddingLeft: `${8 + depth * 12}px` }}>
                    {isC ? (
                        <button onClick={() => toggleExpand(node.Name)}
                            className="shrink-0 text-muted-foreground hover:text-foreground w-3 flex items-center">
                            {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                        </button>
                    ) : <span className="w-3 shrink-0" />}
                    <button onClick={() => toggleMember(node.Name)}
                        className="flex items-center gap-1.5 flex-1 text-left font-mono truncate text-xs min-w-0">
                        {!isFilter && <Checkbox active={active} />}
                        <span className="truncate">{node.Name}</span>
                    </button>
                    {isC && !isFilter && onCheckDescendants && (
                        <button onClick={e => { e.stopPropagation(); onCheckDescendants(node) }}
                            className="opacity-0 group-hover:opacity-100 shrink-0 text-[9px] text-muted-foreground hover:text-primary transition-opacity px-1 rounded hover:bg-primary/10"
                            title="Select all leaf members under this consolidation">
                            ↓all
                        </button>
                    )}
                </div>
                {isC && isOpen && node.children.length > 0 && (
                    <TreeNodes nodes={node.children} depth={depth + 1} isFilter={isFilter}
                        checked={checked} expanded={expanded} toggleMember={toggleMember}
                        toggleExpand={toggleExpand} dimMember={dimMember} onCheckDescendants={onCheckDescendants} />
                )}
            </div>
        )
    })
}

// Build a tree using Components (explicit children) when available
function buildElementTree(elements) {
    const byName = Object.fromEntries(elements.map(el => [el.Name, { ...el, children: [] }]))
    const hasComponents = elements.some(el => el.Components?.length)

    if (hasComponents) {
        // Use explicit parent-child relationships from $expand=Components
        const childSet = new Set()
        for (const el of elements) {
            for (const childName of (el.Components ?? [])) {
                if (byName[childName]) {
                    byName[el.Name].children.push(byName[childName])
                    childSet.add(childName)
                }
            }
        }
        return Object.values(byName).filter(n => !childSet.has(n.Name))
    }

    // Fallback: group by level — show consolidations at top, leaves below
    const maxLevel = Math.max(0, ...elements.map(el => el.Level ?? 0))
    if (maxLevel === 0) return elements.map(el => ({ ...el, children: [] }))

    // Sort by level descending so highest consolidations come first
    const sorted = [...elements].sort((a, b) => (b.Level ?? 0) - (a.Level ?? 0))
    const roots = []
    for (const el of sorted) {
        byName[el.Name].children = []
        if ((el.Level ?? 0) === maxLevel) roots.push(byName[el.Name])
    }
    return roots
}

function SubsetPopover({ server, dim, zone, subsets, onSubsetSelect, onMemberSelect, onMembersSelect, onMemberSetSelect, onEditSubset, onBuildSubset, onClose }) {
    const isFilter    = zone === 'pages'
    const [tab, setTab]           = useState((dim.member || dim.members?.length) ? 'manual' : 'subset')
    const [search, setSearch]     = useState('')
    const [checked, setChecked]   = useState(() => new Set(dim.members ?? (dim.member ? [dim.member] : [])))
    const [expanded, setExpanded] = useState(new Set())

    const { data: allElements = [], isLoading: loadingElements } = useElementsTree(
        tab === 'manual' ? server : null,
        tab === 'manual' ? dim.dimension : null,
    )

    const tree     = useMemo(() => buildElementTree(allElements), [allElements])
    const filtered = search ? allElements.filter(el => el.Name.toLowerCase().includes(search.toLowerCase())) : null

    // Auto-expand all consolidations when filter has a selected member so it's visible in the tree
    useEffect(() => {
        if (!isFilter || !dim.member || !allElements.length) return
        setExpanded(new Set(allElements.filter(el => el.Type === 'C').map(el => el.Name)))
    }, [allElements.length, isFilter, dim.member])

    const toggleExpand = name => setExpanded(prev => {
        const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next
    })

    const toggleMember = name => {
        if (isFilter) { onMemberSelect(name); onClose() }
        else setChecked(prev => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next })
    }

    const applyMulti = () => {
        const arr = [...checked]
        if (arr.length === 0) { onMemberSelect(null) }
        else if (arr.length === 1) { onMemberSelect(arr[0]) }
        else { onMembersSelect?.(arr) }
        onClose()
    }

    const selectMemberSet = mset => { onMemberSetSelect?.(mset); onClose() }

    const checkDescendants = useCallback((node) => {
        const leaves = []
        const collect = (n) => {
            if (!n.children?.length) leaves.push(n.Name)
            else n.children.forEach(collect)
        }
        collect(node)
        setChecked(prev => new Set([...prev, ...leaves]))
        if (tab !== 'manual') setTab('manual')
    }, [tab])

    const QUICK = [
        { id: 'all',  label: 'All',  title: 'All members of the dimension' },
        { id: 'leaf', label: 'Leaf', title: 'Leaf (level 0) members only' },
        { id: 'root', label: 'Root', title: 'Root (top-level) member only' },
    ]

    return (
        <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded shadow-lg w-56 text-xs" style={{ maxHeight: 360 }}>

            {/* Tabs */}
            <div className="flex border-b border-border shrink-0">
                <button onClick={() => setTab('subset')}
                    className={cn('flex-1 py-1.5 text-[10px] uppercase tracking-wider font-semibold transition-colors',
                        tab === 'subset' ? 'text-foreground border-b-2 border-primary -mb-px' : 'text-muted-foreground hover:text-foreground')}>
                    Subset
                </button>
                <button onClick={() => setTab('manual')}
                    className={cn('flex-1 py-1.5 text-[10px] uppercase tracking-wider font-semibold transition-colors',
                        tab === 'manual' ? 'text-foreground border-b-2 border-primary -mb-px' : 'text-muted-foreground hover:text-foreground')}>
                    Manual
                </button>
            </div>

            {tab === 'subset' ? (
                <div className="flex flex-col" style={{ maxHeight: 310 }}>
                    {/* Quick-select: All / Leaf / Root */}
                    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
                        {QUICK.map(q => (
                            <button key={q.id} onClick={() => selectMemberSet(q.id)} title={q.title}
                                className={cn('flex-1 py-1 text-[10px] rounded border transition-colors font-medium',
                                    dim.memberSet === q.id
                                        ? 'bg-primary text-primary-foreground border-primary'
                                        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground')}>
                                {q.label}
                            </button>
                        ))}
                    </div>
                    {/* Build & apply via SubsetEditor */}
                    {onBuildSubset && (
                        <div className="px-2 py-1.5 border-b border-border shrink-0">
                            <button onClick={() => { onBuildSubset(); onClose() }}
                                className="w-full px-2 py-1 text-[10px] rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left flex items-center gap-1.5">
                                <Braces size={9} /> Open in Subset Editor…
                            </button>
                        </div>
                    )}
                    {/* Named subsets */}
                    <div className="overflow-auto flex-1">
                        {subsets.length === 0 && (
                            <p className="px-3 py-2 text-muted-foreground italic text-[10px]">No saved subsets</p>
                        )}
                        {subsets.map(s => (
                            <div key={s.Name} className="flex items-center group">
                                <button onClick={() => { onSubsetSelect(s.Name); onClose() }}
                                    className={cn('flex-1 px-3 py-1.5 hover:bg-muted text-left font-mono truncate',
                                        dim.subset === s.Name && 'text-primary font-medium')}>
                                    {s.Name}
                                </button>
                                <button onClick={e => { e.stopPropagation(); onEditSubset?.(dim.dimension, s.Name) }}
                                    className="opacity-0 group-hover:opacity-100 px-2 py-1 text-muted-foreground hover:text-foreground shrink-0">
                                    <PencilLine size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                /* Manual tab: ad-hoc member selection — no save required */
                <div className="flex flex-col" style={{ maxHeight: 310 }}>
                    <div className="px-2 py-1.5 border-b border-border shrink-0">
                        <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Search members…"
                            className="w-full bg-muted rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
                    </div>
                    <div className="overflow-auto flex-1">
                        {loadingElements ? (
                            <div className="px-3 py-2 text-muted-foreground flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Loading…</div>
                        ) : filtered ? (
                            filtered.map(el => {
                                const active = isFilter ? dim.member === el.Name : checked.has(el.Name)
                                return (
                                    <button key={el.Name} onClick={() => toggleMember(el.Name)}
                                        className={cn('flex items-center gap-2 w-full px-3 py-1 hover:bg-muted text-left font-mono truncate',
                                            el.Type === 'C' ? 'font-medium' : 'text-muted-foreground',
                                            active && 'text-primary font-medium')}>
                                        {!isFilter && <Checkbox active={active} />}
                                        <span className="truncate">{el.Name}</span>
                                    </button>
                                )
                            })
                        ) : (
                            <TreeNodes nodes={tree} depth={0} isFilter={isFilter} checked={checked}
                                expanded={expanded} toggleMember={toggleMember} toggleExpand={toggleExpand}
                                dimMember={dim.member} onCheckDescendants={!isFilter ? checkDescendants : null} />
                        )}
                    </div>
                    {!isFilter && (
                        <div className="border-t border-border px-2 py-1.5 flex items-center justify-between shrink-0">
                            <span className="text-[10px] text-muted-foreground">{checked.size} selected</span>
                            <button onClick={applyMulti}
                                className="px-3 py-1 text-[10px] rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                                Apply
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Draggable dimension pill ──────────────────────────────────────────────────

function DimPill({ id, dim, zone, server, onRemove, onSubsetChange, onMemberChange, onMembersChange, onMemberSetChange, onMoveLeft, onMoveRight, activeAlias, onAliasChange, onBuildSubset }) {
    const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id })
    const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `dim:${dim.dimension}` })
    const { data: subsets = [] } = useSubsets(server, dim.dimension)
    const { data: dimAttrs = [] } = useDimAttributes(server, dim.dimension)
    const aliasAttrs = dimAttrs.filter(a => a.type === 'Alias')
    const [open, setOpen] = useState(false)
    const [aliasOpen, setAliasOpen] = useState(false)
    const ref = useRef(null)
    const openTab = useStore(s => s.openTab)

    const onEditSubset = (dimName, subsetName) => {
        setOpen(false)
        openTab({
            id:         `subset:${server}:${dimName}:${subsetName}`,
            type:       'subset',
            label:      subsetName,
            server,
            dimension:  dimName,
            subsetName,
        })
    }

    useEffect(() => {
        if (!open) return
        const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open, aliasOpen])

    const label = dim.customExpr ? 'MDX·expr'
        : dim.memberSet ? { leaf: 'Leaf', root: 'Root', all: 'All' }[dim.memberSet]
        : dim.members?.length ? `{${dim.members.slice(0, 2).join(', ')}${dim.members.length > 2 ? ` +${dim.members.length - 2}` : ''}}`
        : dim.member ?? dim.subset ?? (zone === 'bench' ? null : 'Members')

    return (
        <div ref={ref} className="relative">
            <div
                ref={el => { setDragRef(el); setDropRef(el) }}
                className={cn(
                    'flex items-start gap-1 px-2 py-1 rounded border text-xs bg-muted border-border select-none group max-w-[200px] min-w-0',
                    isDragging && 'opacity-40',
                    isOver && !isDragging && 'border-primary border-l-[3px]',
                    open && 'border-primary'
                )}
            >
                <span {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
                    <GripVertical size={11} />
                </span>
                <div className="flex-1 min-w-0">
                    <button
                        onClick={() => zone !== 'bench' && setOpen(o => !o)}
                        className="w-full text-left"
                        title={dim.dimension}
                    >
                        <span className="font-mono truncate block text-xs">{dim.dimension}</span>
                    </button>
                    <div className="flex items-center gap-0.5 min-w-0">
                        {label
                            ? <span className="text-[10px] text-primary/70 truncate flex-1 min-w-0">{label}</span>
                            : <span className="flex-1" />
                        }
                        {zone !== 'bench' && aliasAttrs.length > 0 && (
                            <div className="relative">
                                <button
                                    onClick={e => { e.stopPropagation(); setAliasOpen(o => !o) }}
                                    className={cn('text-[9px] font-bold px-1 rounded transition-colors',
                                        activeAlias ? 'text-amber-400' : 'text-muted-foreground/40 hover:text-amber-400/70')}
                                    title={activeAlias ? `Alias: ${activeAlias}` : 'Display alias'}
                                >A</button>
                                {aliasOpen && (
                                    <div className="absolute top-full left-0 mt-0.5 bg-popover border border-border rounded shadow-lg z-50 min-w-[120px] py-0.5">
                                        <button onClick={() => { onAliasChange?.(dim.dimension, null); setAliasOpen(false) }}
                                            className={cn('w-full text-left px-2.5 py-1 text-[10px] hover:bg-muted', !activeAlias && 'text-primary')}>None</button>
                                        {aliasAttrs.map(a => (
                                            <button key={a.name} onClick={() => { onAliasChange?.(dim.dimension, a.name); setAliasOpen(false) }}
                                                className={cn('w-full text-left px-2.5 py-1 text-[10px] hover:bg-muted font-mono', activeAlias === a.name && 'text-amber-400')}>
                                                {a.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {zone !== 'bench' && (<>
                            <button
                                onClick={e => { e.stopPropagation(); onMoveLeft?.() }}
                                disabled={!onMoveLeft}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground disabled:opacity-0 p-0.5 rounded"
                                title="Move left"
                            >
                                <ChevronLeft size={10} />
                            </button>
                            <button
                                onClick={e => { e.stopPropagation(); onMoveRight?.() }}
                                disabled={!onMoveRight}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground disabled:opacity-0 p-0.5 rounded"
                                title="Move right"
                            >
                                <ChevronRight size={10} />
                            </button>
                            <button onClick={() => onRemove(dim.dimension)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-0.5 rounded">
                                <X size={10} />
                            </button>
                        </>)}
                        <button
                            onClick={e => { e.stopPropagation(); openTab({ id: `dimension:${server}:${dim.dimension}`, type: 'dimension', label: dim.dimension, server, dimension: dim.dimension }) }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary p-0.5 rounded"
                            title="Open in Dimension Editor"
                        >
                            <PencilLine size={10} />
                        </button>
                    </div>
                </div>
            </div>

            {open && (
                <SubsetPopover
                    server={server} dim={dim} zone={zone} subsets={subsets}
                    onSubsetSelect={name => onSubsetChange(dim.dimension, name)}
                    onMemberSelect={name => onMemberChange(dim.dimension, name)}
                    onMembersSelect={members => onMembersChange?.(dim.dimension, members)}
                    onMemberSetSelect={mset => onMemberSetChange?.(dim.dimension, mset)}
                    onEditSubset={onEditSubset}
                    onBuildSubset={onBuildSubset ? () => { setOpen(false); onBuildSubset(dim.dimension) } : null}
                    onClose={() => setOpen(false)}
                />
            )}
        </div>
    )
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({ id, label, icon: Icon, dims, server, onRemove, onSubsetChange, onMemberChange, onMembersChange, onMemberSetChange, onReorder, accent, dimAliases, onAliasChange, onBuildSubset }) {
    const { setNodeRef, isOver } = useDroppable({ id })
    return (
        <div ref={setNodeRef}
            className={cn('flex flex-col gap-1 min-h-[52px] rounded border p-1.5 transition-colors',
                isOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/20'
            )}
        >
            <div className={cn('flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider mb-0.5', accent)}>
                <Icon size={10} /> {label}
            </div>
            <div className="flex flex-wrap gap-1">
                {dims.map((d, i) => (
                    <DimPill key={d.dimension} id={d.dimension} dim={d} zone={id}
                        server={server} onRemove={onRemove}
                        onSubsetChange={onSubsetChange} onMemberChange={onMemberChange} onMembersChange={onMembersChange} onMemberSetChange={onMemberSetChange}
                        onMoveLeft={i > 0 ? () => onReorder(i, i - 1) : null}
                        onMoveRight={i < dims.length - 1 ? () => onReorder(i, i + 1) : null}
                        activeAlias={dimAliases?.[d.dimension]} onAliasChange={onAliasChange}
                        onBuildSubset={onBuildSubset}
                    />
                ))}
                {dims.length === 0 && (
                    <span className="text-[10px] text-muted-foreground/40 italic px-1">Drop here</span>
                )}
            </div>
        </div>
    )
}

// ── Rule breakdown component ──────────────────────────────────────────────────

function RuleBreakdown({ server, statements, dimElemPairs, cube, onDrill }) {
    const [attrValues,   setAttrValues]   = useState({})
    const [loadingAttrs, setLoadingAttrs] = useState(false)
    const token = typeof window !== 'undefined' ? localStorage.getItem('tm1-token') ?? '' : ''

    const allCalls = useMemo(() => statements.flatMap(s => extractRuleCalls(s)), [statements])

    useEffect(() => {
        const attrCalls = allCalls.filter(c => c.funcName === 'ATTRN' || c.funcName === 'ATTRS')
        if (!attrCalls.length) return
        const toFetch = new Map()
        for (const call of attrCalls) {
            const args = splitArgs(call.argsStr)
            if (args.length < 2) continue
            const dim  = resolveArg(args[0], dimElemPairs)
            const elem = resolveArg(args[1], dimElemPairs)
            const key  = `${dim}::${elem}`
            if (!toFetch.has(key)) toFetch.set(key, { dim, elem })
        }
        if (!toFetch.size) return
        setLoadingAttrs(true)
        Promise.all([...toFetch.entries()].map(([key, { dim, elem }]) =>
            fetch(`/api/element/attributes?server=${encodeURIComponent(server)}&dimension=${encodeURIComponent(dim)}&element=${encodeURIComponent(elem)}`, {
                headers: { 'x-ide-token': token },
            }).then(r => r.json()).then(v => [key, v]).catch(() => [key, {}])
        )).then(results => {
            const map = {}
            for (const [key, vals] of results) map[key] = vals
            setAttrValues(map)
            setLoadingAttrs(false)
        })
    }, [allCalls, server, dimElemPairs]) // eslint-disable-line

    // Resolve an ATTRS('Dim', elem, 'Attr') expression to its fetched attribute
    // value; element arg may be a quoted name, a !Dim ref, or another expr.
    const attrArgRx = /^ATTRS\(\s*'([^']+)'\s*,\s*([^,]+)\s*,\s*'([^']+)'\s*\)$/i
    const resolveAttrArg = (arg) => {
        const m = arg.match(attrArgRx)
        if (!m) return null
        const elem = resolveArg(m[2].trim(), dimElemPairs)
        const value = attrValues[`${m[1]}::${elem}`]?.[m[3]]
        return value != null ? { value: String(value), source: arg } : null
    }

    // Cache for fetched cell values (DB targets + relative refs) and cube dims.
    const valCache = useRef({})
    const dimCache = useRef({})
    const [, bumpVal] = useReducer(x => x + 1, 0)

    const fetchCellValue = useCallback(async (targetCube, pairs) => {
        const key = `${targetCube}::${pairs.map(p => p.element).join('|')}`
        if (valCache.current[key] !== undefined) return valCache.current[key]
        try {
            const res = await fetch('/api/cube/trace', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-ide-token': token },
                body: JSON.stringify({ server, cube: targetCube, dimElemPairs: pairs }),
            })
            const d = await res.json()
            valCache.current[key] = d?.Value
            bumpVal()
            return d?.Value
        } catch { return undefined }
    }, [server, token])

    const getCubeDims = useCallback(async (cubeName) => {
        if (dimCache.current[cubeName]) return dimCache.current[cubeName]
        try {
            const r = await fetch(`/api/cube/dimensions?server=${encodeURIComponent(server)}&cube=${encodeURIComponent(cubeName)}`, {
                headers: { 'x-ide-token': token },
            })
            const dims = await r.json()
            dimCache.current[cubeName] = dims
            return dims
        } catch { return [] }
    }, [server, token])

    // Re-parse statements into a fetchable operand list whenever they change.
    const operandPlan = useMemo(() => {
        const plan = []
        for (const stmt of statements) {
            // LHS element of the assignment (e.g. 'Employer Pension') — used to
            // resolve relative ['Base'] refs (swap the same dim's element).
            const lhs = stmt.match(/\[\s*['"]([^'"]+)['"]\s*\]\s*=/)?.[1] ?? null
            const rhs = rhsOf(stmt)
            // Collect DB(...) / ATTRS(...) / ['Elem'] operands that need a value
            const visit = (expr) => {
                const s = expr.trim()
                const ifm = s.match(/^IF\s*\(/i)
                if (ifm) {
                    const open = s.indexOf('(')
                    const close = matchingCloseParen(s, open)
                    for (const arg of splitArgs(s.slice(open + 1, close))) visit(arg)
                    return
                }
                if (s.startsWith('[')) { plan.push({ kind: 'ref', element: (s.match(/\[['"]([^'"]+)['"]\]/) ?? [])[1] ?? s, lhs }); return }
                if (/^DB\s*\(/i.test(s)) { plan.push({ kind: 'db', text: s, lhs }); return }
                const parts = splitTopLevelOps(s)
                if (parts.length <= 1) return  // leaf — no operators to split, stop (else infinite recursion)
                for (const t of parts) if (t.type === 'operand') visit(t.value)
            }
            visit(rhs)
        }
        return plan
    }, [statements])

    // Resolve a relative ['Elem'] ref: swap the element on the dimension that
    // currently holds the LHS measure element (fallback: last dimension).
    const relativeRefPairs = useCallback((refElement, lhsElement) => {
        const idx = dimElemPairs.findIndex(p => p.element === lhsElement)
        const target = idx >= 0 ? idx : dimElemPairs.length - 1
        return dimElemPairs.map((p, i) => i === target ? { dim: p.dim, element: refElement } : p)
    }, [dimElemPairs])

    // Fetch the values for DB targets and relative refs. Re-runs when attribute
    // values arrive so DB() coordinates that use ATTRS() resolve to real names
    // (the first pass uses raw ATTRS text and its cache keys never match).
    useEffect(() => {
        (async () => {
            for (const op of operandPlan) {
                if (op.kind === 'db') {
                    const inner = op.text.slice(op.text.indexOf('(') + 1, op.text.lastIndexOf(')'))
                    const args = splitArgs(inner)
                    const cubeName = (args[0] ?? '').replace(/^['"]|['"]$/g, '')
                    const coords = args.slice(1).map(a => resolveAttrArg(a) ?? resolveArg(a, dimElemPairs))
                    const dims = await getCubeDims(cubeName)
                    const pairs = dims.map((d, i) => ({ dim: d, element: coords[i] })).filter(p => p.element)
                    await fetchCellValue(cubeName, pairs)
                } else if (op.kind === 'ref') {
                    await fetchCellValue(cube, relativeRefPairs(op.element, op.lhs))
                }
            }
        })()
    }, [operandPlan, getCubeDims, fetchCellValue, relativeRefPairs, attrValues, loadingAttrs]) // eslint-disable-line

    // ── Rendering ──────────────────────────────────────────────────────────────

    const renderOperand = (expr, lhs) => {
        const s = expr.trim()
        const dbm = s.match(/^DB\s*\(/i)
        if (dbm) {
            const inner = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'))
            const args = splitArgs(inner)
            const cubeName = (args[0] ?? '').replace(/^['"]|['"]$/g, '')
            const resolvedOps = args.slice(1).map(a => {
                const r = resolveAttrArg(a)
                return r ? { value: r.value, source: r.source } : { value: resolveArg(a, dimElemPairs), source: null }
            })
            const coords   = resolvedOps.map(r => r.value)
            const derived  = resolvedOps.map(r => r.source ? { value: r.value, source: r.source } : null)
            const key = `${cubeName}::${coords.join('|')}`
            const value = valCache.current[key]
            const dims = dimCache.current[cubeName] ?? []
            // Last dimension is the measure in this model — mark it
            const measureIdx = dims.length - 1
            const drillable = onDrill && coords.length > 0 && coords.every(c => c && !c.includes('('))
            return (
                <div
                    onClick={drillable ? () => onDrill(cubeName, coords, derived) : undefined}
                    className={cn('border border-amber-500/20 bg-amber-500/5 rounded px-3 py-2 space-y-1 transition-colors',
                        drillable && 'cursor-pointer hover:bg-amber-500/10')}
                >
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="badge bg-amber-500/20 text-amber-400 font-mono">DB</span>
                        <span className="text-[11px] font-medium">{cubeName}</span>
                        <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">{value ?? (valCache.current[key] === undefined ? '…' : '—')}</span>
                        {drillable && <ChevronRight size={10} className="text-muted-foreground/50 shrink-0" />}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground flex items-center gap-1 flex-wrap">
                        {coords.map((c, i) => (
                            <span key={i} className={cn(i === measureIdx && 'text-foreground font-semibold')}>
                                {i > 0 && <span className="text-muted-foreground/50 mr-1">·</span>}{c}
                            </span>
                        ))}
                        {measureIdx >= 0 && coords[measureIdx] && (
                            <span className="badge bg-muted text-muted-foreground ml-1">measure</span>
                        )}
                    </div>
                </div>
            )
        }
        const am = s.match(/^ATTRS\s*\(/i)
        if (am) {
            const inner = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'))
            const args = splitArgs(inner)
            const dim  = resolveArg(args[0] ?? '', dimElemPairs)
            const elem = resolveArg(args[1] ?? '', dimElemPairs)
            const attr = (args[2] ?? '').replace(/^['"]|['"]$/g, '')
            const value = attrValues[`${dim}::${elem}`]?.[attr] ?? (loadingAttrs ? '…' : '—')
            return (
                <div className="border border-blue-500/20 bg-blue-500/5 rounded px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="badge bg-blue-500/20 text-blue-400 font-mono">ATTRS</span>
                        <span className="text-[11px] font-medium">{dim}</span>
                        <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">{value}</span>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">{elem} · {attr}</div>
                </div>
            )
        }
        const rm = s.match(/^\[['"]?([^'"\]]+)['"]?\]$/)
        if (rm) {
            const pairs = relativeRefPairs(rm[1], lhs)
            const key = `${cube}::${pairs.map(p => p.element).join('|')}`
            const value = key ? valCache.current[key] : undefined
            return (
                <div className="border border-border/50 bg-muted/20 rounded px-3 py-2">
                    <div className="flex items-center gap-2">
                        <span className="badge bg-muted text-muted-foreground font-mono text-[9px]">ref</span>
                        <span className="font-mono text-[11px] font-medium">[{rm[1]}]</span>
                        <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">{value ?? (valCache.current[key] === undefined ? '…' : '—')}</span>
                    </div>
                </div>
            )
        }
        const num = Number(s.replace(/[(),]/g, ''))
        if (!Number.isNaN(num) && s.trim() !== '') {
            return <div className="border border-border/50 bg-muted/20 rounded px-3 py-2"><span className="font-mono text-[11px] font-semibold tabular-nums">{s.trim()}</span></div>
        }
        return <div className="border border-border/50 bg-muted/20 rounded px-3 py-2"><span className="font-mono text-[10px] text-muted-foreground">{s}</span></div>
    }

    const renderExpr = (expr, lhs) => {
        const s = expr.trim()
        const ifm = s.match(/^IF\s*\(/i)
        if (ifm) {
            const open = s.indexOf('(')
            const close = matchingCloseParen(s, open)
            const args = splitArgs(s.slice(open + 1, close))
            return (
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="badge bg-amber-500/20 text-amber-400 font-mono text-[9px]">IF</span>
                        <span className="text-[10px] text-muted-foreground">condition</span>
                    </div>
                    <div className="pl-3">{renderExpr(args[0] ?? '', lhs)}</div>
                    <div className="flex items-center gap-2">
                        <span className="badge bg-emerald-500/20 text-emerald-400 font-mono text-[9px]">THEN</span>
                    </div>
                    <div className="pl-3">{renderExpr(args[1] ?? '', lhs)}</div>
                    <div className="flex items-center gap-2">
                        <span className="badge bg-purple-500/20 text-purple-400 font-mono text-[9px]">ELSE</span>
                    </div>
                    <div className="pl-3">{renderExpr(args[2] ?? '', lhs)}</div>
                </div>
            )
        }
        // Comparison (e.g. ATTRS(...) @= 'Contractor') → show both sides
        const cmp = splitComparison(s)
        if (cmp) {
            return (
                <div className="flex items-center gap-2 flex-wrap">
                    <div>{renderExpr(cmp[0], lhs)}</div>
                    <span className="font-mono text-[11px] text-muted-foreground font-semibold">{cmp[1]}</span>
                    <div>{renderOperand(cmp[2], lhs)}</div>
                </div>
            )
        }
        const parts = splitTopLevelOps(s)
        if (parts.length === 1) return renderOperand(parts[0].value, lhs)
        return (
            <div className="flex items-stretch gap-2 flex-wrap">
                {parts.map((t, i) => t.type === 'op'
                    ? <span key={i} className="self-center font-mono text-[12px] text-muted-foreground font-semibold">{t.value}</span>
                    : <div key={i}>{renderOperand(t.value, lhs)}</div>
                )}
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {statements.map((s, i) => (
                <div key={i} className="space-y-2">
                    <div className="font-mono text-[11px] bg-muted/50 rounded px-3 py-2 break-all whitespace-pre-wrap leading-relaxed">
                        {s}
                    </div>
                    <div className="pl-1">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Expression</div>
                        {renderExpr(rhsOf(s), (s.match(/\[\s*['"]([^'"]+)['"]\s*\]\s*=/) ?? [])[1] ?? null)}
                    </div>
                </div>
            ))}
        </div>
    )
}

// ── Trace side panel ──────────────────────────────────────────────────────────

function TypeBadgeTrace({ type }) {
    const t = type?.toLowerCase() ?? ''
    if (t.includes('rule'))   return <span className="badge bg-amber-500/20 text-amber-400">RULE</span>
    if (t.includes('consol')) return <span className="badge bg-purple-500/20 text-purple-400">CONSOLIDATED</span>
    if (t.includes('feed'))   return <span className="badge bg-blue-500/20 text-blue-400">FEEDER</span>
    if (t.includes('base') || t === 'leaf') return <span className="badge bg-emerald-500/20 text-emerald-400">BASE</span>
    if (type) return <span className="badge bg-muted text-muted-foreground">{type.toUpperCase()}</span>
    return null
}

function useTraceData(server, cube, dimElemPairs) {
    const [data,  setData]  = useState(null)
    const [error, setError] = useState(null)
    const [busy,  setBusy]  = useState(true)
    const key = JSON.stringify({ server, cube, dimElemPairs })

    useEffect(() => {
        setBusy(true); setError(null); setData(null)
        const token = localStorage.getItem('tm1-token') ?? ''
        fetch('/api/cube/trace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-ide-token': token },
            body: JSON.stringify({ server, cube, dimElemPairs }),
        })
            .then(r => r.json())
            .then(d => { setBusy(false); d.error ? setError(d.error) : setData(d) })
            .catch(e => { setBusy(false); setError(e.message) })
    }, [key])  // eslint-disable-line

    return { data, error, busy }
}

function TraceSidePanel({ ctx, onClose }) {
    const [stack, setStack] = useState([{
        cube:         ctx.cube,
        dimElemPairs: ctx.dimElemPairs,
        label:        ctx.dimElemPairs.map(p => p.element).join(' · '),
    }])

    const current = stack[stack.length - 1]
    const { data, error, busy } = useTraceData(ctx.server, current.cube, current.dimElemPairs)
    // Dimension order for the CUBE CURRENTLY ON THE STACK (not just the original
    // cube) — needed to build coordinates when drilling, including cross-cube.
    const { data: stackCubeDims = [] } = useCubeDimensions(ctx.server, current.cube)

    const stmts = data?.Statements ?? []
    const comps = data?.Components ?? []

    const canDrill = (comp) => {
        const t = comp.Type?.toLowerCase() ?? ''
        return (comp.Tuple ?? []).length > 0 && (t.includes('consol') || t.includes('rule') || t.includes('base'))
    }

    // Drill to a cell in `targetCube` given its element coordinates (in the
    // cube's dimension order). Cross-cube cubes fetch their dimensions on demand.
    // `derived` (parallel to elements) records which coordinates were resolved
    // from ATTRS() lookups, so the drilled frame shows their provenance.
    const drillTo = async (targetCube, elements, derived = null) => {
        let dims
        if (targetCube === current.cube) {
            dims = stackCubeDims
        } else {
            try {
                const res = await fetch(`/api/cube/dimensions?server=${encodeURIComponent(ctx.server)}&cube=${encodeURIComponent(targetCube)}`, {
                    headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' },
                })
                dims = await res.json()
            } catch { dims = [] }
        }
        if (!dims?.length) return
        const newPairs = dims.map((d, i) => ({ dim: d, element: elements[i], derived: derived?.[i] ?? null })).filter(p => p.element)
        if (!newPairs.length) return
        setStack(s => [...s, { cube: targetCube, dimElemPairs: newPairs, derived: derived ?? [], label: elements.filter(Boolean).join(' · ') }])
    }

    const drillInto = (comp) => drillTo(comp.Cube?.Name ?? current.cube, (comp.Tuple ?? []).map(t => t.Name))

    const goBack = () => setStack(s => s.slice(0, -1))

    return (
        <div
            style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, zIndex: 9000 }}
            className="bg-popover border-l border-border shadow-2xl flex flex-col"
        >
            {/* Header */}
            <div className="px-4 py-3 border-b border-border bg-muted/30 shrink-0 space-y-1.5">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold flex-1">{current.cube}</span>
                    {data && <TypeBadgeTrace type={data.Type} />}
                    {data?.Value != null && (
                        <span className="font-mono text-xs font-semibold tabular-nums">{data.Value}</span>
                    )}
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-1">
                        <X size={14} />
                    </button>
                </div>
                {/* Breadcrumb */}
                <div className="flex items-center gap-1 flex-wrap">
                    {stack.map((s, i) => (
                        <span key={i} className="flex items-center gap-1">
                            {i > 0 && <ChevronRight size={10} className="text-muted-foreground/50 shrink-0" />}
                            <button
                                onClick={() => i < stack.length - 1 && setStack(st => st.slice(0, i + 1))}
                                className={cn('text-[10px] truncate max-w-[120px]',
                                    i === stack.length - 1
                                        ? 'text-foreground font-medium'
                                        : 'text-muted-foreground hover:text-foreground'
                                )}
                                title={s.label}
                            >
                                {s.label}
                            </button>
                        </span>
                    ))}
                </div>
                {stack.length > 1 && (
                    <button
                        onClick={goBack}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ChevronLeft size={10} /> Back
                    </button>
                )}
                {/* Provenance: which coordinates were derived from ATTRS() lookups */}
                {(current.derived ?? []).filter(Boolean).length > 0 && (
                    <div className="space-y-0.5 pt-1 border-t border-border/40">
                        <div className="text-[9px] uppercase tracking-wide text-muted-foreground/60 font-medium">
                            Mapped from attributes
                        </div>
                        {(current.derived ?? []).filter(Boolean).map((d, i) => (
                            <div key={i} className="font-mono text-[10px] text-muted-foreground">
                                <span className="text-foreground font-medium">{d.value}</span>
                                {' ← '}
                                {d.source}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Body */}
            <TraceErrorBoundary>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                {busy && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 size={12} className="animate-spin" /> Tracing…
                    </div>
                )}
                {error && <div className="text-red-400">{error}</div>}

                {stmts.length > 0 && (
                    <RuleBreakdown
                        server={ctx.server}
                        statements={stmts}
                        dimElemPairs={current.dimElemPairs}
                        cube={current.cube}
                        onDrill={drillTo}
                    />
                )}

                {stmts.length === 0 && comps.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                            Components ({comps.length})
                        </div>
                        <div className="space-y-1.5">
                            {comps.map((c, i) => {
                                const tuple    = (c.Tuple ?? []).map(t => t.Name).join(' · ')
                                const drillable = canDrill(c)
                                const crossCube = c.Cube?.Name && c.Cube.Name !== ctx.cube
                                return (
                                    <div
                                        key={i}
                                        onClick={() => drillable && drillInto(c)}
                                        className={cn(
                                            'bg-muted/30 border border-border/50 rounded px-3 py-2 space-y-1 transition-colors',
                                            drillable && 'cursor-pointer hover:bg-muted/60 hover:border-border'
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <TypeBadgeTrace type={c.Type} />
                                            {crossCube && (
                                                <span className="text-[10px] text-blue-400 font-medium">{c.Cube.Name}</span>
                                            )}
                                            <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">
                                                {c.Value ?? '—'}
                                            </span>
                                            {drillable && (
                                                <ChevronRight size={10} className="text-muted-foreground/50 shrink-0" />
                                            )}
                                        </div>
                                        {tuple && (
                                            <div className="font-mono text-[10px] text-muted-foreground break-all">{tuple}</div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {!busy && !error && stmts.length === 0 && comps.length === 0 && data && (
                    <div className="text-muted-foreground">No detail available for this cell.</div>
                )}
            </div>
            </TraceErrorBoundary>
        </div>
    )
}

// ── Main ViewEditor ───────────────────────────────────────────────────────────

export default function ViewEditor({ tab }) {
    const { dark, openTab, patchTab } = useStore()
    const app = useGridAppearance()
    const rulesVersion = useStore(s => s.rulesVersions[`${tab.server}::${tab.cube}`] ?? 0)
    const { data: cubeDims = [] } = useCubeDimensions(tab.server, tab.cube)
    const { data: views    = [] } = useViews(tab.server, tab.cube)
    const executeMDX   = useExecuteMDX()
    const loadViewAxes = useViewAxes()
    const saveView     = useSaveView()
    const setDefault   = useSetDefaultView()
    const generateViewMDX = useGenerateViewMDX()

    // Visual builder state — seed from Builder handoff if provided
    // Use savedAxes to survive tab-switch remounts
    const [axes, setAxes] = useState(tab.savedAxes ?? tab.initialAxes ?? { rows: [], columns: [], pages: [] })
    const [benchState, setBenchState] = useState({}) // persists member/subset for benched dims
    const [suppressZeros, setSuppressZeros] = useState('rows')
    const [totalsPosition,    setTotalsPosition]    = useState('top')
    const [colTotalsPosition, setColTotalsPosition] = useState('top')
    const [activeDrag, setActiveDrag] = useState(null)

    // Flat (fallback) grid state — search + freeze + persisted widths
    const flatGridRef = useRef(null)
    const flatStorageKey = tab.server && tab.cube ? `ve-flat::${tab.server}::${tab.cube}::${tab.viewName || 'adhoc'}` : undefined
    const [flatQuickFilter, setFlatQuickFilter] = useState('')
    const [flatFreezeTop, setFlatFreezeTop] = useState(false)
    const [flatMode, setFlatMode] = useState(false)
    const flatSavedWidthsRef = useRef(null)
    if (flatSavedWidthsRef.current === null) {
        flatSavedWidthsRef.current = flatStorageKey
            ? (() => { try { return JSON.parse(localStorage.getItem(flatStorageKey) || '{}') } catch { return {} } })()
            : {}
    }
    const handleFlatSearch = useCallback((text) => {
        setFlatQuickFilter(text)
        if (text) setFlatFreezeTop(false)
    }, [])

    // Save axes to tab store on unmount so tab-switch preserves changes
    const axesRef = useRef(axes); axesRef.current = axes
    useEffect(() => () => patchTab(tab.id, { savedAxes: axesRef.current }), [])

    // Totals position — per-user IDE preference (classic native views have no
    // "totals position" property, so this can't ride on the TM1 view itself)
    const totalsPrefKey = `tm1-viewprefs:${tab.server}::${tab.cube}::${tab.viewName ?? '__new__'}`
    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(totalsPrefKey) ?? '{}')
            if (saved.totalsPosition)    setTotalsPosition(saved.totalsPosition)
            if (saved.colTotalsPosition) setColTotalsPosition(saved.colTotalsPosition)
        } catch {}
    }, [totalsPrefKey])
    useEffect(() => {
        try { localStorage.setItem(totalsPrefKey, JSON.stringify({ totalsPosition, colTotalsPosition })) } catch {}
    }, [totalsPrefKey, totalsPosition, colTotalsPosition])

    // MDX editor state — use savedMdx to survive remounts
    const [mdx, setMdx] = useState(tab.savedMdx ?? tab.initialMdx ?? '')
    const mdxRef = useRef(mdx); mdxRef.current = mdx
    useEffect(() => () => patchTab(tab.id, { savedMdx: mdxRef.current }), [])
    const [mdxDirty, setMdxDirty] = useState(false)

    // AI generate — front door for building a view from a description
    const { data: config } = useConfig()
    const hasAnthropicKey = !!config?.hasAnthropicKey
    const [aiPrompt, setAiPrompt] = useState('')
    const handleGenerateAI = useCallback(() => {
        if (!aiPrompt.trim() || generateViewMDX.isPending) return
        generateViewMDX.mutate({ server: tab.server, cube: tab.cube, prompt: aiPrompt }, {
            onSuccess: d => {
                setMdx(d.mdx)
                setMode('mdx')
                setMdxDirty(true)
                toast.success('MDX generated — review, then Save')
            },
            onError: e => toast.error(e.message),
        })
    }, [aiPrompt, generateViewMDX, tab.server, tab.cube])

    // Saved sessions — named local drafts, for experimenting before settling
    // on the final view. State here; handlers live below once `mode` exists.
    const [sessionsOpen, setSessionsOpen]     = useState(false)
    const [sessionName, setSessionName]       = useState('')
    const [sessions, setSessions]             = useState(loadViewSessions)
    const [sessionSavedIndicator, setSessionSavedIndicator] = useState(false)

    const [dimAliases, setDimAliases]         = useState({})
    const [aliasValueMaps, setAliasValueMaps] = useState({})
    const handleAliasChange = useCallback(async (dim, attr) => {
        setDimAliases(prev => ({ ...prev, [dim]: attr || null }))
        if (!attr) return
        const key = `${dim}:${attr}`
        if (aliasValueMaps[key]) return
        try {
            const r = await fetch(`/api/dimension/alias-values?server=${encodeURIComponent(tab.server)}&dimension=${encodeURIComponent(dim)}&alias=${encodeURIComponent(attr)}`, { headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' } })
            if (r.ok) { const map = await r.json(); setAliasValueMaps(prev => ({ ...prev, [key]: map })) }
        } catch {}
    }, [tab.server, aliasValueMaps])

    const [mdxEditorHeight, setMdxEditorHeight] = useState(224)
    const startMdxEditorResize = useCallback((e) => {
        e.preventDefault()
        const startY = e.clientY
        const startH = mdxEditorHeight
        const onMove = (mv) => setMdxEditorHeight(Math.max(80, Math.min(startH + (mv.clientY - startY), 600)))
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }, [mdxEditorHeight])
    const editorRef = useRef(null)

    // Results
    const [result, setResult] = useState(null)
    const [truncated, setTruncated] = useState(false)

    // View type + native/complexity tracking
    const [viewType,          setViewType]          = useState(null)
    const [isOriginallyNative, setIsOriginallyNative] = useState(false)
    const [mdxTooComplex,      setMdxTooComplex]      = useState(null)  // null | string[]

    // View mode: 'visual' | 'mdx'
    const [mode, setMode] = useState(tab.mode ?? (tab.initialMdx ? 'mdx' : 'visual'))
    const [showSaveMenu, setShowSaveMenu] = useState(false)
    const [builderCollapsed, setBuilderCollapsed] = useState(false)
    useEffect(() => { patchTab(tab.id, { mode }) }, [mode])

    // Saved-session handlers — captures whatever's current (visual axes or MDX,
    // whichever mode you're in) so restoring puts you back exactly where you left off.
    const handleSaveSession = useCallback(() => {
        if (!sessionName.trim()) return
        saveViewSessionEntry({ name: sessionName.trim(), cube: tab.cube, mode, mdx, axes })
        setSessions(loadViewSessions())
        setSessionSavedIndicator(true)
        setTimeout(() => setSessionSavedIndicator(false), 2000)
        setSessionName('')
    }, [sessionName, tab.cube, mode, mdx, axes])
    const handleLoadSession = useCallback((s) => {
        if (s.axes) setAxes(s.axes)
        if (s.mdx != null) setMdx(s.mdx)
        setMode(s.mode ?? 'visual')
        setSessionsOpen(false)
        toast.success(`Loaded "${s.name}"`)
    }, [])

    // Used In panel
    const [showUsedIn, setShowUsedIn] = useState(false)

    // Transaction Log panel
    const [showLog,   setShowLog]   = useState(false)
    const [logTuple,  setLogTuple]  = useState(null)   // null = whole cube, array = filtered cell
    const [dismissedId, setDismissedId]   = useState(null)
    const [saveConflict, setSaveConflict] = useState(null)
    const [conflictDiff, setConflictDiff] = useState(null)
    const [cellCtx,  setCellCtx]  = useState(null)
    const [traceCtx, setTraceCtx] = useState(null)
    const [checkingFeeders, setCheckingFeeders] = useState(false)
    const { openConflict, checkBeforeSave } = useConflictCheck(tab.server, 'view', tab.viewName)
    const { data: pawBookData, isFetching: loadingPawBooks, refetch: refetchPawBooks } = usePawBookUsage(tab.server, tab.cube, tab.viewName)
    const { data: usageData,   isFetching: loadingUsage,   refetch: refetchUsage }    = useViewUsage(tab.server, tab.cube, tab.viewName)

    const refetchUsedIn = useCallback(() => { refetchUsage(); refetchPawBooks() }, [refetchUsage, refetchPawBooks])
    const loadingUsedIn = loadingUsage || loadingPawBooks

    // Loading guard using state (not ref) to survive StrictMode remounts
    const [loadedKey, setLoadedKey] = useState(null)

    const bench = useMemo(() => {
        const placed = new Set([...axes.rows, ...axes.columns, ...axes.pages].map(d => d.dimension))
        return cubeDims.filter(d => !placed.has(d)).map(d => ({
            dimension: d,
            ...(benchState[d] ?? { subset: null, member: null }),
        }))
    }, [cubeDims, axes, benchState])

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

    // ── Parse MDX string to visual builder axes ───────────────────────────────
    const parseMdxToAxes = useCallback((mdxText) => {
        const make = (dim, subset = null, member = null) => ({ dimension: dim, subset, member })
        const cols = [], rows = [], pages = []

        // Extract axes part between SELECT and FROM
        const axisMatch = mdxText.match(/SELECT\s+([\s\S]*?)\s+FROM\s+\[/i)
        if (axisMatch) {
            const axesPart = axisMatch[1]

            // Find ordinal positions to split axes without overlap
            const colPos = axesPart.search(/\bON\s+(?:COLUMNS|0)\b/i)
            const rowPos = axesPart.search(/\bON\s+(?:ROWS|1)\b/i)

            let colExpr = null, rowExpr = null
            if (colPos >= 0 && rowPos >= 0) {
                if (colPos < rowPos) {
                    colExpr = axesPart.slice(0, colPos).replace(/,\s*$/, '').trim()
                    const afterCol = axesPart.indexOf(',', colPos)
                    rowExpr = axesPart.slice(afterCol + 1, rowPos).trim()
                } else {
                    rowExpr = axesPart.slice(0, rowPos).replace(/,\s*$/, '').trim()
                    const afterRow = axesPart.indexOf(',', rowPos)
                    colExpr = axesPart.slice(afterRow + 1, colPos).trim()
                }
            } else if (colPos >= 0) {
                colExpr = axesPart.slice(0, colPos).trim()
            } else if (rowPos >= 0) {
                rowExpr = axesPart.slice(0, rowPos).trim()
            }

            const extractSets = (expr) => {
                if (!expr) return []
                const sets = []
                let m
                // TM1SubsetToSet([Dim].[Hier], "Sub") or TM1SubsetToSet([Dim], "Sub")
                const subsetRe = /TM1SubsetToSet\s*\(\s*\[([^\]]+)\](?:\.[^\]]*\])?\s*,\s*"([^"]+)"(?:\s*,\s*"[^"]*")?\s*\)/gi
                while ((m = subsetRe.exec(expr)) !== null) sets.push(make(m[1], m[2]))
                // TM1SUBSETALL([Dim].[Hier])
                const allRe = /TM1SUBSETALL\s*\(\s*\[([^\]]+)\](?:\.[^\]]*\])?\s*\)/gi
                while ((m = allRe.exec(expr)) !== null) sets.push(make(m[1]))
                // [Dim].[Dim].Members or MEMBERS
                const membersRe = /\[([^\]]+)\]\.[^\]]*\]\.Members/gi
                while ((m = membersRe.exec(expr)) !== null) {
                    if (!sets.some(s => s.dimension === m[1])) sets.push(make(m[1]))
                }
                // {[Dim].[Dim].[M1], [Dim].[Dim].[M2], ...} — multi-member set
                const multiRe = /\{\s*(\[[^\]]+\]\.\[[^\]]+\]\.\[[^\]]+\](?:\s*,\s*\[[^\]]+\]\.\[[^\]]+\]\.\[[^\]]+\])*)\s*\}/gi
                while ((m = multiRe.exec(expr)) !== null) {
                    const memberMatches = [...m[1].matchAll(/\[([^\]]+)\]\.\[[^\]]+\]\.\[([^\]]+)\]/g)]
                    if (memberMatches.length > 0) {
                        const dim = memberMatches[0][1]
                        if (!sets.some(s => s.dimension === dim)) {
                            const members = memberMatches.map(mm => mm[2])
                            sets.push(members.length === 1
                                ? make(dim, null, members[0])
                                : { ...make(dim), members })
                        }
                    }
                }
                return sets
            }

            if (colExpr) cols.push(...extractSets(colExpr))
            if (rowExpr) rows.push(...extractSets(rowExpr))
        }

        // Extract WHERE slicers
        const whereMatch = mdxText.match(/WHERE\s*\(([\s\S]*?)\)\s*$/i)
        if (whereMatch) {
            for (const s of whereMatch[1].split(',')) {
                const trimmed = s.trim()
                // [Dim].[Hier].[Member] — specific member
                const m = trimmed.match(/\[([^\]]+)\]\.[^\]]*\]\.\[([^\]]+)\]/)
                if (m) { pages.push(make(m[1], null, m[2])); continue }
                // [Dim].[Hier].DefaultMember — placeholder slicer, keep dim in filter zone with no member
                const dm = trimmed.match(/\[([^\]]+)\]\.[^\]]*\]\.DefaultMember/i)
                if (dm) pages.push(make(dm[1]))
            }
        }

        return { columns: cols, rows, pages }
    }, [])

    // ── Load existing view ──────────────────────────────────────────────────
    useEffect(() => {
        if (!tab.viewName || !cubeDims.length) return
        const key = `${tab.server}:${tab.cube}:${tab.viewName}`
        if (loadedKey === key) return
        setLoadedKey(key)
        setResult(null)
        setTruncated(false)

        loadViewAxes.mutate(
            { server: tab.server, cube: tab.cube, view: tab.viewName },
            {
                onSuccess: ({ axisConfig, cellset, viewType: vt, nativeConfig, mdx: viewMdx }) => {
                    const make = (dim, subset = null, member = null, members = null, memberSet = null) => ({ dimension: dim, subset, member, members, memberSet })
                    let cols, rows, pages

                    if (viewMdx && vt?.includes('MDXView')) {
                        // MDX view — axis PLACEMENT comes from the executed cellset (axisConfig),
                        // which the server derives correctly for any MDX. parseMdxToAxes is only
                        // best-effort enrichment (member lists / named subsets) and is skipped
                        // per-axis when it can't resolve the dims the cellset actually returned.
                        const parsed = parseMdxToAxes(viewMdx)
                        const cfgDims = ord => (axisConfig.find(a => a.ordinal === ord)?.dimensions ?? [])
                        const enrich  = (parsedAxis, ord) => {
                            const dims = cfgDims(ord)
                            if (!dims.length) return parsedAxis
                            return dims.map(d => parsedAxis.find(p => p.dimension === d) ?? make(d))
                        }
                        cols  = enrich(parsed.columns, 0)
                        rows  = enrich(parsed.rows, 1)
                        pages = parsed.pages.length
                            ? parsed.pages
                            : (axisConfig.find(a => a.ordinal === 2)?.selectedMembers ?? []).map(({ dimension, member }) => make(dimension, null, member))
                    } else if (nativeConfig) {
                        // Native view — use native definition with actual subsets
                        cols  = nativeConfig.columns.map(c => make(c.dimension, c.subset, null, c.members ?? null, c.memberSet ?? null))
                        rows  = nativeConfig.rows.map(r => make(r.dimension, r.subset, null, r.members ?? null, r.memberSet ?? null))
                        pages = nativeConfig.titles.map(t => make(t.dimension, null, t.member))
                        // Restore persisted suppression (real SuppressEmptyRows/Columns on the native view)
                        setSuppressZeros(
                            nativeConfig.suppressEmptyRows && nativeConfig.suppressEmptyColumns ? 'all'
                            : nativeConfig.suppressEmptyRows    ? 'rows'
                            : nativeConfig.suppressEmptyColumns ? 'columns'
                            : 'none'
                        )
                    } else {
                        // Fallback to cellset axes
                        cols  = (axisConfig.find(a => a.ordinal === 0)?.dimensions ?? []).map(d => make(d))
                        rows  = (axisConfig.find(a => a.ordinal === 1)?.dimensions ?? []).map(d => make(d))
                        pages = (axisConfig.find(a => a.ordinal === 2)?.selectedMembers ?? []).map(({ dimension, member }) => make(dimension, null, member))
                    }
                    if (!cols.length && cubeDims.length) cols = [make(cubeDims[0])]
                    if (!rows.length && cubeDims.length > 1) rows = [make(cubeDims[1])]
                    setAxes({ rows, columns: cols, pages })
                    setResult(cellset)
                    setTruncated(cellset?.truncated ?? false)
                    setViewType(vt ?? null)
                    patchTab(tab.id, { viewType: vt ?? null })
                    const isNative = vt?.includes('NativeView') ?? false
                    const complex  = viewMdx ? detectComplexMDX(viewMdx) : null
                    setIsOriginallyNative(isNative)
                    setMdxTooComplex(complex)
                    // Lock to MDX mode when complex expressions are present
                    if (viewMdx && (complex || vt?.includes('MDXView'))) setMode('mdx')
                    setMdx(viewMdx || buildMDX({ cube: tab.cube, rows, columns: cols, pages, suppressZeros: 'none' }))
                    setMdxDirty(false)
                },
                onError: e => {
                    setLoadedKey(null)
                    if (tab.viewName !== 'Default') toast.error(e.message)
                },
            }
        )
    }, [tab.viewName, cubeDims, parseMdxToAxes])

    // ── Default layout for new cube view (no viewName) ──────────────────────
    useEffect(() => {
        if (tab.viewName || !cubeDims.length || axes.columns.length || axes.rows.length) return
        const make = dim => ({ dimension: dim, subset: null, member: null })
        setAxes({
            columns: cubeDims.slice(0, 1).map(make),
            rows:    cubeDims.slice(1, 2).map(make),
            pages:   [],
        })
    }, [cubeDims])

    const findZone = (dimName) => {
        for (const zone of ['rows', 'columns', 'pages']) {
            if (axes[zone].find(d => d.dimension === dimName)) return zone
        }
        return 'bench'
    }

    const reorderDim = useCallback((zone, fromIdx, toIdx) => {
        setAxes(prev => {
            const arr = [...prev[zone]]
            const [item] = arr.splice(fromIdx, 1)
            arr.splice(toIdx, 0, item)
            return { ...prev, [zone]: arr }
        })
    }, [])

    const handleDragEnd = ({ active, over }) => {
        setActiveDrag(null)
        if (!over) return
        const dimName = active.id
        const overId  = over.id
        if (overId === `dim:${dimName}`) return

        let toZone, insertBeforeDim = null
        if (overId.startsWith('dim:')) {
            insertBeforeDim = overId.slice(4)
            toZone = findZone(insertBeforeDim)
        } else {
            if (!['rows', 'columns', 'pages', 'bench'].includes(overId)) return
            toZone = overId
        }

        const existing = [...axes.rows, ...axes.columns, ...axes.pages, ...bench]
            .find(d => d.dimension === dimName) ?? { dimension: dimName, subset: null, member: null }

        if (toZone === 'bench') {
            // Preserve member/subset so it's remembered if moved back
            setBenchState(prev => ({ ...prev, [dimName]: { subset: existing.subset ?? null, member: existing.member ?? null, members: existing.members ?? null, memberSet: existing.memberSet ?? null } }))
            setAxes(prev => ({
                rows:    prev.rows.filter(d => d.dimension !== dimName),
                columns: prev.columns.filter(d => d.dimension !== dimName),
                pages:   prev.pages.filter(d => d.dimension !== dimName),
            }))
            return
        }

        // Moving to an active zone — clear saved bench state for this dim
        setBenchState(prev => { const n = { ...prev }; delete n[dimName]; return n })
        setAxes(prev => {
            const next = {
                rows:    prev.rows.filter(d => d.dimension !== dimName),
                columns: prev.columns.filter(d => d.dimension !== dimName),
                pages:   prev.pages.filter(d => d.dimension !== dimName),
            }
            if (insertBeforeDim) {
                const idx = next[toZone].findIndex(d => d.dimension === insertBeforeDim)
                next[toZone] = idx >= 0
                    ? [...next[toZone].slice(0, idx), existing, ...next[toZone].slice(idx)]
                    : [...next[toZone], existing]
            } else {
                next[toZone] = [...next[toZone], existing]
            }
            return next
        })
    }

    const removeDim = useCallback((dimName) => {
        setAxes(prev => ({
            rows:    prev.rows.filter(d => d.dimension !== dimName),
            columns: prev.columns.filter(d => d.dimension !== dimName),
            pages:   prev.pages.filter(d => d.dimension !== dimName),
        }))
    }, [])

    const setSubset = useCallback((dimName, subset) => {
        setAxes(prev => {
            const update = zone => zone.map(d => d.dimension === dimName ? { ...d, subset, member: null, members: null, memberSet: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const setMember = useCallback((dimName, member) => {
        setAxes(prev => {
            const update = zone => zone.map(d => d.dimension === dimName ? { ...d, member, members: null, memberSet: null, subset: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const setMembers = useCallback((dimName, members) => {
        setAxes(prev => {
            const update = zone => zone.map(d => d.dimension === dimName ? { ...d, members, member: null, subset: null, memberSet: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const setMemberSet = useCallback((dimName, memberSet) => {
        setAxes(prev => {
            const update = zone => zone.map(d => d.dimension === dimName ? { ...d, memberSet, subset: null, member: null, members: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const setCustomExpr = useCallback((dimName, customExpr) => {
        setAxes(prev => {
            const update = zone => zone.map(d => d.dimension === dimName ? { ...d, customExpr, subset: null, member: null, members: null, memberSet: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const handleBuildSubset = useCallback((dimName) => {
        const tabId = `subset-filter:${tab.server}:${dimName}:${Date.now()}`
        const existing = [...axes.rows, ...axes.columns, ...axes.pages].find(d => d.dimension === dimName)
        subsetApplyCallbacks.set(tabId, (mdxExpr) => setCustomExpr(dimName, mdxExpr))
        openTab({ id: tabId, type: 'subset', label: `Build: ${dimName}`, server: tab.server, dimension: dimName, subsetName: null, mdx: existing?.customExpr ?? '', returnTabId: tab.id })
    }, [tab.server, tab.id, axes, openTab, setCustomExpr])

    const handleExecute = useCallback((opts = {}) => {
        const sz    = 'suppressZeros' in opts ? opts.suppressZeros : suppressZeros
        const query = mode === 'mdx' ? mdx : buildMDX({ cube: tab.cube, ...axes, bench, suppressZeros: sz })
        if (!query.trim()) {
            toast.error('No MDX to execute')
            return
        }
        const id = toast.loading('Executing…')
        executeMDX.mutate(
            { server: tab.server, mdx: query },
            {
                onSuccess: data => {
                    setResult(data)
                    setTruncated(data?.truncated ?? false)
                    if ('suppressZeros' in opts) setSuppressZeros(sz)
                    toast.success('Done', { id })
                },
                onError:   e    => toast.error(e.message, { id }),
            }
        )
    }, [mode, mdx, axes, suppressZeros, tab.server, tab.cube])

    // ── Auto-execute default layout once ────────────────────────────────────
    const [autoExecuted, setAutoExecuted] = useState(false)
    useEffect(() => {
        if (tab.viewName || autoExecuted || !axes.columns.length || result !== null) return
        setAutoExecuted(true)
        handleExecute()
    }, [axes, autoExecuted, tab.viewName, result, handleExecute])

    // Sync MDX when visual axes change (if in visual mode)
    const isFirstAxesRender = useRef(true)
    useEffect(() => {
        if (mode !== 'visual') return
        setMdx(buildMDX({ cube: tab.cube, ...axes, bench, suppressZeros }))
        setMdxDirty(false)

        // Auto-execute after axes settle (skip initial mount)
        if (isFirstAxesRender.current) { isFirstAxesRender.current = false; return }
        if (!axes.columns.length && !axes.rows.length) return
        const t = setTimeout(() => handleExecute(), 800)
        return () => clearTimeout(t)
    }, [axes, mode])

    // Auto-refresh when rules for this cube are saved
    const prevRulesVersion = useRef(rulesVersion)
    useEffect(() => {
        if (rulesVersion === prevRulesVersion.current) return
        prevRulesVersion.current = rulesVersion
        if (result !== null) handleExecute()
    }, [rulesVersion])

    // When switching to MDX mode, mark dirty so save is enabled
    const prevModeRef = useRef(mode)
    useEffect(() => {
        if (prevModeRef.current === 'visual' && mode === 'mdx') {
            setMdxDirty(true)
        } else if (prevModeRef.current === 'mdx' && mode === 'visual') {
            // Sync visual axes from whatever is currently in the MDX editor
            if (mdx.trim()) {
                const parsed = parseMdxToAxes(mdx)
                if (parsed.rows.length || parsed.columns.length || parsed.pages.length) {
                    setAxes(parsed)
                }
            }
        }
        prevModeRef.current = mode
    }, [mode, mdx, parseMdxToAxes])

    const buildSavePayload = useCallback(() => {
        if (mode === 'visual') {
            return { nativeAxes: {
                rows: axes.rows, columns: axes.columns, titles: axes.pages,
                suppressEmptyRows:    suppressZeros === 'rows'    || suppressZeros === 'all',
                suppressEmptyColumns: suppressZeros === 'columns' || suppressZeros === 'all',
            } }
        }
        return { mdx: mdx }
    }, [mode, mdx, axes, suppressZeros])

    const executeSave = useCallback((name) => {
        if (isOriginallyNative && mode === 'mdx') {
            if (!window.confirm('Saving in MDX mode will convert this Native view to MDX. This affects PAX and Architect users.\n\nContinue?')) return
        }
        const id = toast.loading('Saving view…')
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name, ...buildSavePayload() },
            {
                onSuccess: () => { setMdxDirty(false); toast.success(`Saved "${name}"`, { id }) },
                onError:   e => toast.error(e.message, { id }),
            }
        )
    }, [isOriginallyNative, mode, buildSavePayload, tab.server, tab.cube, saveView])

    const handleSave = useCallback(async () => {
        const name = tab.viewName ?? prompt('View name?')
        if (!name) return
        if (tab.viewName) {
            const conflict = await checkBeforeSave()
            if (conflict) { setSaveConflict(conflict); return }
        }
        executeSave(name)
    }, [tab.viewName, checkBeforeSave, executeSave])

    const handleSaveAsNative = useCallback(() => {
        const name = prompt('Save as native view…')
        if (!name) return
        const parsed = parseMdxToAxes(mdx)
        if (!parsed.columns.length && !parsed.rows.length) { toast.error('Could not parse MDX axes — switch to Visual mode and arrange dimensions first'); return }
        const id = toast.loading('Saving as Native…')
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name, nativeAxes: { rows: parsed.rows, columns: parsed.columns, titles: parsed.pages } },
            {
                onSuccess: () => { setMdxDirty(false); toast.success(`Saved "${name}" as Native`, { id }) },
                onError:   e => toast.error(e.message, { id }),
            }
        )
    }, [mdx, parseMdxToAxes, tab.server, tab.cube, tab.viewName, saveView])

    const handleSaveAs = useCallback(() => {
        const currentName = tab.viewName || ''
        const suggested = currentName ? currentName.replace(/\s*\(default\)\s*$/i, '') : ''
        const name = prompt('Save view as…', suggested)
        if (!name) return
        const exists = views.some(v => v.name === name && name !== tab.viewName)
        if (exists && !window.confirm(`View "${name}" already exists. Overwrite?`)) return
        const id = toast.loading(`Saving "${name}"…`)
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name, ...buildSavePayload() },
            {
                onSuccess: () => {
                    setMdxDirty(false)
                    toast.success(`Saved "${name}"`, { id })
                    openTab({
                        id:       `cubeview:${tab.server}:${tab.cube}:${name}`,
                        type:     'cubeview',
                        label:    `⊞ ${tab.cube} / ${name}`,
                        server:   tab.server,
                        cube:     tab.cube,
                        viewName: name,
                    })
                },
                onError: e => toast.error(e.message, { id }),
            }
        )
    }, [buildSavePayload, tab.server, tab.cube, tab.viewName, openTab, views])

    const handleSetDefault = useCallback(() => {
        if (!window.confirm(`Overwrite the default view for [${tab.cube}]?\n\nThis will save the current layout as "Default".`)) return
        const id = toast.loading('Setting as default…')
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name: 'Default', ...buildSavePayload() },
            {
                onSuccess: () => {
                    setDefault.mutate(
                        { server: tab.server, cube: tab.cube, name: 'Default' },
                        {
                            onSuccess: () => { toast.success('Default view saved', { id }) },
                            onError:   e => toast.error(e.message, { id }),
                        }
                    )
                },
                onError: e => toast.error(e.message, { id }),
            }
        )
    }, [tab.server, tab.cube, buildSavePayload, saveView, setDefault])

    // Keyboard shortcuts (work globally in both visual + MDX modes)
    useEffect(() => {
        const onKey = (e) => {
            const ctrl = e.ctrlKey || e.metaKey
            if (!ctrl) return
            if (e.key === 'Enter') {
                e.preventDefault()
                handleExecute()
            }
            if (e.key.toLowerCase() === 's') {
                if (e.shiftKey) {
                    e.preventDefault()
                    handleSaveAs()
                } else if (tab.viewName) {
                    e.preventDefault()
                    handleSave()
                }
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [handleExecute, handleSave, handleSaveAs, tab.viewName])

    const displayResult = useMemo(() => {
        if (!result?.Axes || !Object.values(dimAliases).some(Boolean)) return result
        const axes = result.Axes.map(axis => ({
            ...axis,
            Tuples: axis.Tuples.map(tuple => ({
                ...tuple,
                Members: tuple.Members.map(m => {
                    const dim = m.UniqueName?.match(/^\[([^\]]+)\]/)?.[1]
                    const attr = dim ? dimAliases[dim] : null
                    if (!attr) return m
                    const v = aliasValueMaps[`${dim}:${attr}`]?.[m.Name]
                    return v ? { ...m, Name: v } : m
                })
            }))
        }))
        return { ...result, Axes: axes }
    }, [result, dimAliases, aliasValueMaps])
    const allAxesDims = useMemo(() => [...new Set([...axes.columns, ...axes.rows, ...axes.pages].map(d => d.dimension))], [axes.columns, axes.rows, axes.pages])
    const { data: formatAttrs = {} } = useMultiFormatAttrs(tab.server, allAxesDims)
    const pageMembers = useMemo(() => axes.pages.map(p => p.member).filter(Boolean), [axes.pages])
    const parsed = useMemo(() => {
        return displayResult ? parseCellset(displayResult, formatAttrs, pageMembers, app.settings.numFormat) : null
    }, [displayResult, formatAttrs, allAxesDims, pageMembers, app.settings.numFormat])
    const { colDefs: baseFlatColDefs, rowData } = useMemo(() => buildGridData(parsed), [parsed])

    // Apply persisted widths to the flat fallback grid
    const colDefs = useMemo(() => {
        const savedWidths = flatStorageKey
            ? (() => { try { return JSON.parse(localStorage.getItem(flatStorageKey) || '{}') } catch { return {} } })()
            : {}
        return baseFlatColDefs.map(cd => {
            const saved = savedWidths[cd.field]
            return saved ? { ...cd, width: saved } : cd
        })
    }, [baseFlatColDefs, flatStorageKey])

    const persistFlatWidths = useCallback(() => {
        if (!flatStorageKey) return
        try { localStorage.setItem(flatStorageKey, JSON.stringify(flatSavedWidthsRef.current)) } catch { /* ignore */ }
    }, [flatStorageKey])

    const onFlatColumnResized = useCallback((e) => {
        if (!e.finished || !e.column) return
        flatSavedWidthsRef.current[e.column.getColId()] = e.column.getActualWidth()
        persistFlatWidths()
    }, [persistFlatWidths])

    const handleFlatResetWidths = useCallback(() => {
        flatSavedWidthsRef.current = {}
        if (flatStorageKey) { try { localStorage.removeItem(flatStorageKey) } catch { /* ignore */ } }
        flatGridRef.current?.api?.resetColumnWidths?.()
        flatGridRef.current?.api?.autoSizeAllColumns?.()
    }, [flatStorageKey])

    const handleFlatExportCSV = useCallback(() => {
        flatGridRef.current?.api?.exportDataAsCsv?.()
    }, [])

    // Freeze top — set via the grid API (not a React prop) to avoid AG Grid's
    // re-render crash (issue #10278 / AG-14590). setTimeout defers past the
    // "cannot draw rows while drawing" render stage.
    useEffect(() => {
        const api = flatGridRef.current?.api
        if (!api) return
        const t = setTimeout(() => {
            api.setGridOption('pinnedTopRowData', flatFreezeTop && rowData.length ? [{ ...rowData[0] }] : null)
        }, 0)
        return () => clearTimeout(t)
    }, [flatFreezeTop, rowData])

    // Re-apply visual appearance settings (zebra, row height, font size) — AG
    // Grid doesn't redraw rows when these change.
    useEffect(() => {
        const api = flatGridRef.current?.api
        if (!api) return
        const t = setTimeout(() => {
            api.redrawRows()
            api.refreshHeader?.()
        }, 0)
        return () => clearTimeout(t)
    }, [app.refreshKey])

    // ── HierarchyGrid data ────────────────────────────────────────────────────
    // Fixed 4-slot hooks per axis (React rules: no conditional/loop hooks)
    const rowDims = useMemo(() => axes.rows.map(d => d.dimension),    [axes.rows])
    const colDims = useMemo(() => axes.columns.map(d => d.dimension), [axes.columns])

    const { data: rTree0 = [] } = useElementsTree(rowDims[0] ? tab.server : null, rowDims[0] ?? null)
    const { data: rTree1 = [] } = useElementsTree(rowDims[1] ? tab.server : null, rowDims[1] ?? null)
    const { data: rTree2 = [] } = useElementsTree(rowDims[2] ? tab.server : null, rowDims[2] ?? null)
    const { data: rTree3 = [] } = useElementsTree(rowDims[3] ? tab.server : null, rowDims[3] ?? null)

    const { data: cTree0 = [] } = useElementsTree(colDims[0] ? tab.server : null, colDims[0] ?? null)
    const { data: cTree1 = [] } = useElementsTree(colDims[1] ? tab.server : null, colDims[1] ?? null)
    const { data: cTree2 = [] } = useElementsTree(colDims[2] ? tab.server : null, colDims[2] ?? null)
    const { data: cTree3 = [] } = useElementsTree(colDims[3] ? tab.server : null, colDims[3] ?? null)

    const hierarchies = useMemo(() => {
        const trees = [rTree0, rTree1, rTree2, rTree3]
        return rowDims.map((dim, i) => buildHierarchyFromElements(trees[i], dim)).filter(Boolean)
    }, [rowDims, rTree0, rTree1, rTree2, rTree3])

    const columnHierarchies = useMemo(() => {
        const trees = [cTree0, cTree1, cTree2, cTree3]
        return colDims.map((dim, i) => buildHierarchyFromElements(trees[i], dim)).filter(Boolean)
    }, [colDims, cTree0, cTree1, cTree2, cTree3])

    const hierarchyData = useMemo(() => cellsetToHierarchyData(result, formatAttrs, pageMembers, suppressZeros, app.settings.numFormat), [result, formatAttrs, pageMembers, suppressZeros, app.settings.numFormat])

    // Constrain hierarchies to only members the cellset actually returned
    const constrainedHierarchies = useMemo(() => {
        if (!hierarchyData || !hierarchies.length) return hierarchies
        const dimCount = hierarchies.length
        const perDim   = Array.from({ length: dimCount }, () => new Set())
        for (const key of Object.keys(hierarchyData.data)) {
            key.split('::').forEach((m, i) => { if (perDim[i]) perDim[i].add(m) })
        }
        return hierarchies.map((h, i) => constrainHierarchy(h, [...perDim[i]]))
    }, [hierarchies, hierarchyData])

    const constrainedColHierarchies = useMemo(() => {
        if (!hierarchyData || !columnHierarchies.length) return columnHierarchies
        const perDim = Array.from({ length: columnHierarchies.length }, () => new Set())
        for (const col of hierarchyData.columns) {
            (col.members ?? [col.label]).forEach((m, i) => { if (perDim[i]) perDim[i].add(m) })
        }
        return columnHierarchies.map((h, i) => constrainHierarchy(h, [...perDim[i]]))
    }, [columnHierarchies, hierarchyData])

    const aliasActive = Object.values(dimAliases).some(Boolean)
    const applyAliasToNodes = (nodes, dim) => {
        const attr = dimAliases[dim]; if (!attr) return nodes
        const map  = aliasValueMaps[`${dim}:${attr}`]; if (!map) return nodes
        return Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, { ...n, label: map[id] ?? n.label ?? id }]))
    }
    const displayHierarchies = useMemo(() =>
        !aliasActive ? constrainedHierarchies
        : constrainedHierarchies.map((h, i) => ({ ...h, nodes: applyAliasToNodes(h.nodes ?? {}, rowDims[i]) })),
    [constrainedHierarchies, rowDims, dimAliases, aliasValueMaps]) // eslint-disable-line
    const displayColHierarchies = useMemo(() =>
        !aliasActive ? constrainedColHierarchies
        : constrainedColHierarchies.map((h, i) => ({ ...h, nodes: applyAliasToNodes(h.nodes ?? {}, colDims[i]) })),
    [constrainedColHierarchies, colDims, dimAliases, aliasValueMaps]) // eslint-disable-line
    const displayColumns = useMemo(() => {
        if (!hierarchyData?.columns || !aliasActive) return hierarchyData?.columns
        return hierarchyData.columns.map(col => {
            const aliased = (col.members ?? [col.label]).map((name, i) => {
                const dim = colDims[i]; const attr = dim ? dimAliases[dim] : null
                return attr ? (aliasValueMaps[`${dim}:${attr}`]?.[name] ?? name) : name
            })
            return { ...col, label: aliased.join(' / '), members: aliased }
        })
    }, [hierarchyData?.columns, colDims, dimAliases, aliasValueMaps])
    const displayAxes = useMemo(() => {
        if (!result?.Axes || !aliasActive) return result?.Axes
        return result.Axes.map(axis => ({
            ...axis,
            Tuples: axis.Tuples.map(tuple => ({
                ...tuple,
                Members: tuple.Members.map(m => {
                    const dim = m.UniqueName?.match(/^\[([^\]]+)\]/)?.[1]
                    const attr = dim ? dimAliases[dim] : null
                    if (!attr) return m
                    const v = aliasValueMaps[`${dim}:${attr}`]?.[m.Name]
                    return v ? { ...m, Name: v } : m
                })
            }))
        }))
    }, [result?.Axes, dimAliases, aliasValueMaps])

    const handleCellEdit = useCallback(async ({ tupleKey, colId, value }) => {
        if (!tab.server || !tab.cube) return
        const rowMembers = tupleKey.split('::')
        const rowCoords  = axes.rows.map((d, i) => ({ dim: d.dimension, element: rowMembers[i] })).filter(c => c.element != null)
        const col        = hierarchyData?.columns?.find(c => c.id === colId)
        if (!col) return
        const colMembers = col.members ?? [col.label]
        const colCoords  = axes.columns.map((d, i) => ({ dim: d.dimension, element: colMembers[i] })).filter(c => c.element != null)
        const pageCoords = axes.pages.filter(p => p.member).map(p => ({ dim: p.dimension, element: p.member }))
        const coordMap   = new Map([...rowCoords, ...colCoords, ...pageCoords].map(c => [c.dim, c.element]))
        const missing    = cubeDims.filter(d => !coordMap.has(d))
        if (missing.length) {
            toast.error(`Cannot write — move all dimensions to an axis: ${missing.join(', ')}`)
            handleExecute()
            return
        }
        const dims = cubeDims.map(dim => ({ dim, element: coordMap.get(dim) }))
        const id = toast.loading('Writing…')
        try {
            const res = await fetch('/api/cells/write', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-ide-token': localStorage.getItem('tm1-token') ?? '' },
                body: JSON.stringify({ server: tab.server, cube: tab.cube, dims, value }),
            })
            const d = await res.json()
            if (!res.ok) throw new Error(d.error || 'Write failed')
            toast.success('Written', { id })
            handleExecute()
        } catch (e) {
            toast.error(e.message, { id })
            handleExecute()
        }
    }, [tab.server, tab.cube, axes, hierarchyData, cubeDims, handleExecute])

    const useHierarchy  = !flatMode && !!(rowDims.length > 0 && constrainedHierarchies.length > 0 && hierarchyData && result)

    // Build full tuple from a cell context-menu event — used to filter the Transaction Log
    const buildTupleFromCell = useCallback(({ tupleKey, colId }) => {
        const rowMembers = (tupleKey ?? '').split('::')
        const rowCoords  = axes.rows.map((d, i) => ({ dim: d.dimension, element: rowMembers[i] }))
        const col        = hierarchyData?.columns?.find(c => c.id === colId)
        const colMembers = col?.members ?? (col?.label ? [col.label] : [])
        const colCoords  = axes.columns.map((d, i) => ({ dim: d.dimension, element: colMembers[i] }))
        const pageCoords = axes.pages.filter(p => p.member).map(p => ({ dim: p.dimension, element: p.member }))
        const coordMap   = new Map([...rowCoords, ...colCoords, ...pageCoords].map(c => [c.dim, c.element]))
        return cubeDims.map(d => coordMap.get(d) ?? null)
    }, [axes, hierarchyData, cubeDims])

    const handleCellContextMenu = useCallback((e) => {
        e.event?.preventDefault?.()
        const tupleKey   = e.data?.__tupleKey__
        const colId      = e.colDef?.field
        const rowMembers = (tupleKey ?? '').split('::')
        const rowCoords  = axes.rows.map((d, i) => ({ dim: d.dimension, element: rowMembers[i] }))
        const col        = hierarchyData?.columns?.find(c => c.id === colId)
        const colMembers = col?.members ?? (col?.label ? [col.label] : [])
        const colCoords  = axes.columns.map((d, i) => ({ dim: d.dimension, element: colMembers[i] }))
        const pageCoords = axes.pages.filter(p => p.member).map(p => ({ dim: p.dimension, element: p.member }))
        const coordMap   = new Map([...rowCoords, ...colCoords, ...pageCoords].map(c => [c.dim, c.element]))
        const dimElemPairs = cubeDims.map(d => ({ dim: d, element: coordMap.get(d) })).filter(p => p.element)
        if (!dimElemPairs.length) return
        const isAllLeaf = axes.rows.every((_, i) => e.data?.[`__d${i}_isLeaf__`] ?? true)
        setCellCtx({
            x: e.event?.clientX ?? 400,
            y: e.event?.clientY ?? 200,
            dimElemPairs,
            value: e.data?.[colId],
            isAllLeaf,
            cube: tab.cube,
            server: tab.server,
        })
        if (showLog) setLogTuple(cubeDims.map(d => coordMap.get(d) ?? null))
    }, [axes, hierarchyData, cubeDims, tab.cube, tab.server, showLog])

    const allDims = useMemo(() => [...axes.rows, ...axes.columns, ...axes.pages, ...bench], [axes, bench])
    const activeDim = activeDrag ? allDims.find(d => d.dimension === activeDrag) : null

    const isLoadingView = loadViewAxes.isPending
    const isExecuting   = executeMDX.isPending

    return (
        <div className="flex h-full min-h-0">
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <ConflictBanner conflict={openConflict?.id !== dismissedId ? openConflict : null} onDismiss={() => setDismissedId(openConflict?.id)} />
            <ConflictSaveWarning
              conflict={saveConflict}
              onSaveAnyway={() => { setSaveConflict(null); executeSave(tab.viewName) }}
              onCancel={() => setSaveConflict(null)}
              onShowDiff={() => {
                const payload = buildSavePayload()
                setConflictDiff({
                  object_type: 'view',
                  object_name: tab.viewName,
                  detail:      tab.cube,
                  timestamp:   saveConflict.timestamp,
                  action:      'CONFLICT',
                  session_name: null,
                  before_state: saveConflict.after_state ?? (payload.nativeAxes ? { type: 'native', definition: payload.nativeAxes } : { type: 'mdx', mdx: payload.mdx ?? '' }),
                  after_state:  payload.nativeAxes ? { type: 'native', definition: payload.nativeAxes } : { type: 'mdx', mdx: payload.mdx ?? '' },
                })
              }}
            />
            {conflictDiff && <DiffViewerModal entry={conflictDiff} onClose={() => setConflictDiff(null)} />}
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
                <span className="text-xs font-mono text-muted-foreground truncate">
                    {tab.cube}
                    {tab.viewName && <>
                        <span className="mx-1 text-muted-foreground/40">/</span>
                        <span className="text-foreground">{tab.viewName}</span>
                    </>}
                    {viewType && (
                        <span className="ml-1.5 text-[10px] px-1 py-px rounded border border-border text-muted-foreground bg-muted">
                            {viewType.includes('NativeView') ? 'Native' : 'MDX'}
                        </span>
                    )}
                </span>

                <button
                    onClick={() => {
                        const { setRevealTarget } = useStore.getState()
                        if (tab.viewName) {
                            setRevealTarget({ type: 'view', server: tab.server, cube: tab.cube, viewName: tab.viewName })
                        } else {
                            setRevealTarget({ type: 'cube', server: tab.server, cube: tab.cube })
                        }
                    }}
                    className="p-1 rounded hover:bg-muted text-amber-400 hover:text-amber-300 transition-colors"
                    title="Show in tree"
                >
                    <MapPin size={11} />
                </button>

                {/* Mode toggle */}
                <div className="flex items-center gap-0.5 bg-muted rounded p-0.5">
                    <button
                        onClick={() => !mdxTooComplex && setMode('visual')}
                        disabled={!!mdxTooComplex}
                        title={mdxTooComplex
                            ? `Visual mode unavailable — MDX uses: ${mdxTooComplex.join(', ')}. Replace these with named subsets to enable.`
                            : undefined}
                        className={cn('flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors',
                            mode === 'visual' ? 'bg-background text-foreground shadow-sm'
                            : mdxTooComplex  ? 'text-muted-foreground/40 cursor-not-allowed'
                            : 'text-muted-foreground hover:text-foreground')}>
                        <Eye size={10} /> Visual
                    </button>
                    <button onClick={() => {
                        if (mode === 'visual') setMdx(buildMDX({ cube: tab.cube, ...axes, bench, suppressZeros }))
                        setMode('mdx')
                    }}
                        className={cn('flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors',
                            mode === 'mdx' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                        <Code2 size={10} /> MDX
                    </button>
                </div>

                <button
                    onClick={() => {
                        const { openTab } = useStore.getState()
                        openTab({
                            id:           `guidedmdxview:${tab.server}:${tab.cube}:${Date.now()}`,
                            type:         'guidedmdxview',
                            label:        `Builder — ${tab.cube}`,
                            server:       tab.server,
                            cube:         tab.cube,
                            initialState: {
                                selectedCube: tab.cube,
                                dimConfig:    viewerAxesToBuilderConfig(axes),
                                step:         1,
                            },
                        })
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Open in Guided MDX Builder"
                >
                    <Braces size={10} /> Builder
                </button>

                {/* Saved sessions — named local drafts for experimenting */}
                <div className="relative">
                    <button onClick={() => setSessionsOpen(o => !o)}
                        className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Saved sessions — local drafts, not saved to TM1">
                        <Clock size={10} /> Sessions
                    </button>
                    {sessionsOpen && (
                        <div className="absolute top-full left-0 mt-1 bg-popover border border-border rounded shadow-lg z-50 w-64 py-1">
                            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
                                <input value={sessionName} onChange={e => setSessionName(e.target.value)} placeholder="Session name…"
                                    className="flex-1 text-xs px-1.5 py-0.5 border rounded bg-background outline-none"
                                    onKeyDown={e => e.key === 'Enter' && handleSaveSession()} />
                                <button onClick={handleSaveSession} disabled={!sessionName.trim()}
                                    className="px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1">
                                    {sessionSavedIndicator ? <Check size={10} /> : <Save size={10} />}
                                </button>
                            </div>
                            {sessions.length === 0
                                ? <div className="px-3 py-2 text-xs text-muted-foreground">No saved sessions</div>
                                : sessions.map((s, i) => (
                                    <button key={i} onClick={() => handleLoadSession(s)}
                                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center justify-between">
                                        <span className="font-mono truncate flex-1 mr-2">{s.name}</span>
                                        <span className="text-muted-foreground/60 shrink-0 text-[10px]">{new Date(s.time).toLocaleDateString()}</span>
                                    </button>
                                ))
                            }
                        </div>
                    )}
                </div>

                <button
                    onClick={() => setShowLog(v => !v)}
                    title="Transaction log — see who changed what and when"
                    className={cn(
                        'flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border transition-colors',
                        showLog
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                >
                    <History size={10} /> Log
                </button>

                <button
                    onClick={async () => {
                        setCheckingFeeders(true)
                        try {
                            const token = localStorage.getItem('tm1-token') ?? ''
                            const r = await fetch('/api/cube/check-feeders-for-rules', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'x-ide-token': token },
                                body: JSON.stringify({ server: tab.server, cube: tab.cube }),
                            })
                            const d = await r.json()
                            if (d.unsupported) toast.warning(d.message)
                            else if (d.error) toast.error(`Feeder check failed: ${d.error}`)
                            else { toast.success('Feeder check complete — refreshing view'); handleExecute() }
                        } catch { toast.error('Feeder check failed') }
                        finally { setCheckingFeeders(false) }
                    }}
                    disabled={checkingFeeders || !result}
                    title="Run CheckFeedersForRules — recalculates feeder propagation for this cube. Zero rule cells highlight amber."
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                >
                    {checkingFeeders ? <Loader2 size={10} className="animate-spin" /> : <Rss size={10} />} Fire Feeders
                </button>

                <div className="flex-1" />

                <button onClick={() => setFlatMode(v => !v)}
                    title={flatMode
                        ? 'Flat grid with sort-by-column — back to hierarchy view'
                        : 'Flat grid with sort-by-column (click column headers to sort)'}
                    className={cn('flex items-center justify-center px-2 py-1.5 rounded border border-border text-[10px] transition-colors',
                        flatMode ? 'text-primary bg-primary/10 border-primary/40' : 'text-muted-foreground hover:bg-muted')}>
                    <Table2 size={12} className="mr-1" /> Flat
                </button>

                <button onClick={() => {
                        const modes = ['none', 'rows', 'columns', 'all']
                        const idx = modes.indexOf(suppressZeros)
                        const next = modes[(idx + 1) % modes.length]
                        handleExecute({ suppressZeros: next })
                    }}
                    title={suppressZeros === 'none' ? 'Suppression off' : suppressZeros === 'rows' ? 'Suppress empty rows' : suppressZeros === 'columns' ? 'Suppress empty columns' : 'Suppress empty rows & columns'}
                    className={cn('flex items-center justify-center p-1.5 rounded border border-border transition-colors',
                        suppressZeros === 'none' ? 'text-muted-foreground hover:bg-muted' : 'text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/30 border-emerald-400/40')}>
                    {suppressZeros === 'none' ? <ZapOff size={12} /> : suppressZeros === 'rows' ? <Rows3 size={12} /> : suppressZeros === 'columns' ? <Columns3 size={12} /> : <Zap size={12} />}
                </button>

                <button onClick={() => setTotalsPosition(v => v === 'top' ? 'bottom' : 'top')}
                    title={totalsPosition === 'bottom' ? 'Row totals at bottom' : 'Row totals at top'}
                    className={cn('flex items-center justify-center px-2 py-1.5 rounded border border-border text-[10px] font-mono transition-colors',
                        totalsPosition === 'bottom' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted')}>
                    {totalsPosition === 'bottom' ? '∑↓' : '∑↑'}
                </button>

                <button onClick={() => setColTotalsPosition(v => v === 'top' ? 'bottom' : 'top')}
                    title={colTotalsPosition === 'bottom' ? 'Col totals at right' : 'Col totals at left'}
                    className={cn('flex items-center justify-center px-2 py-1.5 rounded border border-border text-[10px] font-mono transition-colors',
                        colTotalsPosition === 'bottom' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted')}>
                    {colTotalsPosition === 'bottom' ? '∑→' : '∑←'}
                </button>

                {views.length > 0 && !tab.viewName && (
                    <select defaultValue=""
                        onChange={e => {
                            const v = e.target.value
                            if (!v) return
                            openTab({
                                id:       `cubeview:${tab.server}:${tab.cube}:${v}`,
                                type:     'cubeview',
                                label:    `⊞ ${tab.cube} / ${v}`,
                                server:   tab.server,
                                cube:     tab.cube,
                                viewName: v,
                            })
                        }}
                        disabled={isLoadingView}
                        className="text-xs px-2 py-0.5 rounded border border-border bg-background text-muted-foreground">
                        <option value="">Load view…</option>
                        {views.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                    </select>
                )}

                <div className="relative">
                    <div className="flex items-center">
                        <button onClick={handleSave}
                            disabled={tab.viewName && mode === 'mdx' && !mdxDirty}
                            title="Save (Ctrl+S)"
                            className={cn('flex items-center gap-1 px-2 py-1 rounded-l text-xs border border-r-0 transition-colors',
                                !tab.viewName || (mode === 'mdx' && mdxDirty) || mode === 'visual'
                                    ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                                    : 'border-border text-muted-foreground hover:bg-muted')}>
                            <Save size={11} /> {tab.viewName ? 'Save' : 'Save As'}
                        </button>
                        <button onClick={() => setShowSaveMenu(v => !v)}
                            title="Save options"
                            className={cn('flex items-center px-1 py-1 rounded-r text-xs border transition-colors',
                                !tab.viewName || (mode === 'mdx' && mdxDirty) || mode === 'visual'
                                    ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                                    : 'border-border text-muted-foreground hover:bg-muted')}>
                            <ChevronDown size={10} />
                        </button>
                    </div>
                    {showSaveMenu && (
                        <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded shadow-lg py-1 w-44" onMouseLeave={() => setShowSaveMenu(false)}>
                            {mode === 'mdx' && (
                                <button onClick={() => { handleSaveAsNative(); setShowSaveMenu(false) }}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors">
                                    Save as Native view
                                </button>
                            )}
                            <button onClick={() => { handleSaveAs(); setShowSaveMenu(false) }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors">
                                Save As… (new name)
                            </button>
                            {tab.viewName && (
                                <button onClick={() => { handleSetDefault(); setShowSaveMenu(false) }}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors border-t border-border mt-1 pt-1.5">
                                    Save as Default View
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <button onClick={handleExecute} disabled={isExecuting || isLoadingView}
                    title="Execute / Refresh (Ctrl+Enter)"
                    className="flex items-center justify-center p-1.5 rounded text-emerald-500 hover:bg-muted transition-colors disabled:opacity-40">
                    {isExecuting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                </button>
            </div>

            {/* AI bar — front door for building this view */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/10 shrink-0">
                <Sparkles size={11} className={cn('shrink-0', hasAnthropicKey ? 'text-violet-400' : 'text-muted-foreground/40')} />
                {hasAnthropicKey ? (
                    <>
                        <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleGenerateAI()}
                            placeholder="Describe the view you want…"
                            className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/40" />
                        <button onClick={handleGenerateAI} disabled={!aiPrompt.trim() || generateViewMDX.isPending}
                            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-violet-700 text-white disabled:opacity-40 hover:bg-violet-600 transition-colors shrink-0">
                            {generateViewMDX.isPending ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} Generate
                        </button>
                    </>
                ) : (
                    <span className="flex-1 text-xs text-muted-foreground/40 italic">AI generation needs an Anthropic API key — not configured on this server</span>
                )}
            </div>

            {/* Complex MDX banner — Visual mode locked */}
            {mdxTooComplex && (
                <div className="shrink-0 px-3 py-1.5 border-b border-border bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 text-[10px] flex items-center gap-2">
                    <AlertTriangle size={11} className="shrink-0" />
                    <span>Visual mode unavailable — MDX uses <strong>{mdxTooComplex.join(', ')}</strong>. Replace these with named subsets to enable visual editing.</span>
                </div>
            )}

            {/* Native view in MDX mode warning */}
            {isOriginallyNative && mode === 'mdx' && !mdxTooComplex && (
                <div className="shrink-0 px-3 py-1 border-b border-border bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 text-[10px] flex items-center gap-1">
                    <ZapOff size={10} />
                    <span>Editing in MDX mode — saving will convert this Native view to MDX.</span>
                </div>
            )}

            {/* Used In */}
            {tab.viewName && (
                <div className="shrink-0 border-b border-border">
                    <button
                        onClick={() => { setShowUsedIn(v => !v); if (!showUsedIn) refetchUsedIn() }}
                        className="flex items-center gap-1.5 w-full px-3 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                    >
                        {showUsedIn ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        <FileSearch size={10} />
                        <span>Used In</span>
                        {usageData?.processes?.length > 0 && <span className="opacity-60">({usageData.processes.length})</span>}
                        {loadingUsedIn && <Loader2 size={10} className="animate-spin ml-1" />}
                    </button>
                    {showUsedIn && (
                        <div className="px-3 py-1.5 bg-muted/10 max-h-48 overflow-auto space-y-2">
                            {!usageData && !pawBookData && !loadingUsedIn && (
                                <p className="text-[10px] text-muted-foreground italic">Scanning…</p>
                            )}
                            {usageData && usageData.processes.length > 0 && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">
                                        TI Processes ({usageData.processes.length})
                                    </div>
                                    {usageData.processes.map((u, i) => (
                                        <button key={i}
                                            onClick={() => openTab({ id: `process:${tab.server}:${u.process}`, type: 'process', label: u.process, server: tab.server, processName: u.process })}
                                            className="flex items-center gap-1.5 w-full px-1 py-0.5 text-[11px] hover:bg-muted rounded text-left">
                                            <Cog size={10} className="shrink-0 text-muted-foreground" />
                                            <span className="font-mono truncate">{u.process}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">
                                    PAW Books ({pawBookData?.books.length ?? 0})
                                </div>
                                {!pawBookData ? (
                                    <p className="text-[10px] text-muted-foreground italic">Scanning…</p>
                                ) : pawBookData.books.length === 0 ? (
                                    <p className="text-[10px] text-muted-foreground italic">None found.</p>
                                ) : (
                                    <div className="space-y-0.5">
                                        {pawBookData.books.map(book => (
                                            <a key={book.id}
                                                href={`${pawBookData?.pawHost || ''}/ui?type=book&path=${encodeURIComponent(book.path)}`}
                                                target="_blank" rel="noreferrer"
                                                className="flex items-center gap-1.5 text-[10px] hover:bg-muted rounded px-1 py-0.5"
                                                title={book.path}>
                                                <BookOpen size={9} className="shrink-0 text-muted-foreground" />
                                                <span className="truncate">{book.name}</span>
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Visual builder */}
            {mode === 'visual' && (
                <div className="shrink-0 border-b border-border bg-muted/10">
                    {!builderCollapsed && (
                        <DndContext sensors={sensors} onDragStart={({ active }) => setActiveDrag(active.id)} onDragEnd={handleDragEnd}>
                            <div className="px-3 py-2 grid grid-cols-4 gap-2">
                                <DropZone id="rows"    label="Rows"    icon={Rows3}    dims={axes.rows}    server={tab.server} onRemove={removeDim} onSubsetChange={setSubset} onMemberChange={setMember} onMembersChange={setMembers} onMemberSetChange={setMemberSet} onReorder={(f,t) => reorderDim('rows',f,t)}    accent="text-muted-foreground" dimAliases={dimAliases} onAliasChange={handleAliasChange} onBuildSubset={handleBuildSubset} />
                                <DropZone id="columns" label="Columns" icon={Columns3} dims={axes.columns} server={tab.server} onRemove={removeDim} onSubsetChange={setSubset} onMemberChange={setMember} onMembersChange={setMembers} onMemberSetChange={setMemberSet} onReorder={(f,t) => reorderDim('columns',f,t)} accent="text-muted-foreground" dimAliases={dimAliases} onAliasChange={handleAliasChange} onBuildSubset={handleBuildSubset} />
                                <DropZone id="pages"   label="Filter"  icon={Filter}   dims={axes.pages}   server={tab.server} onRemove={removeDim} onSubsetChange={setSubset} onMemberChange={setMember} onMembersChange={setMembers} onReorder={(f,t) => reorderDim('pages',f,t)}   accent="text-muted-foreground" dimAliases={dimAliases} onAliasChange={handleAliasChange} onBuildSubset={handleBuildSubset} />
                                <DropZone id="bench"   label="Bench"   icon={LayoutGrid} dims={bench}      server={tab.server} onRemove={() => {}}  onSubsetChange={() => {}}  onMemberChange={() => {}}  onMembersChange={() => {}}  onReorder={() => {}}                           accent="text-muted-foreground" />
                            </div>
                            <DragOverlay>
                                {activeDim && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 rounded border text-xs bg-muted border-primary shadow-lg">
                                        <GripVertical size={11} /><span className="font-mono">{activeDim.dimension}</span>
                                    </div>
                                )}
                            </DragOverlay>
                        </DndContext>
                    )}
                    {/* Collapse / expand toggle for the whole builder row */}
                    <div className="flex items-center gap-2 px-3 py-1">
                        <button onClick={() => setBuilderCollapsed(c => !c)}
                            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors py-0.5 rounded"
                            title={builderCollapsed ? 'Expand view builder' : 'Collapse view builder'}>
                            {builderCollapsed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                            <LayoutGrid size={10} /> View builder
                        </button>
                        {builderCollapsed && (
                            <span className="text-[10px] text-muted-foreground/60 truncate">
                                Rows {axes.rows.length} · Columns {axes.columns.length} · Filter {axes.pages.length} · Bench {bench.length}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* MDX editor */}
            {mode === 'mdx' && (
                <div className="shrink-0 border-b border-border flex flex-col min-h-0" style={{ height: mdxEditorHeight }}>
                    <div className="flex items-center justify-between px-2 py-0.5 border-b border-border bg-muted/30 shrink-0">
                        <span className="text-[10px] text-muted-foreground">MDX</span>
                        <button
                            onClick={() => { const f = formatMDX(mdx); setMdx(f); setMdxDirty(true) }}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                            title="Format MDX"
                        >
                            <WrapText size={10} /> Format
                        </button>
                    </div>
                    <MonacoEditor
                        key={`mdx-editor-${tab.id}`}
                        height="100%"
                        language="tm1mdx"
                        value={mdx}
                        theme={dark ? 'vs-dark' : 'vs'}
                        onChange={v => { setMdx(v ?? ''); setMdxDirty(true) }}
                        onMount={(editor, monaco) => {
                            editorRef.current = editor
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, handleSave)
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, handleExecute)
                        }}
                        options={{
                            fontSize: 13,
                            minimap: { enabled: false },
                            wordWrap: 'on',
                            scrollBeyondLastLine: false,
                            lineNumbers: 'on',
                            folding: false,
                            fixedOverflowWidgets: true,
                            wordBasedSuggestions: 'off',
                        }}
                    />
                </div>
            )}

            {mode === 'mdx' && (
                <div onMouseDown={startMdxEditorResize}
                    className="shrink-0 h-1.5 cursor-row-resize flex items-center justify-center hover:bg-primary/20 transition-colors group"
                    title="Drag to resize editor">
                    <GripHorizontal size={12} className="text-muted-foreground/40 group-hover:text-primary/60" />
                </div>
            )}

            {/* Truncation warning */}
            {truncated && (
                <div className="shrink-0 px-3 py-1 bg-yellow-500/10 border-b border-yellow-500/30 text-yellow-600 dark:text-yellow-400 text-xs flex items-center gap-1.5">
                    <span>⚠</span>
                    <span>Result capped at 50,000 cells — add filters or subsets to narrow the view.</span>
                </div>
            )}

            {/* Flat-mode hint */}
            {flatMode && (
                <div className="shrink-0 px-3 py-1 bg-sky-500/10 border-b border-sky-500/30 text-sky-600 dark:text-sky-400 text-xs flex items-center gap-1.5">
                    <ArrowUpDown size={11} />
                    <span>Flat view — click a column header to sort. Toggle <span className="font-medium">Flat</span> off to return to the hierarchy view.</span>
                </div>
            )}

            {/* Grid */}
            {!result ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm select-none">
                    <div className="text-center">
                        <Table2 size={32} className="mx-auto mb-2 opacity-30" />
                        <p>{mode === 'visual' ? 'Arrange dimensions then press Execute' : 'Edit MDX then press Execute'}</p>
                    </div>
                </div>
            ) : useHierarchy ? (
                <div className="flex-1 min-h-0">
                    <GridErrorBoundary>
                        <HierarchyGrid
                            key={tab.server && tab.cube ? `hg::${tab.server}::${tab.cube}::${tab.viewName || 'adhoc'}` : undefined}
                            hierarchies={displayHierarchies}
                            columnHierarchies={colDims.length > 0 ? displayColHierarchies : []}
                            columns={displayColumns ?? hierarchyData.columns}
                            data={hierarchyData.data}
                            dark={dark}
                            keepMode="parent"
                            totalsPosition={totalsPosition}
                            colTotalsPosition={colTotalsPosition}
                            onCellEdit={handleCellEdit}
                            onCellContextMenu={handleCellContextMenu}
                            storageKey={tab.server && tab.cube ? `hg::${tab.server}::${tab.cube}::${tab.viewName || 'adhoc'}` : undefined}
                            appearance={app}
                        />
                    </GridErrorBoundary>
                </div>
            ) : !parsed || parsed.grid.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No data returned</div>
            ) : (
                <div className={cn('flex flex-col flex-1 min-h-0', cn(app.settings.headerTint && 'grid-wrap-accent', app.settings.headerBold && 'grid-wrap-bold'))} style={app.wrapperStyle}>
                    <GridToolbar
                        apiRef={flatGridRef}
                        onFit={() => flatGridRef.current?.api?.autoSizeAllColumns?.()}
                        onReset={handleFlatResetWidths}
                        onSearch={handleFlatSearch}
                        frozen={flatFreezeTop}
                        onToggleFreeze={() => setFlatFreezeTop(f => !f)}
                        showCsv
                        onCsv={handleFlatExportCSV}
                        appearance={app}
                    />
                    <div className="flex-1 min-h-0">
                        <AgGridReact
                            ref={flatGridRef}
                            theme={app.makeTheme(dark)}
                            columnDefs={colDefs}
                            rowData={rowData}
                            quickFilterText={flatQuickFilter || undefined}
                            suppressMovableColumns
                            enableCellTextSelection
                            defaultColDef={{ sortable: true }}
                            onColumnResized={onFlatColumnResized}
                            onFirstDataRendered={p => { if (!Object.keys(flatSavedWidthsRef.current).length) p.api.autoSizeAllColumns() }}
                            onCellContextMenu={handleCellContextMenu}
                        />
                    </div>
                </div>
            )}
        </div>
        {showLog && (
            <TransactionLogPanel
                server={tab.server}
                cube={tab.cube}
                cubeDims={cubeDims}
                tupleFilter={logTuple}
                onClearFilter={() => setLogTuple(null)}
                onClose={() => { setShowLog(false); setLogTuple(null) }}
            />
        )}
        {cellCtx && (
            <CellContextMenu
                ctx={cellCtx}
                onClose={() => setCellCtx(null)}
                onTrace={(ctx) => { setTraceCtx({ ...ctx, cubeDims }); setCellCtx(null) }}
            />
        )}
        {traceCtx && (
            <TraceSidePanel
                ctx={traceCtx}
                onClose={() => setTraceCtx(null)}
            />
        )}
        </div>
    )
}
