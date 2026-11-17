import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import entryKey from './entry-key.js'
import DimPill from './DimPill.jsx'

function DropZone({ id, label, icon: Icon, dims, server, onRemove, onSubsetChange, onMemberChange, onMembersChange, onMemberSetChange, onHierarchyChange, usedKeys, onReorder, accent, dimAliases, onAliasChange, onBuildSubset }) {
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
                    <DimPill key={entryKey(d)} id={entryKey(d)} dim={d} zone={id} usedKeys={usedKeys}
                        server={server} onRemove={onRemove}
                        onSubsetChange={onSubsetChange} onMemberChange={onMemberChange} onMembersChange={onMembersChange} onMemberSetChange={onMemberSetChange}
                        onHierarchyChange={onHierarchyChange}
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

// ── Main ViewEditor ───────────────────────────────────────────────────────────


export default DropZone
