import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable, useDraggable } from '@dnd-kit/core'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useCubeDimensions, useSubsets, useSubsetElements, useViews, useExecuteMDX, useViewAxes, useSaveView } from '@/hooks/useApi'
import { toast } from 'sonner'
import { RefreshCw, Loader2, Table2, GripVertical, X, LayoutGrid, Rows3, Columns3, Filter, ZapOff, Zap, ChevronLeft, ChevronRight, PencilLine, Play, Save, Code2, Eye, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

ModuleRegistry.registerModules([AllCommunityModule])

const lightTheme = themeBalham.withPart(colorSchemeLight).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })
const darkTheme  = themeBalham.withPart(colorSchemeDark).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })

// ── MDX builder ───────────────────────────────────────────────────────────────

function buildMDX({ cube, rows, columns, pages, suppressZeros }) {
    const memberSet = ({ dimension: dim, subset, member }) => {
        if (member) return `{[${dim}].[${dim}].[${member}]}`
        if (subset)  return `TM1SubsetToSet([${dim}], "${subset}")`
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

    const cols = colTuples.map(t => (t.Members ?? []).map(m => m.Name).join(' / '))
    const rowDimNames = (rowTuples[0]?.Members ?? []).map(m => parseDimFromUniqueName(m.UniqueName))
    const rows = rowTuples.map(t => (t.Members ?? []).map(m => m.Name))

    const numCols = cols.length
    const cellMap = {}
    ;(data.Cells ?? []).forEach(c => { cellMap[c.Ordinal] = c })

    const grid = (rows.length ? rows : [[]]).map((_, ri) =>
        cols.map((_, ci) => {
            const c = cellMap[ri * numCols + ci]
            if (!c) return ''
            const fv = c.FormattedValue
            if (fv !== '' && fv != null) return fv
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

function SubsetPopover({ server, dim, zone, subsets, onSubsetSelect, onMemberSelect, onEditSubset, onClose }) {
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
                <div key={s.Name} className="flex items-center group">
                    <button onClick={() => handleSubset(s.Name)}
                        className={cn('flex-1 px-3 py-1 hover:bg-muted text-left font-mono truncate',
                            pickedSubset === s.Name && 'text-primary font-medium')}>
                        {s.Name}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onEditSubset?.(dim.dimension, s.Name) }}
                        className="opacity-0 group-hover:opacity-100 px-1 py-1 text-muted-foreground hover:text-foreground shrink-0 transition-opacity"
                        title={`Edit "${s.Name}"`}>
                        <PencilLine size={10} />
                    </button>
                </div>
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
    }, [open])

    const label = dim.member ?? dim.subset ?? (zone === 'bench' ? null : 'Members')

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
                    onEditSubset={onEditSubset}
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

// ── Main ViewEditor ───────────────────────────────────────────────────────────

export default function ViewEditor({ tab }) {
    const { dark, openTab } = useStore()
    const { data: cubeDims = [] } = useCubeDimensions(tab.server, tab.cube)
    const { data: views    = [] } = useViews(tab.server, tab.cube)
    const executeMDX   = useExecuteMDX()
    const loadViewAxes = useViewAxes()
    const saveView     = useSaveView()

    // Visual builder state
    const [axes, setAxes] = useState({ rows: [], columns: [], pages: [] })
    const [suppressZeros, setSuppressZeros] = useState(true)
    const [activeDrag, setActiveDrag] = useState(null)

    // MDX editor state
    const [mdx, setMdx] = useState('')
    const [mdxDirty, setMdxDirty] = useState(false)
    const editorRef = useRef(null)

    // Results
    const [result, setResult] = useState(null)

    // View type: track if original was native (warn on save)
    const [viewType, setViewType] = useState(null)

    // View mode: 'visual' | 'mdx'
    const [mode, setMode] = useState(tab.mode ?? 'visual')

    // Loading guard using state (not ref) to survive StrictMode remounts
    const [loadedKey, setLoadedKey] = useState(null)

    const bench = useMemo(() => {
        const placed = new Set([...axes.rows, ...axes.columns, ...axes.pages].map(d => d.dimension))
        return cubeDims.filter(d => !placed.has(d)).map(d => ({ dimension: d, subset: null, member: null }))
    }, [cubeDims, axes])

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

    // ── Load existing view ──────────────────────────────────────────────────
    useEffect(() => {
        if (!tab.viewName || !cubeDims.length) return
        const key = `${tab.server}:${tab.cube}:${tab.viewName}`
        if (loadedKey === key) return
        setLoadedKey(key)
        setResult(null)

        const id = toast.loading(`Loading ${tab.viewName}…`)
        loadViewAxes.mutate(
            { server: tab.server, cube: tab.cube, view: tab.viewName },
            {
                onSuccess: ({ axisConfig, cellset, viewType: vt }) => {
                    const make = (dim, member = null) => ({ dimension: dim, subset: null, member })
                    let cols  = (axisConfig.find(a => a.ordinal === 0)?.dimensions ?? []).map(d => make(d))
                    let rows  = (axisConfig.find(a => a.ordinal === 1)?.dimensions ?? []).map(d => make(d))
                    const pages = (axisConfig.find(a => a.ordinal === 2)?.selectedMembers ?? []).map(({ dimension, member }) => make(dimension, member))
                    if (!cols.length && cubeDims.length) cols = [make(cubeDims[0])]
                    if (!rows.length && cubeDims.length > 1) rows = [make(cubeDims[1])]
                    setAxes({ rows, columns: cols, pages })
                    setResult(cellset)
                    setViewType(vt ?? null)
                    setMdx(buildMDX({ cube: tab.cube, rows, columns: cols, pages, suppressZeros: true }))
                    setMdxDirty(false)
                    toast.success(`Loaded ${tab.viewName}`, { id })
                },
                onError: e => {
                    toast.error(e.message, { id })
                    setLoadedKey(null)
                },
            }
        )
    }, [tab.viewName, cubeDims])

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

    const handleExecute = useCallback(() => {
        const query = mode === 'mdx' ? mdx : buildMDX({ cube: tab.cube, ...axes, suppressZeros })
        if (!query.trim()) {
            toast.error('No MDX to execute')
            return
        }
        const id = toast.loading('Executing…')
        executeMDX.mutate(
            { server: tab.server, mdx: query },
            {
                onSuccess: data => { setResult(data); toast.success('Done', { id }) },
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
    useEffect(() => {
        if (mode !== 'visual') return
        setMdx(buildMDX({ cube: tab.cube, ...axes, suppressZeros }))
        setMdxDirty(false)
    }, [axes, suppressZeros, mode])

    const handleSave = useCallback(() => {
        const name = tab.viewName ?? prompt('View name?')
        if (!name) return
        const query = mode === 'mdx' ? mdx : buildMDX({ cube: tab.cube, ...axes, suppressZeros })
        const id = toast.loading('Saving view…')
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name, mdx: query },
            {
                onSuccess: () => {
                    setMdxDirty(false)
                    toast.success(`Saved "${name}"`, { id })
                },
                onError: e => toast.error(e.message, { id }),
            }
        )
    }, [mode, mdx, axes, suppressZeros, tab.server, tab.cube, tab.viewName])

    const handleSaveAs = useCallback(() => {
        const name = prompt('Save view as…')
        if (!name) return
        const query = mode === 'mdx' ? mdx : buildMDX({ cube: tab.cube, ...axes, suppressZeros })
        const id = toast.loading(`Saving "${name}"…`)
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name, mdx: query },
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
    }, [mode, mdx, axes, suppressZeros, tab.server, tab.cube, openTab])

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

    const parsed = useMemo(() => result ? parseCellset(result) : null, [result])
    const { colDefs, rowData } = useMemo(() => buildGridData(parsed), [parsed])

    const allDims = useMemo(() => [...axes.rows, ...axes.columns, ...axes.pages, ...bench], [axes, bench])
    const activeDim = activeDrag ? allDims.find(d => d.dimension === activeDrag) : null

    const isLoadingView = loadViewAxes.isPending
    const isExecuting   = executeMDX.isPending

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
                <span className="text-xs font-mono text-muted-foreground truncate">
                    {tab.cube}
                    {tab.viewName && <>
                        <span className="mx-1 text-muted-foreground/40">/</span>
                        <span className="text-foreground">{tab.viewName}</span>
                    </>}
                </span>

                {/* Mode toggle */}
                <div className="flex items-center gap-0.5 bg-muted rounded p-0.5">
                    <button onClick={() => setMode('visual')}
                        className={cn('flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors',
                            mode === 'visual' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                        <Eye size={10} /> Visual
                    </button>
                    <button onClick={() => setMode('mdx')}
                        className={cn('flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors',
                            mode === 'mdx' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                        <Code2 size={10} /> MDX
                    </button>
                </div>

                <div className="flex-1" />

                <button onClick={() => setSuppressZeros(v => !v)}
                    title={suppressZeros ? 'Zero suppression on' : 'Zero suppression off'}
                    className={cn('flex items-center justify-center p-1.5 rounded border border-border transition-colors',
                        suppressZeros ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted')}>
                    {suppressZeros ? <Zap size={12} /> : <ZapOff size={12} />}
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
                        {views.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                )}

                {tab.viewName ? (
                    <div className="flex items-center">
                        <button onClick={handleSave}
                            disabled={mode === 'mdx' && !mdxDirty}
                            title="Save (Ctrl+S)"
                            className={cn('flex items-center gap-1 px-2 py-1 rounded-l text-xs border border-r-0 transition-colors',
                                (mode === 'mdx' && mdxDirty) || mode === 'visual'
                                    ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                                    : 'border-border text-muted-foreground hover:bg-muted')}>
                            <Save size={11} /> Save
                        </button>
                        <button onClick={handleSaveAs}
                            title="Save As… (Ctrl+Shift+S)"
                            className={cn('flex items-center px-1 py-1 rounded-r text-xs border transition-colors',
                                (mode === 'mdx' && mdxDirty) || mode === 'visual'
                                    ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                                    : 'border-border text-muted-foreground hover:bg-muted')}>
                            <ChevronDown size={10} />
                        </button>
                    </div>
                ) : (
                    <button onClick={handleSaveAs}
                        title="Save As… (Ctrl+Shift+S)"
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:bg-muted transition-colors">
                        <Save size={11} /> Save As
                    </button>
                )}

                <button onClick={handleExecute} disabled={isExecuting || isLoadingView}
                    title="Execute / Refresh (Ctrl+Enter)"
                    className={cn('flex items-center justify-center p-1.5 rounded border border-border transition-colors',
                        isExecuting ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted')}>
                    {isExecuting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                </button>
            </div>

            {/* Native view warning */}
            {viewType && viewType.includes('NativeView') && (
                <div className="shrink-0 px-3 py-1 border-b border-border bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 text-[10px] flex items-center gap-1">
                    <ZapOff size={10} />
                    <span>Native view — saving will convert it to MDX.</span>
                </div>
            )}

            {/* Visual builder */}
            {mode === 'visual' && (
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
            )}

            {/* MDX editor */}
            {mode === 'mdx' && (
                <div className="shrink-0 h-48 border-b border-border flex flex-col min-h-0">
                    <MonacoEditor
                        height="100%"
                        language="plaintext"
                        value={mdx}
                        theme={dark ? 'vs-dark' : 'vs'}
                        onChange={v => { setMdx(v ?? ''); setMdxDirty(true) }}
                        onMount={(editor, monaco) => {
                            editorRef.current = editor
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, handleSave)
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, handleExecute)
                        }}
                        options={{
                            fontSize: 12,
                            minimap: { enabled: false },
                            wordWrap: 'on',
                            scrollBeyondLastLine: false,
                            lineNumbers: 'off',
                            folding: false,
                        }}
                    />
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
