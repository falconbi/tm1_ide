import { useState, useMemo } from 'react'
import { useDims, useCubeDimensions, useCreateCube, useDeleteCube, useControlObjects } from '@/hooks/useApi'
import { useStore } from '@/store'
import { Box, Code2, Table2, Trash2, ChevronUp, ChevronDown, X, Plus, Star, Loader2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export default function CubeEditor({ tab }) {
    const { server: storeServer, openTab, closeTab } = useStore()
    const server = tab.server ?? storeServer
    const isNew  = !tab.cube

    const [name, setName]         = useState('')
    const [selected, setSelected] = useState([])
    const [dimSearch, setDimSearch] = useState('')
    const [showControl, setShowControl] = useState(false)

    const { data: allDims  = [], isLoading: loadingDims  } = useDims(server)
    const { data: cubeDims = [], isLoading: loadingCubeDims } = useCubeDimensions(server, tab.cube)
    const { data: control   = {} } = useControlObjects(showControl ? server : null)

    const createCube = useCreateCube()
    const deleteCube = useDeleteCube()

    const available = useMemo(() => {
        const sel = new Set(selected)
        const q   = dimSearch.toLowerCase()
        const dims = showControl ? [...allDims, ...(control.dimensions ?? [])] : allDims
        return dims.filter(d => !sel.has(d) && (!q || d.toLowerCase().includes(q)))
    }, [allDims, control.dimensions, selected, dimSearch, showControl])

    const addDim    = (dim) => setSelected(p => [...p, dim])
    const removeDim = (dim) => setSelected(p => p.filter(d => d !== dim))
    const moveUp    = (i)   => setSelected(p => { const a = [...p]; [a[i-1], a[i]] = [a[i], a[i-1]]; return a })
    const moveDown  = (i)   => setSelected(p => { const a = [...p]; [a[i], a[i+1]] = [a[i+1], a[i]]; return a })

    const handleCreate = () => {
        if (!name.trim())        { toast.error('Enter a cube name'); return }
        if (selected.length < 2) { toast.error('Add at least 2 dimensions'); return }
        const id = toast.loading(`Creating "${name.trim()}"…`)
        createCube.mutate({ server, name: name.trim(), dims: selected }, {
            onSuccess: () => {
                toast.success(`Cube "${name.trim()}" created`, { id })
                closeTab(tab.id)
                openTab({ id: `cubeview:${server}:${name.trim()}`, type: 'cubeview', label: `⊞ ${name.trim()}`, server, cube: name.trim() })
            },
            onError: e => toast.error(e.message, { id }),
        })
    }

    const handleDelete = () => {
        if (!window.confirm(`Delete cube "${tab.cube}"? This cannot be undone.`)) return
        const id = toast.loading(`Deleting "${tab.cube}"…`)
        deleteCube.mutate({ server, name: tab.cube }, {
            onSuccess: () => { toast.success(`Deleted "${tab.cube}"`, { id }); closeTab(tab.id) },
            onError:   e => toast.error(e.message, { id }),
        })
    }

    const displayDims = isNew ? selected : cubeDims

    return (
        <div className="flex flex-col h-full min-h-0 bg-background">

            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
                <Box size={14} className="text-muted-foreground shrink-0" />
                {isNew ? (
                    <input value={name} onChange={e => setName(e.target.value)}
                        placeholder="Cube name…" autoFocus
                        onKeyDown={e => e.key === 'Enter' && handleCreate()}
                        className="text-sm font-semibold bg-transparent outline-none border-b border-border/60 focus:border-primary pb-0.5 w-64 transition-colors placeholder:font-normal placeholder:text-muted-foreground" />
                ) : (
                    <span className="text-sm font-semibold">{tab.cube}</span>
                )}
                <div className="flex-1" />
                {!isNew && (
                    <>
                        <button onClick={() => openTab({ id: `rules:${server}:${tab.cube}`, type: 'rules', label: tab.cube, server, cube: tab.cube, content: null })}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors">
                            <Code2 size={11} /> Rules
                        </button>
                        <button onClick={() => openTab({ id: `cubeview:${server}:${tab.cube}`, type: 'cubeview', label: `⊞ ${tab.cube}`, server, cube: tab.cube })}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors">
                            <Table2 size={11} /> View
                        </button>
                        <button onClick={handleDelete} disabled={deleteCube.isPending}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                            {deleteCube.isPending ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Delete
                        </button>
                    </>
                )}
                {isNew && (
                    <button onClick={handleCreate} disabled={!name.trim() || selected.length < 2 || createCube.isPending}
                        className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors">
                        {createCube.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Create Cube
                    </button>
                )}
            </div>

            {/* Body */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

                {/* Left: available dims (new mode only) */}
                {isNew && (
                    <div className="w-64 shrink-0 border-r border-border flex flex-col">
                        <div className="px-3 py-2 border-b border-border shrink-0">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Available Dimensions</span>
                                <button onClick={() => setShowControl(v => !v)}
                                    className={cn('flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors',
                                        showControl ? 'text-amber-400 hover:text-amber-300' : 'text-muted-foreground hover:text-foreground')}
                                    title={showControl ? 'Hide control objects' : 'Show control objects'}>
                                    {showControl ? <Eye size={10} /> : <EyeOff size={10} />}
                                    Control
                                </button>
                            </div>
                            <input value={dimSearch} onChange={e => setDimSearch(e.target.value)}
                                placeholder="Filter…"
                                className="w-full text-xs px-2 py-1 rounded border border-border bg-background outline-none" />
                        </div>
                        <div className="flex-1 overflow-auto">
                            {loadingDims
                                ? <div className="flex items-center justify-center h-16"><Loader2 size={14} className="animate-spin text-muted-foreground" /></div>
                                : available.length === 0
                                ? <p className="px-3 py-3 text-xs text-muted-foreground italic">No dimensions available</p>
                                : available.map(d => (
                                    <button key={d} onClick={() => addDim(d)}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted text-left font-mono group transition-colors">
                                        <Plus size={10} className="shrink-0 text-muted-foreground/30 group-hover:text-primary transition-colors" />
                                        <span className="truncate">{d}</span>
                                    </button>
                                ))
                            }
                        </div>
                    </div>
                )}

                {/* Right: cube dimension list */}
                <div className="flex-1 flex flex-col p-5 min-h-0 overflow-auto">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
                        Dimensions
                        <span className="ml-1 font-normal normal-case opacity-60">({displayDims.length})</span>
                    </div>

                    {!isNew && loadingCubeDims ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 size={13} className="animate-spin" /> Loading…
                        </div>
                    ) : displayDims.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">
                            {isNew ? 'Add dimensions from the panel on the left' : 'No dimensions'}
                        </p>
                    ) : (
                        <div className="space-y-1.5 max-w-lg">
                            {displayDims.map((dim, i) => {
                                const isLast = i === displayDims.length - 1
                                return (
                                    <div key={dim} className={cn(
                                        'flex items-center gap-2.5 px-3 py-2 rounded border bg-background transition-colors',
                                        isLast ? 'border-amber-400/50 bg-amber-400/5' : 'border-border'
                                    )}>
                                        <span className="text-[10px] text-muted-foreground/40 w-5 shrink-0 text-right tabular-nums">{i + 1}</span>
                                        <span className="flex-1 text-xs font-mono truncate">{dim}</span>
                                        {isLast && <Star size={10} className="shrink-0 text-amber-400" title="Measures dimension" />}
                                        {isNew && (
                                            <div className="flex items-center gap-0.5 shrink-0 ml-1">
                                                <button onClick={() => moveUp(i)} disabled={i === 0}
                                                    className="p-0.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-20 transition-colors">
                                                    <ChevronUp size={12} />
                                                </button>
                                                <button onClick={() => moveDown(i)} disabled={i === displayDims.length - 1}
                                                    className="p-0.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-20 transition-colors">
                                                    <ChevronDown size={12} />
                                                </button>
                                                <button onClick={() => removeDim(dim)}
                                                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-red-400 transition-colors ml-0.5">
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {isNew && selected.length >= 2 && (
                        <p className="mt-4 text-[10px] text-amber-400/70 flex items-center gap-1">
                            <Star size={9} /> Last dimension is treated as the measures dimension
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}
