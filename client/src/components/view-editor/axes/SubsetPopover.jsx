import { useCallback, useEffect, useMemo, useState } from 'react'
import { Braces, Loader2, PencilLine } from 'lucide-react'
import { useElementsTree } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import { buildElementTree } from '@/lib/view-editor/member-tree.js'
import { Checkbox, TreeNodes } from './MemberTree.jsx'

function SubsetPopover({ server, dim, zone, subsets, onSubsetSelect, onMemberSelect, onMembersSelect, onMemberSetSelect, onEditSubset, onBuildSubset, onClose }) {
    const isFilter    = zone === 'pages'
    const [tab, setTab]           = useState((dim.member || dim.members?.length) ? 'manual' : 'subset')
    const [search, setSearch]     = useState('')
    const [checked, setChecked]   = useState(() => new Set(dim.members ?? (dim.member ? [dim.member] : [])))
    const [expanded, setExpanded] = useState(new Set())

    const { data: allElements = [], isLoading: loadingElements } = useElementsTree(
        tab === 'manual' ? server : null,
        tab === 'manual' ? dim.dimension : null,
        dim.hierarchy || undefined,
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


export default SubsetPopover
