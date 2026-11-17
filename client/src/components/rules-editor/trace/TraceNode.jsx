import { useState } from 'react'
import { ChevronRight, ChevronDown, History } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function TraceNode({ node, depth = 0, onShowHistory }) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.Components?.length > 0
  const isRule  = node.Type === 'Rule'
  const isFeed  = node.Type === 'Feeders'
  const isConst = node.Type === 'Constant'
  const isLeaf  = !hasChildren && node.Tuple?.length > 0

  const typeColor = isRule  ? 'text-emerald-400'
                 : isFeed  ? 'text-amber-400'
                 : isConst ? 'text-blue-400'
                 : 'text-muted-foreground'

  const tuple    = (node.Tuple ?? []).map(m => m.Name ?? m.UniqueName ?? '').join(', ')
  const cubeName = node.Cube?.Name ?? ''

  return (
    <div className={cn('text-xs', depth > 0 && 'ml-4 border-l border-border pl-2 mt-0.5')}>
      <div className="flex items-start gap-1.5 py-0.5 group">
        {hasChildren ? (
          <button onClick={() => setOpen(o => !o)} className="shrink-0 mt-0.5 text-muted-foreground">
            {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : <span className="w-3 shrink-0" />}
        <div className="flex-1 min-w-0">
          <span className={cn('font-semibold', typeColor)}>{node.Type ?? '?'}</span>
          {cubeName && <span className="ml-1.5 text-muted-foreground">← {cubeName}</span>}
          {tuple    && <span className="ml-1.5 text-foreground/60 truncate block font-mono">[{tuple}]</span>}
          {node.Statements?.length > 0 && (
            <div className="mt-0.5 space-y-px">
              {node.Statements.map((s, i) => (
                <div key={i} className="font-mono text-[10px] text-foreground/70 bg-muted/30 px-1.5 py-px rounded truncate" title={s}>{s}</div>
              ))}
            </div>
          )}
          <span className="font-mono text-foreground font-bold">{node.Value ?? ''}</span>
        </div>
        {isLeaf && onShowHistory && (
          <button
            onClick={() => onShowHistory(node.Cube?.Name, node.Tuple)}
            title="Show transaction history for this cell"
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-muted-foreground hover:text-blue-400"
          >
            <History size={10} />
          </button>
        )}
      </div>
      {open && hasChildren && node.Components.map((c, i) => (
        <TraceNode key={i} node={c} depth={depth + 1} onShowHistory={onShowHistory} />
      ))}
    </div>
  )
}
