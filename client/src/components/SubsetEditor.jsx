import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useStore } from '@/store'
import { useElements, useEdges, useSubsets, useSubsetElements, useSaveStaticSubset, useDimAttributes } from '@/hooks/useApi'
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

function renderSubsetTree(members, memberMap, childrenMap, parentMap, depth, cols, selected, onSelect, activeAttrs, expanded, onToggle) {
    return members.map((m) => {
        const subsetChildren = (childrenMap[m.name] ?? [])
            .filter(n => memberMap[n])
            .map(n => memberMap[n])

        const hasVisibleChildren = subsetChildren.length > 0
        const isExpanded = expanded.has(m.name)
        const indent = 8 + depth * 16

        return (
            <div key={m.name}>
                <div
                    style={{ paddingLeft: `${indent}px` }}
                    onClick={e => onSelect(m.name, e)}
                    className={cn(
                        'flex items-center gap-1 pr-2 py-0.5 border-b border-border/30 cursor-pointer select-none text-xs',
                        selected.has(m.name) ? 'bg-primary/20 text-primary' : 'hover:bg-muted'
                    )}
                >
                    <span className="w-3 shrink-0 text-muted-foreground">
                        {hasVisibleChildren && (
                            <button onClick={e => { e.stopPropagation(); onToggle(m.name) }}>
                                {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            </button>
                        )}
                    </span>
                    {cols.type && <span className={cn('w-4 shrink-0 text-[10px]', TYPE_COLOR[m.type])}>{TYPE_ICON[m.type]}</span>}
                    <span className="flex-1 truncate font-mono">{m.name}</span>
                    {cols.level  && <span className="w-10 shrink-0 text-muted-foreground">{m.level}</span>}
                    {cols.parent && depth === 0 && <span className="w-24 shrink-0 truncate text-muted-foreground">{parentMap[m.name] ?? ''}</span>}
                    {activeAttrs.map(a => <span key={a.name} className="w-24 shrink-0 truncate text-muted-foreground">{m.attrs?.[a.name] ?? ''}</span>)}
                </div>

                {hasVisibleChildren && isExpanded && renderSubsetTree(
                    subsetChildren, memberMap, childrenMap, parentMap, depth + 1, 
                    cols, selected, onSelect, activeAttrs, expanded, onToggle
                )}
            </div>
        )
    })
}

// ── SubsetGrid ────────────────────────────────────────────────────────────────
function SubsetGrid({ members, onReorder, onRemove, cols, childrenMap = {}, elementMap = {}, parentMap = {}, subsets = [], server, dim, onLoadSubset, attributes = [] }) {
    const [selected, setSelected] = useState(new Set())
    const [search, setSearch] = useState('')
    const [dragIdx, setDragIdx] = useState(null)
    const [dropIdx, setDropIdx] = useState(null)
    const [treeView, setTreeView] = useState(true)
    const [showTotals, setShowTotals] = useState(false)
    const [expandedTree, setExpandedTree] = useState(new Set())
    const lastClickRef = useRef(null)

    const toggleTreeNode = (name) => setExpandedTree(s => {
        const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n
    })

    const memberSet = useMemo(() => new Set(members.map(m => m.name)), [members])
    const memberMap = useMemo(() => Object.fromEntries(members.map(m => [m.name, m])), [members])

    // Tree roots - respect showTotals
    const treeRoots = useMemo(() => {
        let roots = members.filter(m => !memberSet.has(parentMap[m.name]))
        if (showTotals) {
            roots = [...roots.filter(m => m.type !== 'C'), ...roots.filter(m => m.type === 'C')]
        }
        return roots
    }, [members, memberSet, parentMap, showTotals])

    const visible = useMemo(() => {
        if (!search.trim()) return members
        const q = search.toLowerCase()
        return members.filter(m => m.name.toLowerCase().includes(q))
    }, [members, search])

    const activeAttrs = attributes.filter(a => cols[`attr_${a.name}`])
    const leafCount = members.filter(m => m.type === 'N').length
    const consolCount = members.filter(m => m.type === 'C').length

    const selectRow = (name, idx, e) => {
        // ... your existing selectRow logic ...
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

    // Keep your existing moveUp, moveDown, removeSelected, handleDrop etc.

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0 bg-muted/30 flex-wrap">
                {/* existing toolbar items ... */}
                <button 
                    onClick={() => setShowTotals(v => !v)}
                    className={cn('px-1.5 py-0.5 rounded text-[10px] border transition-colors',
                        showTotals ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-muted')}
                    title={showTotals ? "Hide totals" : "Show totals at bottom"}
                >
                    Σ
                </button>
                {/* ... rest of your toolbar ... */}
            </div>

            <div className="flex-1 overflow-auto text-xs">
                {treeView && !search.trim()
                    ? renderSubsetTree(treeRoots, memberMap, childrenMap, parentMap, 0, cols, selected, selectRow, activeAttrs, expandedTree, toggleTreeNode)
                    : /* your flat list rendering here */
                }
            </div>
        </div>
    )
}

// Main component with improved handleKeep
export default function SubsetVisualEditor({ tab, onMdxConvert }) {
    // ... your existing code and hooks (keep them) ...

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

        // Auto-expand new consolidated elements
        setExpandedTree(prev => {
            const next = new Set(prev)
            els.filter(el => (el.Type ?? el.type) === 'C')
               .forEach(el => next.add(el.Name ?? el.name))
            return next
        })

        setDirty(true)
    }, [])

    // ... rest of your component unchanged ...
}
