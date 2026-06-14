/**
 * HierarchyGrid — pivot grid with independent hierarchy expand/collapse on both axes.
 *
 * ROW expand state:
 *   dim 0 (outer): global Set<nodeId>
 *   dim i > 0:     Map<contextKey, Set<nodeId>>  — missing context defaults to allExpanded
 *
 * COL expand state: same Map-based design as rows.
 *
 * Multi-dim COL headers: custom stacked header (N rows, one per col dim).
 *   Repeated outer-dim labels across adjacent columns are suppressed.
 *
 * Props:
 *   hierarchies       { nodes, roots, maxLevel, name? }[]  — row dims, outer→inner
 *   columnHierarchies { nodes, roots, maxLevel, name? }[]  — col dims (optional)
 *   columns           { id, label, members? }[]
 *   data              Record<tupleKey, Record<colId, value>>
 *   keepMode          'replace' | 'parent' | 'all'
 *   dark              boolean
 *   onCellEdit        ({ tupleKey, colId, value }) => void
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

ModuleRegistry.registerModules([AllCommunityModule])

const HDR_ROW_H = 28

function makeTheme(dark, numColDims) {
    const headerHeight = Math.max(HDR_ROW_H, numColDims * HDR_ROW_H)
    const base = dark ? themeBalham.withPart(colorSchemeDark) : themeBalham.withPart(colorSchemeLight)
    return base.withParams({ fontSize: 12, rowHeight: 26, headerHeight })
}

// ── Shared algorithms ─────────────────────────────────────────────────────────

function allExpanded(nodes) {
    return new Set(Object.keys(nodes).filter(id => !nodes[id].isLeaf && nodes[id].children?.length))
}

function computeVisibleNodes(roots, nodes, expanded, keepMode, totalsAtBottom = false) {
    const result = []
    function visit(nodeId) {
        const node = nodes[nodeId]
        if (!node) return
        const isOpen      = expanded.has(nodeId)
        const hasChildren = !node.isLeaf && node.children?.length > 0
        const showParent  = keepMode === 'replace' ? !(isOpen && hasChildren) : true
        if (!totalsAtBottom && showParent) result.push(nodeId)
        if (isOpen && hasChildren) for (const c of node.children) visit(c)
        if (totalsAtBottom  && showParent) result.push(nodeId)
    }
    for (const r of roots) visit(r)
    return result
}


/**
 * Recursively compute visible tuples with per-context inner-dim expansion.
 *   expandedSets[0]    = Set           (outer dim, global)
 *   expandedSets[i>0]  = Map<ctx, Set> (inner dims, per outer context)
 *                        missing key → allExpanded(h.nodes) default
 */
function computeVisibleTuples(hierarchies, expandedSets, keepMode, totalsAtBottom = false) {
    function recurse(dimIdx, contextKey) {
        const h = hierarchies[dimIdx]
        if (!h) return [[]]

        let expanded
        if (dimIdx === 0) {
            expanded = expandedSets[0] ?? new Set()
        } else {
            const map = expandedSets[dimIdx]
            expanded  = (map instanceof Map ? (map.get(contextKey) ?? map.get('*') ?? allExpanded(h.nodes)) : null) ?? allExpanded(h.nodes)
        }

        const visible = computeVisibleNodes(h.roots, h.nodes, expanded, keepMode, totalsAtBottom)
        if (dimIdx === hierarchies.length - 1) return visible.map(id => [id])

        return visible.flatMap(id => {
            const ctx = contextKey ? `${contextKey}::${id}` : id
            return recurse(dimIdx + 1, ctx).map(child => [id, ...child])
        })
    }
    if (!hierarchies.length) return []
    return recurse(0, '')
}

// ── State initializers ────────────────────────────────────────────────────────

function initExpandedSets(hierarchies) {
    return hierarchies.map((h, i) => i === 0 ? allExpanded(h.nodes ?? {}) : new Map())
}

// ── Row hierarchy cell ─────────────────────────────────────────────────────────

function HierarchyCell(params) {
    const dimIdx     = params.colDef.context?.dimIdx ?? 0
    const ctx        = params.context ?? params.api?.getGridOption?.('context') ?? {}
    const { rowExpandedSets, onToggleRow, hierarchies } = ctx
    const h          = hierarchies?.[dimIdx]
    const nodeId     = params.data[`__d${dimIdx}__`]
    const label      = params.data[`__d${dimIdx}_label__`]
    const level      = params.data[`__d${dimIdx}_level__`] ?? 0
    const isLeaf     = params.data[`__d${dimIdx}_isLeaf__`] ?? true
    const changed    = params.data[`__d${dimIdx}_changed__`] ?? true
    const contextKey = params.data[`__d${dimIdx}_ctx__`] ?? ''
    const isOuter    = dimIdx < (hierarchies?.length ?? 1) - 1

    if (isOuter && !changed) {
        return <div className="h-full flex items-center pl-3"><div className="h-full w-px bg-border opacity-30" /></div>
    }

    let expanded
    if (dimIdx === 0) {
        expanded = rowExpandedSets?.[0] ?? new Set()
    } else {
        const map = rowExpandedSets?.[dimIdx]
        expanded  = (map instanceof Map ? map.get(contextKey) : null) ?? allExpanded(h?.nodes ?? {})
    }

    const isOpen   = expanded.has(nodeId)
    const maxLevel = h?.maxLevel ?? 0
    const indent   = Math.max(0, (maxLevel - level)) * 14

    return (
        <div className="flex items-center h-full gap-0.5 overflow-hidden" style={{ paddingLeft: `${indent}px` }}>
            <span className="w-4 shrink-0 flex items-center justify-center h-full">
                {!isLeaf && (
                    <button
                        onClick={e => { e.stopPropagation(); onToggleRow(dimIdx, nodeId, contextKey) }}
                        className="w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 text-muted-foreground transition-colors"
                    >
                        {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    </button>
                )}
            </span>
            <span className={cn('truncate text-xs', !isLeaf && 'font-semibold')}>{label}</span>
        </div>
    )
}

// ── Single-dim col header (existing behaviour) ────────────────────────────────

function SingleDimColHeader(params) {
    const { onToggleCol, colExpandedSets, colNodeMap, columnHierarchies } = params.context ?? params.api?.getGridOption?.('context') ?? {}
    const colNodes = columnHierarchies?.[0]?.nodes ?? {}
    const expanded = colExpandedSets?.[0] ?? new Set()
    const nodeId   = colNodeMap?.[params.column?.getColId()]
    const node     = nodeId ? colNodes[nodeId] : null
    const isLeaf   = !node || node.isLeaf || !node.children?.length
    const isOpen   = nodeId ? expanded.has(nodeId) : false

    return (
        <div
            className={cn('flex items-center gap-1 w-full h-full px-1 overflow-hidden', !isLeaf && 'cursor-pointer select-none')}
            onClick={() => !isLeaf && nodeId && onToggleCol(0, nodeId, '')}
        >
            {!isLeaf && <span className="text-muted-foreground shrink-0 text-[10px]">{isOpen ? '▾' : '▸'}</span>}
            <span className={cn('truncate text-xs', !isLeaf && 'font-semibold')}>{params.displayName}</span>
        </div>
    )
}

// ── Multi-dim col header (stacked rows, one per col dim) ──────────────────────

function MultiDimColHeader(params) {
    const { onToggleCol, colExpandedSets, columnHierarchies } = params.context ?? params.api?.getGridOption?.('context') ?? {}
    const tuple   = params.colDef.context?.colTuple   ?? []
    const changed = params.colDef.context?.colChanged  ?? tuple.map(() => true)

    return (
        <div className="flex flex-col w-full h-full">
            {tuple.map((nodeId, dimIdx) => {
                const h          = columnHierarchies?.[dimIdx]
                const contextKey = tuple.slice(0, dimIdx).join('::')
                const node       = h?.nodes?.[nodeId]
                const isLeaf     = !node || node.isLeaf || !node.children?.length
                const dimChanged = changed[dimIdx]

                let expanded
                if (dimIdx === 0) {
                    expanded = colExpandedSets?.[0] ?? new Set()
                } else {
                    const map = colExpandedSets?.[dimIdx]
                    expanded  = (map instanceof Map ? map.get(contextKey) : null) ?? allExpanded(h?.nodes ?? {})
                }
                const isOpen = expanded.has(nodeId)

                return (
                    <div
                        key={dimIdx}
                        style={{ height: `${HDR_ROW_H}px` }}
                        className={cn(
                            'flex items-center px-1 shrink-0 border-b border-border last:border-b-0 overflow-hidden',
                            !isLeaf && dimChanged && 'cursor-pointer select-none'
                        )}
                        onClick={() => !isLeaf && dimChanged && onToggleCol(dimIdx, nodeId, contextKey)}
                    >
                        {dimChanged ? (
                            <>
                                {!isLeaf && (
                                    <span className="text-muted-foreground shrink-0 text-[10px] mr-0.5">
                                        {isOpen ? '▾' : '▸'}
                                    </span>
                                )}
                                <span className={cn('truncate text-xs', !isLeaf && 'font-semibold')}>
                                    {node?.label ?? nodeId}
                                </span>
                            </>
                        ) : (
                            <div className="w-px h-4 bg-border opacity-40 mx-auto" />
                        )}
                    </div>
                )
            })}
        </div>
    )
}


// ── Main component ────────────────────────────────────────────────────────────

export default function HierarchyGrid({
    hierarchies       = [],
    columnHierarchies = [],
    columns           = [],
    data              = {},
    keepMode: keepModeProp  = 'parent',
    totalsPosition          = 'top',
    colTotalsPosition       = 'top',
    dark              = false,
    onCellEdit,
    onCellContextMenu,
    storageKey,         // optional: persisting column widths across sessions
}) {
    const gridRef       = useRef(null)
    const prevColDefs   = useRef(null)

    const [rowExpandedSets, setRowExpandedSets] = useState(() => initExpandedSets(hierarchies))
    const [colExpandedSets, setColExpandedSets] = useState(() => initExpandedSets(columnHierarchies))
    const keepMode = keepModeProp

    const rowKey = hierarchies.map(h => Object.keys(h.nodes ?? {}).length).join(',')
    const colKey = columnHierarchies.map(h => Object.keys(h.nodes ?? {}).length).join(',')

    useEffect(() => {
        setRowExpandedSets(initExpandedSets(hierarchies))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rowKey])

    useEffect(() => {
        setColExpandedSets(initExpandedSets(columnHierarchies))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [colKey])

    // ── Row toggle ────────────────────────────────────────────────────────────

    const toggleRow = useCallback((dimIdx, nodeId, contextKey) => {
        setRowExpandedSets(prev => {
            const next = [...prev]
            if (dimIdx === 0) {
                const s = new Set(next[0]); s.has(nodeId) ? s.delete(nodeId) : s.add(nodeId); next[0] = s
            } else {
                const h = hierarchies[dimIdx]
                const map = new Map(next[dimIdx] instanceof Map ? next[dimIdx] : [])
                const s = new Set(map.get(contextKey) ?? allExpanded(h.nodes ?? {}))
                s.has(nodeId) ? s.delete(nodeId) : s.add(nodeId)
                map.set(contextKey, s); next[dimIdx] = map
            }
            return next
        })
    }, [hierarchies])

    // ── Col toggle ────────────────────────────────────────────────────────────

    const toggleCol = useCallback((dimIdx, nodeId, contextKey) => {
        setColExpandedSets(prev => {
            const next = [...prev]
            if (dimIdx === 0) {
                const s = new Set(next[0]); s.has(nodeId) ? s.delete(nodeId) : s.add(nodeId); next[0] = s
            } else {
                const h = columnHierarchies[dimIdx]
                const map = new Map(next[dimIdx] instanceof Map ? next[dimIdx] : [])
                const s = new Set(map.get(contextKey) ?? allExpanded(h.nodes ?? {}))
                s.has(nodeId) ? s.delete(nodeId) : s.add(nodeId)
                map.set(contextKey, s); next[dimIdx] = map
            }
            return next
        })
    }, [columnHierarchies])

    const collapseAllDim = useCallback((dimIdx) => {
        setRowExpandedSets(prev => {
            const next = [...prev]
            if (dimIdx === 0) {
                next[0] = new Set()
            } else {
                const map = new Map(prev[dimIdx] instanceof Map ? prev[dimIdx] : [])
                map.set('*', new Set())
                next[dimIdx] = map
            }
            return next
        })
    }, [])

    const expandAllDim = useCallback((dimIdx) => {
        setRowExpandedSets(prev => {
            const next = [...prev]
            if (dimIdx === 0) {
                next[0] = allExpanded(hierarchies[dimIdx]?.nodes ?? {})
            } else {
                next[dimIdx] = new Map() // empty map → missing key → allExpanded default
            }
            return next
        })
    }, [hierarchies])

    // ── Column lookup ─────────────────────────────────────────────────────────

    const colByTupleKey = useMemo(() =>
        Object.fromEntries(columns.map(c => [(c.members ? c.members.join('::') : c.label), c])),
        [columns]
    )

    // For single-dim col: col.id → nodeId (for header toggle)
    const colNodeMap = useMemo(() => {
        if (!columnHierarchies.length) return {}
        const h0    = columnHierarchies[0]
        const nodes = h0?.nodes ?? {}
        const map   = {}
        for (const nodeId of Object.keys(nodes)) {
            const col = colByTupleKey[nodeId]
            if (col) map[col.id] = nodeId
        }
        return map
    }, [columnHierarchies, colByTupleKey])

    // ── Visible row tuples ────────────────────────────────────────────────────

    const totalsAtBottom   = totalsPosition === 'bottom'
    const visibleRowTuples = useMemo(() =>
        computeVisibleTuples(hierarchies, rowExpandedSets, keepMode, totalsAtBottom),
        [hierarchies, rowExpandedSets, keepMode, totalsAtBottom]
    )

    // ── Visible col tuples & columns ──────────────────────────────────────────

    const colTotalsAtBottom = colTotalsPosition === 'bottom'
    const visibleColTuples  = useMemo(() => {
        if (!columnHierarchies.length) return columns.map(c => c.members ?? [c.label])
        return computeVisibleTuples(columnHierarchies, colExpandedSets, keepMode, colTotalsAtBottom)
    }, [columnHierarchies, colExpandedSets, keepMode, colTotalsAtBottom, columns])

    const visibleColumns = useMemo(() =>
        visibleColTuples.map(tuple => colByTupleKey[tuple.join('::')]).filter(Boolean),
        [visibleColTuples, colByTupleKey]
    )

    // ── Row data ──────────────────────────────────────────────────────────────

    const rowData = useMemo(() => {
        let prevTuple = null
        const results = []
        for (const tuple of visibleRowTuples) {
            const tupleKey = tuple.join('::')
            const values   = data[tupleKey]
            if (values === undefined) continue
            const row      = { __tupleKey__: tupleKey }
            tuple.forEach((nodeId, i) => {
                const node = hierarchies[i]?.nodes[nodeId]
                row[`__d${i}__`]         = nodeId
                row[`__d${i}_label__`]   = node?.label ?? nodeId
                row[`__d${i}_level__`]   = node?.level ?? 0
                row[`__d${i}_isLeaf__`]  = node?.isLeaf ?? true
                row[`__d${i}_changed__`] = prevTuple === null || prevTuple[i] !== nodeId
                row[`__d${i}_ctx__`]     = tuple.slice(0, i).join('::')
            })
            prevTuple = tuple
            for (const col of visibleColumns) row[col.id] = values[col.id] ?? null
            results.push(row)
        }
        return results
    }, [visibleRowTuples, hierarchies, data, visibleColumns])

    // ── Row dim header (collapse/expand all) ─────────────────────────────────

    const RowDimHeader = useCallback((params) => {
        const dimIdx = params.column?.getColDef()?.context?.dimIdx ?? 0
        const { onCollapseAll, onExpandAll } = params.context ?? params.api?.getGridOption?.('context') ?? {}
        return (
            <div className="flex items-center gap-1 w-full h-full group px-1">
                <span className="flex-1 truncate text-[11px] font-semibold">{params.displayName}</span>
                <button
                    onClick={e => { e.stopPropagation(); onCollapseAll(dimIdx) }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 text-[11px] font-bold leading-none shrink-0"
                    title="Collapse all">−</button>
                <button
                    onClick={e => { e.stopPropagation(); onExpandAll(dimIdx) }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 text-[11px] font-bold leading-none shrink-0"
                    title="Expand all">+</button>
            </div>
        )
    }, [])

    // ── Column width persistence (session + localStorage) ────────────────────

    const savedWidthsRef = useRef(null)
    if (savedWidthsRef.current === null) {
        savedWidthsRef.current = storageKey
            ? (() => { try { return JSON.parse(localStorage.getItem(storageKey) || '{}') } catch { return {} } })()
            : {}
    }

    const w = (colId, fallback) => savedWidthsRef.current[colId] ?? fallback

    const persistWidths = useCallback(() => {
        if (!storageKey) return
        try { localStorage.setItem(storageKey, JSON.stringify(savedWidthsRef.current)) } catch {}
    }, [storageKey])

    const onColumnResized = useCallback((e) => {
        if (!e.finished || !e.column) return
        const colId = e.column.getColId()
        const width = e.column.getActualWidth()
        savedWidthsRef.current[colId] = width
        persistWidths()
    }, [persistWidths])

    // ── Column defs ───────────────────────────────────────────────────────────

    const multiCol = columnHierarchies.length > 1

    const colDefs = useMemo(() => {
        let prevTuple = null
        const newDefs = [
            // Pinned left: one column per row dim
            ...hierarchies.map((h, dimIdx) => ({
                field:           `__d${dimIdx}__`,
                headerName:      h.name ?? (hierarchies.length === 1 ? 'Member' : `Dim ${dimIdx + 1}`),
                headerComponent: RowDimHeader,
                pinned:          'left',
                initialWidth:    w(`__d${dimIdx}__`, dimIdx === 0 ? 190 : 150),
                minWidth:        80,
                resizable:       true,
                menuTabs:        [],
                context:         { dimIdx },
                cellRenderer:    HierarchyCell,
            })),
            // Data columns
            ...visibleColumns.map(col => {
                const tuple      = col.members ?? [col.label]
                const changed    = tuple.map((id, i) => prevTuple === null || prevTuple[i] !== id)
                prevTuple = tuple

                const nodeId    = colNodeMap[col.id]
                const colH0     = columnHierarchies[0]
                const colNode   = nodeId ? colH0?.nodes?.[nodeId] : null
                const colIsLeaf = !colNode || colNode.isLeaf || !colNode.children?.length

                return {
                    colId:           col.id,
                    field:           col.id,
                    headerName:      col.label,
                    headerComponent: multiCol ? MultiDimColHeader : (columnHierarchies.length === 1 ? SingleDimColHeader : undefined),
                    context:         { colTuple: tuple, colChanged: changed },
                    initialWidth:    w(col.id, 110),
                    minWidth:        60,
                    resizable:       true,
                    type:            'numericColumn',
                    editable:        onCellEdit ? (p) => {
                        const rowIsAllLeaf = hierarchies.every((_, i) => p.data?.[`__d${i}_isLeaf__`] ?? true)
                        return rowIsAllLeaf && colIsLeaf
                    } : false,
                    menuTabs:        [],
                    valueFormatter:  p => (p.value === null || p.value === '') ? '—' : String(p.value),
                    cellStyle:       p => {
                        const rowIsAllLeaf   = hierarchies.every((_, i) => p.data?.[`__d${i}_isLeaf__`] ?? true)
                        const isConsolidated = !rowIsAllLeaf || !colIsLeaf
                        const innerIsLeaf    = p.data?.[`__d${hierarchies.length - 1}_isLeaf__`] ?? true
                        return {
                            color:      (p.value === null || p.value === '') ? 'var(--ag-data-color, #888)' : undefined,
                            fontWeight: !innerIsLeaf ? '600' : undefined,
                            background: isConsolidated ? (dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)') : undefined,
                        }
                    },
                }
            }),
        ]  // end newDefs
        // Return same reference if columns are structurally unchanged — prevents AG Grid
        // from seeing new columnDefs and resetting user-resized widths
        const prev = prevColDefs.current
        if (prev && prev.length === newDefs.length &&
            prev.every((c, i) => c.field === newDefs[i].field && c.headerName === newDefs[i].headerName)) {
            return prev
        }
        prevColDefs.current = newDefs
        return newDefs
    }, [hierarchies, visibleColumns, colNodeMap, columnHierarchies, multiCol, onCellEdit, dark])

    // ── AG Grid context ───────────────────────────────────────────────────────

    const context = useMemo(() => ({
        hierarchies,
        rowExpandedSets,
        onToggleRow:     toggleRow,
        onCollapseAll:   collapseAllDim,
        onExpandAll:     expandAllDim,
        columnHierarchies,
        colExpandedSets,
        onToggleCol:     toggleCol,
        colNodeMap,
    }), [hierarchies, rowExpandedSets, toggleRow, collapseAllDim, expandAllDim, columnHierarchies, colExpandedSets, toggleCol, colNodeMap])

    const handleCellEdit = useCallback((e) => {
        if (!onCellEdit) return
        onCellEdit({ tupleKey: e.data.__tupleKey__, colId: e.colDef.field, value: e.newValue })
    }, [onCellEdit])

    const theme = useMemo(() => makeTheme(dark, Math.max(1, columnHierarchies.length)), [dark, columnHierarchies.length])

    // Ctrl+Shift+A — auto-size all columns
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
                gridRef.current?.api?.autoSizeAllColumns()
                e.preventDefault()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const autoSizeAll = useCallback(() => {
        gridRef.current?.api?.autoSizeAllColumns()
    }, [])

    if (!hierarchies.length) {
        return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No hierarchy data</div>
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex-1 min-h-0">
                <AgGridReact
                    ref={gridRef}
                    theme={theme}
                    columnDefs={colDefs}
                    rowData={rowData}
                    context={context}
                    getRowId={p => p.data.__tupleKey__}
                    suppressMovableColumns
                    enableCellTextSelection={!onCellEdit}
                    singleClickEdit={!!onCellEdit}
                    stopEditingWhenCellsLoseFocus
                    defaultColDef={{ sortable: false }}
                    onCellValueChanged={handleCellEdit}
                    onCellContextMenu={onCellContextMenu}
                    onColumnResized={onColumnResized}
                    onFirstDataRendered={p => { if (!Object.keys(savedWidthsRef.current).length) p.api.autoSizeAllColumns() }}
                />
            </div>
        </div>
    )
}
