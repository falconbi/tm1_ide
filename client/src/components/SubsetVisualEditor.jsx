import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useStore } from '@/store'
import { useElements, useEdges, useSubsets, useSubsetElements, useSaveStaticSubset, useSaveSubset, useDimAttributes } from '@/hooks/useApi'
import { toast } from 'sonner'
import { ChevronRight, ChevronDown, Loader2, Search, ArrowUp, ArrowDown, Trash2, Settings2, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

const TYPE_ICON  = { N: '○', C: '◆', S: '"' }
const TYPE_COLOR = { N: 'text-blue-400', C: 'text-orange-400', S: 'text-green-400' }

const enc = encodeURIComponent

// ── Tree helpers ──────────────────────────────────────────────────────────────

function buildMaps(elements, edges) {
    const elementMap = {}
    elements.forEach(el => { elementMap[el.Name] = el })
    const childrenMap = {}
    const parentMap = {}
    edges.forEach(e => {
        if (!childrenMap[e.ParentName]) childrenMap[e.ParentName] = []
        childrenMap[e.ParentName].push(e.ComponentName)
        if (!parentMap[e.ComponentName]) parentMap[e.ComponentName] = e.ParentName
    })
    const hasParent = new Set(edges.map(e => e.ComponentName))
    const roots = elements.filter(e => !hasParent.has(e.Name)).map(e => e.Name)
    return { elementMap, childrenMap, parentMap, roots }
}

function flattenTree(names, childrenMap, elementMap, expandedNodes, parentMap, depth = 0) {
    const rows = []
    for (const name of names) {
        const el = elementMap[name]
        if (!el) continue
        const children = childrenMap[name] ?? []
        rows.push({ ...el, depth, hasChildren: children.length > 0, parent: parentMap[name] ?? '' })
        if (expandedNodes.has(name) && children.length > 0) {
            rows.push(...flattenTree(children, childrenMap, elementMap, expandedNodes, parentMap, depth + 1))
        }
    }
    return rows
}

// ── Column configurator ───────────────────────────────────────────────────────

const DEFAULT_COLS = { type: true, level: true, parent: true }

function ColConfig({ cols, onChange, onClose, attributes = [] }) {
    return (
        <div className="absolute right-0 top-7 z-20 bg-popover border border-border rounded shadow-lg p-3 w-52 max-h-80 overflow-auto">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">Columns</span>
                <button onClick={onClose}><X size={12} /></button>
            </div>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">Element Info</p>
            {[['type', 'Type'], ['level', 'Level'], ['parent', 'Parent']].map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={cols[k] ?? false} onChange={e => onChange({ ...cols, [k]: e.target.checked })} className="rounded" />
                    {label}
                </label>
            ))}
            {attributes.length > 0 && <>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mt-2 mb-1">Attributes</p>
                {attributes.map(a => (
                    <label key={a.name} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer">
                        <input type="checkbox" checked={cols[`attr_${a.name}`] ?? false}
                            onChange={e => onChange({ ...cols, [`attr_${a.name}`]: e.target.checked })} className="rounded" />
                        <span className="truncate">{a.name}</span>
                        <span className="text-[9px] text-muted-foreground/50 shrink-0">{a.type}</span>
                    </label>
                ))}
            </>}
        </div>
    )
}

// ── Left panel: dimension browser ─────────────────────────────────────────────

function DimensionBrowser({ server, dim, onKeep, subsets = [], sourceFilter }) {
    const { data: elements = [], isLoading: loadingEl } = useElements(server, dim)
    const { data: edges = [],    isLoading: loadingEd } = useEdges(server, dim)
    const [search, setSearch]         = useState('')
    const [expanded, setExpanded]     = useState(new Set())
    const [selected, setSelected]     = useState(new Set())
    const lastClickRef                = useRef(null)

    const { elementMap, childrenMap, parentMap, roots } = useMemo(
        () => buildMaps(elements, edges),
        [elements, edges]
    )

    const visibleRows = useMemo(() => {
        if (search.trim()) {
            const q = search.toLowerCase()
            return elements
                .filter(e => e.Name.toLowerCase().includes(q) && (!sourceFilter || sourceFilter.has(e.Name)))
                .map(e => ({ ...e, depth: 0, hasChildren: false, parent: parentMap[e.Name] ?? '' }))
        }
        const rows = flattenTree(roots, childrenMap, elementMap, expanded, parentMap)
        return sourceFilter ? rows.filter(r => sourceFilter.has(r.Name)) : rows
    }, [search, elements, roots, childrenMap, elementMap, expanded, parentMap, sourceFilter])

    const toggle = (name) => setExpanded(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })

    const selectRow = (name, e) => {
        if (e.shiftKey && lastClickRef.current) {
            const a = visibleRows.findIndex(r => r.Name === lastClickRef.current)
            const b = visibleRows.findIndex(r => r.Name === name)
            const [lo, hi] = a < b ? [a, b] : [b, a]
            setSelected(s => { const n = new Set(s); visibleRows.slice(lo, hi + 1).forEach(r => n.add(r.Name)); return n })
        } else if (e.ctrlKey || e.metaKey) {
            setSelected(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })
        } else {
            setSelected(new Set([name]))
        }
        lastClickRef.current = name
    }

    const addLeaf   = () => onKeep(elements.filter(e => e.Type === 'N'))
    const addConsol = () => onKeep(elements.filter(e => e.Type === 'C'))
    const keepSelected = () => {
        const els = [...selected].map(n => elementMap[n]).filter(Boolean)
        onKeep(els)
        setSelected(new Set())
    }

    const loading = loadingEl || loadingEd

    return (
        <div className="flex flex-col h-full border-r border-border">
            <div className="px-2 py-1.5 border-b border-border shrink-0 space-y-1.5">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs">
                    <Search size={10} className="text-muted-foreground shrink-0" />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search dimension…"
                        className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/50" />
                    {search && <button onClick={() => setSearch('')}><X size={10} /></button>}
                </div>
                {/* Source subset filter */}
                {subsets.length > 0 && (
                    <select
                        defaultValue=""
                        onChange={async e => {
                            const name = e.target.value
                            if (!name) return
                            try {
                                const r = await fetch(`/api/subset/elements?server=${enc(server)}&dimension=${enc(dim)}&name=${enc(name)}`)
                                const els = await r.json()
                                onKeep(els.map(el => ({ Name: el.name, Type: el.type, Level: el.level })))
                            } catch { toast.error('Failed to load subset') }
                            e.target.value = ''
                        }}
                        className="w-full text-xs px-2 py-1 rounded border border-border bg-background text-muted-foreground">
                        <option value="">+ Add from subset…</option>
                        {subsets.map(s => <option key={s.Name} value={s.Name}>{s.Name}</option>)}
                    </select>
                )}
                <div className="flex gap-1">
                    {[['Leaf', addLeaf], ['Consol', addConsol]].map(([l, fn]) => (
                        <button key={l} onClick={fn}
                            className="px-1.5 py-0.5 text-[10px] rounded border border-border hover:bg-muted transition-colors">
                            + {l}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-auto text-xs">
                {loading && <div className="flex items-center justify-center p-4"><Loader2 size={14} className="animate-spin text-muted-foreground" /></div>}
                {visibleRows.map(row => (
                    <div
                        key={row.Name}
                        onClick={e => selectRow(row.Name, e)}
                        style={{ paddingLeft: `${8 + row.depth * 14}px` }}
                        className={cn(
                            'flex items-center gap-1 py-0.5 pr-2 cursor-pointer select-none',
                            selected.has(row.Name) ? 'bg-primary/20 text-primary' : 'hover:bg-muted'
                        )}
                    >
                        {row.hasChildren
                            ? <button onClick={e => { e.stopPropagation(); toggle(row.Name) }} className="shrink-0 text-muted-foreground">
                                {expanded.has(row.Name) ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                              </button>
                            : <span className="w-3 shrink-0" />
                        }
                        <span className={cn('shrink-0 text-[10px]', TYPE_COLOR[row.Type])}>{TYPE_ICON[row.Type]}</span>
                        <span className="truncate">{row.Name}</span>
                    </div>
                ))}
            </div>

            <div className="px-2 py-1.5 border-t border-border shrink-0">
                <button
                    onClick={keepSelected}
                    disabled={selected.size === 0}
                    className="w-full py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                    Keep {selected.size > 0 ? `(${selected.size})` : ''} →
                </button>
            </div>
        </div>
    )
}

// ── Subset tree view helpers ──────────────────────────────────────────────────

function renderSubsetTree(members, memberMap, childrenMap, parentMap, depth, cols, selected, onSelect, activeAttrs, expanded, onToggle, elementMap = {}) {
    return members.map((m) => {
        const allChildNames = childrenMap[m.name] ?? []
        const children = allChildNames.map(n => {
            if (memberMap[n]) return memberMap[n]
            const el = elementMap[n]
            if (el) return { name: el.Name, type: el.Type, level: el.Level, _ghost: true }
            return null
        }).filter(Boolean)
        const isConsol = m.type === 'C'
        const isExpanded = expanded.has(m.name)
        const indent = 8 + depth * 16
        return (
            <div key={m.name}>
                <div
                    style={{ paddingLeft: `${indent}px` }}
                    onClick={m._ghost ? undefined : e => onSelect(m.name, e)}
                    className={cn(
                        'flex items-center gap-1 pr-2 py-0.5 border-b border-border/30 select-none text-xs',
                        m._ghost
                            ? 'opacity-40 cursor-default'
                            : cn('cursor-pointer', selected.has(m.name) ? 'bg-primary/20 text-primary' : 'hover:bg-muted')
                    )}
                >
                    <span className="w-3 shrink-0 text-muted-foreground">
                        {isConsol
                            ? <button onClick={e => { e.stopPropagation(); onToggle(m.name) }}>
                                {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                              </button>
                            : null}
                    </span>
                    {cols.type && <span className={cn('w-4 shrink-0 text-[10px]', TYPE_COLOR[m.type])}>{TYPE_ICON[m.type]}</span>}
                    <span className="flex-1 truncate font-mono">{m.name}</span>
                    {cols.level  && <span className="w-10 shrink-0 text-muted-foreground">{m.level}</span>}
                    {cols.parent && depth === 0 && <span className="w-24 shrink-0 truncate text-muted-foreground">{parentMap[m.name] ?? ''}</span>}
                    {activeAttrs.map(a => <span key={a.name} className="w-24 shrink-0 truncate text-muted-foreground">{m.attrs?.[a.name] ?? ''}</span>)}
                </div>
                {isConsol && isExpanded && renderSubsetTree(children, memberMap, childrenMap, parentMap, depth + 1, cols, selected, onSelect, activeAttrs, expanded, onToggle, elementMap)}
            </div>
        )
    })
}

// ── Right panel: subset grid ──────────────────────────────────────────────────

function SubsetGrid({ members, onReorder, onRemove, cols, childrenMap = {}, elementMap = {}, parentMap = {}, subsets = [], server, dim, onLoadSubset, attributes = [] }) {
    const [selected, setSelected]       = useState(new Set())
    const [search, setSearch]           = useState('')
    const [dragIdx, setDragIdx]         = useState(null)
    const [dropIdx, setDropIdx]         = useState(null)
    const [treeView, setTreeView]       = useState(true)
    const [showTotals, setShowTotals]   = useState(false)
    const [expandedTree, setExpandedTree] = useState(new Set())
    const lastClickRef                  = useRef(null)

    const toggleTreeNode = (name) => setExpandedTree(s => {
        const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n
    })

    const memberSet = useMemo(() => new Set(members.map(m => m.name)), [members])
    const memberMap = useMemo(() => Object.fromEntries(members.map(m => [m.name, m])), [members])

    // Tree view: roots are members whose parent is not also in the subset
    const treeRoots = useMemo(() => {
        const roots = members.filter(m => !memberSet.has(parentMap[m.name]))
        if (!showTotals) return roots
        return [...roots.filter(m => m.type !== 'C'), ...roots.filter(m => m.type === 'C')]
    }, [members, memberSet, parentMap, showTotals])

    const visible = useMemo(() => {
        let list = search.trim()
            ? members.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))
            : members
        if (showTotals) {
            const leaves  = list.filter(m => m.type !== 'C')
            const consols = list.filter(m => m.type === 'C')
            list = [...leaves, ...consols]
        }
        return list
    }, [members, search, showTotals])

    const selectRow = (name, idx, e) => {
        if (e.shiftKey && lastClickRef.current !== null) {
            const a = visible.findIndex(r => r.name === lastClickRef.current)
            const b = idx
            const [lo, hi] = a < b ? [a, b] : [b, a]
            setSelected(s => { const n = new Set(s); visible.slice(lo, hi + 1).forEach(r => n.add(r.name)); return n })
        } else if (e.ctrlKey || e.metaKey) {
            setSelected(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })
        } else {
            setSelected(new Set([name]))
        }
        lastClickRef.current = name
    }

    const moveUp = () => {
        if (selected.size === 0) return
        onReorder(prev => {
            const arr = [...prev]
            const indices = arr.map((m, i) => selected.has(m.name) ? i : -1).filter(i => i >= 0).sort((a, b) => a - b)
            if (indices[0] === 0) return arr
            indices.forEach(i => { const tmp = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = tmp })
            return arr
        })
    }

    const moveDown = () => {
        if (selected.size === 0) return
        onReorder(prev => {
            const arr = [...prev]
            const indices = arr.map((m, i) => selected.has(m.name) ? i : -1).filter(i => i >= 0).sort((a, b) => b - a)
            if (indices[0] === arr.length - 1) return arr
            indices.forEach(i => { const tmp = arr[i + 1]; arr[i + 1] = arr[i]; arr[i] = tmp })
            return arr
        })
    }

    const removeSelected = () => {
        onRemove([...selected])
        setSelected(new Set())
    }

    const keepSelected = () => {
        onRemove(members.filter(m => !selected.has(m.name)).map(m => m.name))
    }

    const handleDrop = (toIdx) => {
        if (dragIdx === null || dragIdx === toIdx) return
        onReorder(prev => {
            const arr = [...prev]
            const [item] = arr.splice(dragIdx, 1)
            arr.splice(toIdx, 0, item)
            return arr
        })
        setDragIdx(null); setDropIdx(null)
    }

    const activeAttrs = attributes.filter(a => cols[`attr_${a.name}`])
    const leafCount   = members.filter(m => m.type === 'N').length
    const consolCount = members.filter(m => m.type === 'C').length

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0 bg-muted/30 flex-wrap">
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted text-xs flex-1 min-w-0">
                    <Search size={10} className="text-muted-foreground shrink-0" />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search subset…"
                        className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/50 min-w-0" />
                    {search && <button onClick={() => setSearch('')}><X size={10} /></button>}
                </div>
                <button onClick={moveUp} disabled={selected.size === 0}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors">
                    <ArrowUp size={12} />
                </button>
                <button onClick={moveDown} disabled={selected.size === 0}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors">
                    <ArrowDown size={12} />
                </button>
                <button onClick={keepSelected} disabled={selected.size === 0}
                    title="Keep selected, remove rest"
                    className="px-1.5 py-0.5 rounded text-[10px] hover:bg-muted disabled:opacity-30 text-primary transition-colors border border-primary/30">
                    Keep
                </button>
                <button onClick={() => setTreeView(v => !v)}
                    title={treeView ? 'Switch to flat list' : 'Switch to tree view'}
                    className={cn('px-1.5 py-0.5 rounded text-[10px] border transition-colors', treeView ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-muted')}>
                    Tree
                </button>
                <button onClick={() => setShowTotals(v => !v)}
                    title={showTotals ? 'Hide totals' : 'Show totals'}
                    className={cn('px-1.5 py-0.5 rounded text-[10px] border transition-colors', showTotals ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-muted')}>
                    Σ
                </button>
                <button onClick={removeSelected} disabled={selected.size === 0}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30 text-red-400 transition-colors">
                    <Trash2 size={12} />
                </button>
                <button onClick={() => { onRemove(members.map(m => m.name)); setSelected(new Set()) }}
                    disabled={members.length === 0}
                    className="px-1.5 py-0.5 rounded text-[10px] hover:bg-muted disabled:opacity-30 text-red-400 transition-colors border border-red-400/30">
                    All
                </button>
            </div>

            {/* Load subset into target */}
            {subsets.length > 0 && (
                <div className="px-2 py-1 border-b border-border shrink-0 bg-muted/20">
                    <select defaultValue=""
                        onChange={e => { if (e.target.value) { onLoadSubset(e.target.value); e.target.value = '' } }}
                        className="w-full text-xs px-2 py-0.5 rounded border border-border bg-background text-muted-foreground">
                        <option value="">Load subset as base…</option>
                        {subsets.map(s => <option key={s.Name} value={s.Name}>{s.Name}</option>)}
                    </select>
                </div>
            )}

            {/* Grid */}
            <div className="flex-1 overflow-auto text-xs">
                {/* Header */}
                <div className="flex items-center gap-1 px-2 py-0.5 border-b border-border bg-muted/50 sticky top-0 text-[10px] text-muted-foreground font-medium">
                    <span className="w-5 shrink-0 text-center">#</span>
                    <span className="w-3 shrink-0" />
                    {cols.type   && <span className="w-4 shrink-0" />}
                    <span className="flex-1">Name</span>
                    {cols.level  && <span className="w-10 shrink-0">Lvl</span>}
                    {cols.parent && <span className="w-24 shrink-0 truncate">Parent</span>}
                    {activeAttrs.map(a => <span key={a.name} className="w-24 shrink-0 truncate">{a.name}</span>)}
                </div>

                {treeView && !search.trim()
                    ? renderSubsetTree(
                        treeRoots, memberMap, childrenMap, parentMap, 0, cols, selected,
                        (name, e) => selectRow(name, members.findIndex(m => m.name === name), e),
                        activeAttrs, expandedTree, toggleTreeNode, elementMap
                      )
                    : visible.map((m, i) => (
                        <div
                            key={m.name}
                            onClick={e => selectRow(m.name, i, e)}
                            draggable
                            onDragStart={() => setDragIdx(i)}
                            onDragOver={e => { e.preventDefault(); setDropIdx(i) }}
                            onDrop={() => handleDrop(i)}
                            onDragEnd={() => { setDragIdx(null); setDropIdx(null) }}
                            className={cn(
                                'flex items-center gap-1 px-2 py-0.5 cursor-pointer select-none border-b border-border/30',
                                selected.has(m.name) ? 'bg-primary/20 text-primary' : 'hover:bg-muted',
                                dropIdx === i && dragIdx !== i && 'border-t-2 border-primary'
                            )}
                        >
                            <span className="w-5 shrink-0 text-center text-muted-foreground text-[10px]">{members.indexOf(m) + 1}</span>
                            <span className="w-3 shrink-0" />
                            {cols.type   && <span className={cn('w-4 shrink-0 text-[10px]', TYPE_COLOR[m.type])}>{TYPE_ICON[m.type]}</span>}
                            <span className="flex-1 truncate font-mono">{m.name}</span>
                            {cols.level  && <span className="w-10 shrink-0 text-muted-foreground">{m.level}</span>}
                            {cols.parent && <span className="w-24 shrink-0 truncate text-muted-foreground">{parentMap[m.name] ?? ''}</span>}
                            {activeAttrs.map(a => <span key={a.name} className="w-24 shrink-0 truncate text-muted-foreground">{''}</span>)}
                        </div>
                    ))
                }

                {members.length === 0 && (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
                        Select elements from the dimension and click Keep →
                    </div>
                )}

            </div>

            {/* Status bar */}
            <div className="px-2 py-1 border-t border-border shrink-0 text-[10px] text-muted-foreground flex items-center gap-3">
                <span>{members.length} members</span>
                <span className={TYPE_COLOR.N}>○ {leafCount} leaf</span>
                <span className={TYPE_COLOR.C}>◆ {consolCount} consol</span>
                {selected.size > 0 && <span className="ml-auto">{selected.size} selected</span>}
            </div>
        </div>
    )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SubsetVisualEditor({ tab, onMdxConvert }) {
    const { bumpSubsetVersion } = useStore()
    const saveStatic = useSaveStaticSubset()

    const { data: allElements = [] } = useElements(tab.server, tab.dimension)
    const { data: allEdges    = [] } = useEdges(tab.server, tab.dimension)
    const { data: subsets     = [] } = useSubsets(tab.server, tab.dimension)
    const { data: attributes  = [] } = useDimAttributes(tab.server, tab.dimension)

    const { childrenMap, elementMap, parentMap } = useMemo(
        () => buildMaps(allElements, allEdges),
        [allElements, allEdges]
    )

    const { data: existingElements, isLoading: loadingExisting } = useSubsetElements(
        tab.server, tab.dimension, tab.subsetName
    )

    const [members, setMembers]             = useState(null)
    const [dirty, setDirty]                 = useState(false)
    const [showCols, setShowCols]           = useState(false)
    const [leftCollapsed, setLeftCollapsed] = useState(false)
    const [cols, setCols] = useState(() => {
        try { return JSON.parse(localStorage.getItem(`tm1-cols-${tab.dimension}`)) || DEFAULT_COLS } catch { return DEFAULT_COLS }
    })

    useEffect(() => {
        if (existingElements && members === null) setMembers(existingElements)
    }, [existingElements])

    useEffect(() => {
        if (!loadingExisting && members === null) setMembers([])
    }, [loadingExisting])

    const saveCols = (c) => { setCols(c); localStorage.setItem(`tm1-cols-${tab.dimension}`, JSON.stringify(c)) }

    const handleKeep = useCallback((els) => {
        setMembers(prev => {
            const existing = new Set((prev ?? []).map(m => m.name))
            const toAdd = els.filter(e => !existing.has(e.Name ?? e.name))
            return [...(prev ?? []), ...toAdd.map(e => ({
                name: e.Name ?? e.name,
                type: e.Type ?? e.type,
                level: e.Level ?? e.level,
            }))]
        })
        setDirty(true)
    }, [])

    const handleRemove = useCallback((names) => {
        setMembers(prev => (prev ?? []).filter(m => !names.includes(m.name)))
        setDirty(true)
    }, [])

    const handleReorder = useCallback((fn) => {
        setMembers(prev => fn(prev ?? []))
        setDirty(true)
    }, [])

    const handleLoadSubset = async (name) => {
        try {
            const r = await fetch(`/api/subset/elements?server=${enc(tab.server)}&dimension=${enc(tab.dimension)}&name=${enc(name)}`)
            if (!r.ok) throw new Error(await r.text())
            const els = await r.json()
            setMembers(els)
            setDirty(true)
        } catch (e) { toast.error('Failed to load subset: ' + e.message) }
    }

    const handleSaveStatic = () => {
        const id = toast.loading('Saving static subset…')
        saveStatic.mutate(
            { server: tab.server, dimension: tab.dimension, name: tab.subsetName, elements: (members ?? []).map(m => m.name) },
            {
                onSuccess: () => { setDirty(false); toast.success('Saved as static subset', { id }); bumpSubsetVersion(tab.server, tab.dimension) },
                onError:   (e) => toast.error(e.message, { id }),
            }
        )
    }

    const handleConvertMDX = () => {
        const names = (members ?? []).map(m => `[${tab.dimension}].[${tab.dimension}].[${m.name}]`)
        onMdxConvert(names.length ? `{${names.join(', ')}}` : '{}')
    }

    if (members === null) {
        return <div className="flex-1 flex items-center justify-center"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Action bar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
                <button onClick={() => setLeftCollapsed(s => !s)}
                    title={leftCollapsed ? 'Show dimension browser' : 'Hide dimension browser'}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    {leftCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
                </button>
                <span className="text-xs text-muted-foreground">
                    {dirty && <span className="text-amber-400 mr-2">●</span>}
                    {tab.dimension} › {tab.subsetName}
                </span>
                <div className="flex-1" />
                <div className="relative">
                    <button onClick={() => setShowCols(s => !s)}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors">
                        <Settings2 size={11} /> Columns
                    </button>
                    {showCols && <ColConfig cols={cols} onChange={saveCols} onClose={() => setShowCols(false)} attributes={attributes} />}
                </div>
                <button onClick={handleConvertMDX}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors">
                    → MDX
                </button>
                <button onClick={handleSaveStatic} disabled={!dirty || saveStatic.isPending}
                    className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity">
                    {saveStatic.isPending ? <Loader2 size={11} className="animate-spin" /> : null}
                    Save
                </button>
            </div>

            {/* Two-panel layout */}
            <div className="flex flex-1 min-h-0">
                {!leftCollapsed && (
                    <div className="w-2/5 min-w-0 shrink-0">
                        <DimensionBrowser
                            server={tab.server}
                            dim={tab.dimension}
                            onKeep={handleKeep}
                            subsets={subsets}
                        />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <SubsetGrid
                        members={members}
                        onReorder={handleReorder}
                        onRemove={handleRemove}
                        cols={cols}
                        childrenMap={childrenMap}
                        elementMap={elementMap}
                        parentMap={parentMap}
                        subsets={subsets}
                        server={tab.server}
                        dim={tab.dimension}
                        onLoadSubset={handleLoadSubset}
                        attributes={attributes}
                    />
                </div>
            </div>
        </div>
    )
}
