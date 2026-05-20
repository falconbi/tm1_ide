import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable, useDraggable } from '@dnd-kit/core'
import { useStore } from '@/store'
import { useCubeDimensions, useSubsets, useSubsetElements, useViews, useExecuteMDX, useViewAxes } from '@/hooks/useApi'
import { toast } from 'sonner'
import { Play, Loader2, Table2, GripVertical, X, LayoutGrid, Rows3, Columns3, Filter, ZapOff, Zap, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

ModuleRegistry.registerModules([AllCommunityModule])

const lightTheme = themeBalham.withPart(colorSchemeLight).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })
const darkTheme  = themeBalham.withPart(colorSchemeDark).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })

// ── MDX builder ───────────────────────────────────────────────────────────────

function buildMDX({ cube, rows, columns, pages, suppressZeros }) {
    const memberSet = ({ dimension: dim, subset, member }) => {
        if (member) return `{[${dim}].[${dim}].[${member}]}`
        if (subset)  return `{[${dim}].[${dim}].[${subset}]}`
        return `{[${dim}].[${dim}].Members}`
    }
    const axisExpr = (placements) => {
        if (!placements.length) return null
        const sets = placements.map(memberSet)
        const joined = sets.length === 1 ? sets[0] : `CrossJoin(${sets.join(', ')})`
        return suppressZeros ? `NON EMPTY ${joined}` : joined
    }
    const colExpr = axisExpr(columns) ?? '{}'
    const rowExpr = axisExpr(rows)
    const axes = [`${colExpr} ON COLUMNS`]
    if (rowExpr) axes.push(`${rowExpr} ON ROWS`)
    let mdx = `SELECT ${axes.join(',\n       ')}\nFROM [${cube}]`
    if (pages.length) {
        const slicers = pages.map(({ dimension: dim, member }) => `[${dim}].[${dim}].[${member ?? dim}]`)
        mdx += `\nWHERE (${slicers.join(', ')})`
    }
    return mdx
}

// ── Cellset → AG Grid ─────────────────────────────────────────────────────────

function parseDimFromUniqueName(un) {
    return un?.match(/^\[([^\]]+)\]/)?.[1] ?? ''
}

function parseCellset(data) {
    if (!data?.Axes?.length) return null
    const colAx = data.Axes.find(a => a.Ordinal === 0)
    const rowAx = data.Axes.find(a => a.Ordinal === 1)
    if (!colAx) return null

    const colTuples = colAx.Tuples ?? []
    const rowTuples = rowAx ? (rowAx.Tuples ?? []) : []

    // Column headers — join multi-member tuples
    const cols = colTuples.map(t => (t.Members ?? []).map(m => m.Name).join(' / '))

    // Row headers — keep as arrays for multi-dim split
    const rowDimNames = (rowTuples[0]?.Members ?? []).map(m => parseDimFromUniqueName(m.UniqueName))
    const rows = rowTuples.map(t => (t.Members ?? []).map(m => m.Name))

    const numCols = cols.length
    const cellMap = {}
    ;(data.Cells ?? []).forEach(c => { cellMap[c.Ordinal] = c })

    const grid = (rows.length ? rows : [[]]).map((_, ri) =>
        cols.map((_, ci) => {
            const c = cellMap[ri * numCols + ci]
            return c ? (c.FormattedValue ?? c.Value ?? '') : ''
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
            // Visually deduplicate outer dimensions
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
            field: `c${i}`, headerName: c, width: 110, minWidth: 60, resizable: true, type: 'numericColumn',
            valueFormatter: p => (p.value === '' || p.value == null) ? '—' : String(p.value),
            cellStyle: p => (p.value === '' || p.value == null) ? { color: '#888' } : {},
        })),
    ]

    const rowData = grid.map((row, ri) => {
        const obj = {}
        const members = rows[ri] ?? []
        Array.from({ length: rowDimCount }, (_, i) => { obj[`__row_${i}__`] = members[i] ?? '' })
        row.forEach((v, ci) => { obj[`c${ci}`] = v })
        return obj
    })

    return { colDefs, rowData }
}

// ── Subset/member popover ─────────────────────────────────────────────────────

function SubsetPopover({ server, dim, zone, subsets, onSubsetSelect, onMemberSelect, onClose }) {
    const [pickedSubset, setPickedSubset] = useState(dim.subset ?? '')
    const { data: elements = [], isLoading } = useSubsetElements(
        zone === 'pages' && pickedSubset ? server : null,
        zone === 'pages' && pickedSubset ? dim.dimension : null,
        zone === 'pages' && pickedSubset ? pickedSubset : null,
    )

    const handleSubset = (name) => {
        setPickedSubset(name)
        onSubsetSelect(name || null)
        if (zone !== 'pages') onClose()
    }

    return (
        <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded shadow-lg w-52 max-h-72 overflow-auto text-xs">
            <div className="px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold border-b border-border sticky top-0 bg-popover">
                Subset
            </div>
            <button onClick={() => handleSubset('')}
                className={cn('flex w-full px-3 py-1 hover:bg-muted text-left', !pickedSubset && 'text-primary font-medium')}>
                All Members
            </button>
            {subsets.map(s => (
                <button key={s.Name} onClick={() => handleSubset(s.Name)}
                    className={cn('flex w-full px-3 py-1 hover:bg-muted text-left font-mono truncate',
                        pickedSubset === s.Name && 'text-primary font-medium')}>
                    {s.Name}
                </button>
            ))}

            {zone === 'pages' && pickedSubset && (
                <>
                    <div className="px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold border-t border-b border-border mt-1 sticky top-7 bg-popover">
                        Member
                    </div>
                    {isLoading
                        ? <div className="px-3 py-1 text-muted-foreground flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Loading…</div>
                        : elements.map(el => (
                            <button key={el.name} onClick={() => { onMemberSelect(el.name); onClose() }}
                                className={cn('flex w-full px-3 py-1 hover:bg-muted text-left font-mono truncate',
                                    dim.member === el.name && 'text-primary font-medium')}>
                                {el.name}
                            </button>
                        ))
                    }
                </>
            )}
        </div>
    )
}

// ── Draggable dimension pill ──────────────────────────────────────────────────

function DimPill({ id, dim, zone, server, onRemove, onSubsetChange, onMemberChange, onMoveLeft, onMoveRight }) {
    const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id })
    const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `dim:${dim.dimension}` })
    const { data: subsets = [] } = useSubsets(server, dim.dimension)
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    useEffect(() => {
        if (!open) return
        const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    const label = dim.subset
        ? `${dim.subset}${dim.member ? ` › ${dim.member}` : ''}`
        : null

    return (
        <div ref={ref} className="relative">
            <div
                ref={el => { setDragRef(el); setDropRef(el) }}
                className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded border text-xs bg-muted border-border select-none group',
                    isDragging && 'opacity-40',
                    isOver && !isDragging && 'border-primary border-l-[3px]',
                    open && 'border-primary'
                )}
            >
                <span {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground shrink-0">
                    <GripVertical size={11} />
                </span>
                <button
                    onClick={() => zone !== 'bench' && setOpen(o => !o)}
                    className="font-mono truncate max-w-[100px] text-left"
                    title={dim.dimension}
                >
                    {dim.dimension}
                </button>
                {label && (
                    <span className="text-[10px] text-primary/70 truncate max-w-[80px] shrink-0">{label}</span>
                )}
                {zone !== 'bench' && (
                    <div className="flex items-center ml-0.5">
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
                    </div>
                )}
            </div>

            {open && (
                <SubsetPopover
                    server={server} dim={dim} zone={zone} subsets={subsets}
                    onSubsetSelect={name => onSubsetChange(dim.dimension, name)}
                    onMemberSelect={name => onMemberChange(dim.dimension, name)}
                    onClose={() => setOpen(false)}
                />
            )}
        </div>
    )
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({ id, label, icon: Icon, dims, server, onRemove, onSubsetChange, onMemberChange, onReorder, accent }) {
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
                        onSubsetChange={onSubsetChange} onMemberChange={onMemberChange}
                        onMoveLeft={i > 0 ? () => onReorder(i, i - 1) : null}
                        onMoveRight={i < dims.length - 1 ? () => onReorder(i, i + 1) : null}
                    />
                ))}
                {dims.length === 0 && (
                    <span className="text-[10px] text-muted-foreground/40 italic px-1">Drop here</span>
                )}
            </div>
        </div>
    )
}

// ── Main CubeViewer ───────────────────────────────────────────────────────────

export default function CubeViewer({ tab }) {
    const { dark } = useStore()
    const { data: cubeDims = [] } = useCubeDimensions(tab.server, tab.cube)
    const { data: views    = [] } = useViews(tab.server, tab.cube)
    const executeMDX  = useExecuteMDX()
    const loadViewAxes = useViewAxes()

    const [axes, setAxes] = useState({ rows: [], columns: [], pages: [] })
    const [result, setResult] = useState(null)
    const [suppressZeros, setSuppressZeros] = useState(true)
    const [activeDrag, setActiveDrag] = useState(null)

    const viewLoaded = useRef(false)

    // Default layout for plain cube open (no saved view)
    useEffect(() => {
        if (tab.viewName || !cubeDims.length || axes.columns.length || axes.rows.length) return
        const make = dim => ({ dimension: dim, subset: null, member: null })
        setAxes({
            columns: cubeDims.slice(0, 1).map(make),
            rows:    cubeDims.slice(1, 2).map(make),
            pages:   [],
        })
    }, [cubeDims])

    // Auto-load saved view once cubeDims are ready
    useEffect(() => {
        if (!tab.viewName || !cubeDims.length || viewLoaded.current) return
        viewLoaded.current = true
        handleLoadView(tab.viewName)
    }, [cubeDims])

    const bench = useMemo(() => {
        const placed = new Set([...axes.rows, ...axes.columns, ...axes.pages].map(d => d.dimension))
        return cubeDims.filter(d => !placed.has(d)).map(d => ({ dimension: d, subset: null, member: null }))
    }, [cubeDims, axes])

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

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
        if (overId === `dim:${dimName}`) return  // dropped on self

        let toZone, insertBeforeDim = null
        if (overId.startsWith('dim:')) {
            insertBeforeDim = overId.slice(4)
            toZone = findZone(insertBeforeDim)
        } else {
            if (!['rows', 'columns', 'pages', 'bench'].includes(overId)) return
            toZone = overId
        }

        const fromZone = findZone(dimName)
        setAxes(prev => {
            const existing = [...prev.rows, ...prev.columns, ...prev.pages, ...bench]
                .find(d => d.dimension === dimName) ?? { dimension: dimName, subset: null, member: null }
            const next = {
                rows:    prev.rows.filter(d => d.dimension !== dimName),
                columns: prev.columns.filter(d => d.dimension !== dimName),
                pages:   prev.pages.filter(d => d.dimension !== dimName),
            }
            if (toZone === 'bench') return next
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
            const update = zone => zone.map(d => d.dimension === dimName ? { ...d, subset, member: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const setMember = useCallback((dimName, member) => {
        setAxes(prev => {
            const update = zone => zone.map(d => d.dimension === dimName ? { ...d, member } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const handleLoadView = (viewName) => {
        if (!viewName) return
        const id = toast.loading(`Loading ${viewName}…`)
        loadViewAxes.mutate(
            { server: tab.server, cube: tab.cube, view: viewName },
            {
                onSuccess: ({ axisConfig, cellset }) => {
                    const make = (dim, member = null) => ({ dimension: dim, subset: null, member })
                    let cols  = (axisConfig.find(a => a.ordinal === 0)?.dimensions ?? []).map(d => make(d))
                    let rows  = (axisConfig.find(a => a.ordinal === 1)?.dimensions ?? []).map(d => make(d))
                    const pages = (axisConfig.find(a => a.ordinal === 2)?.selectedMembers ?? []).map(({ dimension, member }) => make(dimension, member))
                    // fallback if view returned no tuple data (e.g. NON EMPTY with no results)
                    if (!cols.length && cubeDims.length) cols = [make(cubeDims[0])]
                    if (!rows.length && cubeDims.length > 1) rows = [make(cubeDims[1])]
                    setAxes({ rows, columns: cols, pages })
                    setResult(cellset)
                    toast.success(`Loaded ${viewName}`, { id })
                },
                onError: e => toast.error(e.message, { id }),
            }
        )
    }

    const handleExecute = () => {
        if (!axes.columns.length && !axes.rows.length) {
            toast.error('Add at least one dimension to rows or columns')
            return
        }
        const mdx = buildMDX({ cube: tab.cube, ...axes, suppressZeros })
        const id  = toast.loading('Executing…')
        executeMDX.mutate(
            { server: tab.server, mdx },
            {
                onSuccess: data => { setResult(data); toast.success('Done', { id }) },
                onError:   e    => toast.error(e.message, { id }),
            }
        )
    }

    const parsed = useMemo(() => result ? parseCellset(result) : null, [result])
    const { colDefs, rowData } = useMemo(() => buildGridData(parsed), [parsed])

    const allDims = useMemo(() => [...axes.rows, ...axes.columns, ...axes.pages, ...bench], [axes, bench])
    const activeDim = activeDrag ? allDims.find(d => d.dimension === activeDrag) : null

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
                <span className="text-xs font-mono text-muted-foreground">{tab.cube}</span>
                {views.length > 0 && (
                    <select defaultValue=""
                        onChange={e => { handleLoadView(e.target.value); e.target.value = '' }}
                        disabled={loadViewAxes.isPending}
                        className="text-xs px-2 py-0.5 rounded border border-border bg-background text-muted-foreground">
                        <option value="">Load view…</option>
                        {views.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                )}
                <div className="flex-1" />
                <button onClick={() => setSuppressZeros(v => !v)}
                    className={cn('flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors',
                        suppressZeros ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-muted')}>
                    {suppressZeros ? <Zap size={11} /> : <ZapOff size={11} />}
                    {suppressZeros ? 'NON EMPTY' : 'All Cells'}
                </button>
                <button onClick={handleExecute} disabled={executeMDX.isPending || loadViewAxes.isPending}
                    className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {executeMDX.isPending ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                    Execute
                </button>
            </div>

            {/* Axis builder */}
            <DndContext sensors={sensors} onDragStart={({ active }) => setActiveDrag(active.id)} onDragEnd={handleDragEnd}>
                <div className="shrink-0 px-3 py-2 border-b border-border bg-muted/10 grid grid-cols-4 gap-2">
                    <DropZone id="columns" label="Columns" icon={Columns3} dims={axes.columns} server={tab.server} onRemove={removeDim} onSubsetChange={setSubset} onMemberChange={setMember} onReorder={(f,t) => reorderDim('columns',f,t)} accent="text-blue-400" />
                    <DropZone id="rows"    label="Rows"    icon={Rows3}    dims={axes.rows}    server={tab.server} onRemove={removeDim} onSubsetChange={setSubset} onMemberChange={setMember} onReorder={(f,t) => reorderDim('rows',f,t)}    accent="text-green-400" />
                    <DropZone id="pages"   label="Filter"  icon={Filter}   dims={axes.pages}   server={tab.server} onRemove={removeDim} onSubsetChange={setSubset} onMemberChange={setMember} onReorder={(f,t) => reorderDim('pages',f,t)}   accent="text-amber-400" />
                    <DropZone id="bench"   label="Bench"   icon={LayoutGrid} dims={bench}      server={tab.server} onRemove={() => {}}  onSubsetChange={() => {}}  onMemberChange={() => {}}  onReorder={() => {}}                           accent="text-muted-foreground" />
                </div>
                <DragOverlay>
                    {activeDim && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded border text-xs bg-muted border-primary shadow-lg">
                            <GripVertical size={11} /><span className="font-mono">{activeDim.dimension}</span>
                        </div>
                    )}
                </DragOverlay>
            </DndContext>

            {/* Grid */}
            {!result ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm select-none">
                    <div className="text-center">
                        <Table2 size={32} className="mx-auto mb-2 opacity-30" />
                        <p>Arrange dimensions then press Execute</p>
                    </div>
                </div>
            ) : !parsed || parsed.grid.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No data returned</div>
            ) : (
                <div className="flex-1 min-h-0">
                    <AgGridReact
                        theme={dark ? darkTheme : lightTheme}
                        columnDefs={colDefs}
                        rowData={rowData}
                        suppressMovableColumns
                        enableCellTextSelection
                        defaultColDef={{ sortable: false }}
                        onFirstDataRendered={p => p.api.autoSizeAllColumns()}
                    />
                </div>
            )}
        </div>
    )
}
