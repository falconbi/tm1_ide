import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

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

export { Checkbox, TreeNodes }
