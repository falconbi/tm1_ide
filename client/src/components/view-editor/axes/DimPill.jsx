import { useEffect, useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, GripVertical, PencilLine, X } from 'lucide-react'
import { useDimAttributes, useHierarchies, useSubsets } from '@/hooks/useApi'
import { dimensionTabId, subsetTabId } from '@/lib/tab-ids'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import entryKey from './entry-key.js'
import SubsetPopover from './SubsetPopover.jsx'

function DimPill({ id, dim, zone, server, onRemove, onSubsetChange, onMemberChange, onMembersChange, onMemberSetChange, onHierarchyChange, usedKeys, onMoveLeft, onMoveRight, activeAlias, onAliasChange, onBuildSubset }) {
    const key = entryKey(dim)
    const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id })
    const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `dim:${key}` })
    const { data: subsets = [] } = useSubsets(server, dim.dimension, dim.hierarchy || undefined)
    // an ALT H (Alternate Hierarchy) can stand in for the dimension's main hierarchy
    const { data: allHier = [] } = useHierarchies(onHierarchyChange ? server : null, onHierarchyChange ? dim.dimension : null)
    // a hierarchy already on the grid as another entry isn't offered again
    const hierChoices = allHier.filter(h => h !== 'Leaves' && (h === (dim.hierarchy || dim.dimension) || !usedKeys?.has(entryKey({ dimension: dim.dimension, hierarchy: h }))))
    const { data: dimAttrs = [] } = useDimAttributes(server, dim.dimension)
    const aliasAttrs = dimAttrs.filter(a => a.type === 'Alias')
    const [open, setOpen] = useState(false)
    const [aliasOpen, setAliasOpen] = useState(false)
    const ref = useRef(null)
    const openTab = useStore(s => s.openTab)

    const onEditSubset = (dimName, subsetName) => {
        setOpen(false)
        openTab({
            id:         subsetTabId(server, dimName, dimName, subsetName),
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
                    {/* an ALT H keeps its amber label wherever it sits; the switch only shows when there's another to choose */}
                    {dim.hierarchy && dim.hierarchy !== dim.dimension && (zone === 'bench' || hierChoices.length <= 1) && (
                        <span className="block text-[10px] text-amber-500 font-semibold truncate" title="An ALT H: the same members rolled up another way">› {dim.hierarchy}</span>
                    )}
                    {zone !== 'bench' && hierChoices.length > 1 && (
                        <select
                            value={dim.hierarchy || dim.dimension}
                            onClick={e => e.stopPropagation()}
                            onPointerDown={e => e.stopPropagation()}
                            onChange={e => onHierarchyChange(key, e.target.value)}
                            className={cn('block max-w-full text-[10px] bg-transparent border-0 p-0 cursor-pointer outline-none',
                                dim.hierarchy && dim.hierarchy !== dim.dimension ? 'text-amber-500 font-semibold' : 'text-muted-foreground')}
                            title="Hierarchy — an ALT H rolls the same elements up another way"
                        >
                            {hierChoices.map(h => <option key={h} value={h}>{h === dim.dimension ? 'main hierarchy' : `› ${h}`}</option>)}
                        </select>
                    )}
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
                            <button onClick={() => onRemove(key)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-0.5 rounded">
                                <X size={10} />
                            </button>
                        </>)}
                        <button
                            onClick={e => { e.stopPropagation(); openTab({ id: dimensionTabId(server, dim.dimension, dim.dimension), type: 'dimension', label: dim.dimension, server, dimension: dim.dimension }) }}
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
                    onSubsetSelect={name => onSubsetChange(key, name)}
                    onMemberSelect={name => onMemberChange(key, name)}
                    onMembersSelect={members => onMembersChange?.(key, members)}
                    onMemberSetSelect={mset => onMemberSetChange?.(key, mset)}
                    onEditSubset={onEditSubset}
                    onBuildSubset={onBuildSubset ? () => { setOpen(false); onBuildSubset(dim.dimension) } : null}
                    onClose={() => setOpen(false)}
                />
            )}
        </div>
    )
}

// ── Drop zone ─────────────────────────────────────────────────────────────────


export default DimPill
