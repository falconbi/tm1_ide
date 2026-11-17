import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function LineageNode({ cube, tree, depth, onOpen, visited = new Set() }) {
  const [open, setOpen] = useState(depth < 2)
  const node = tree[cube]
  if (!node) return null
  const sources = node.sources ?? []
  const cycle = visited.has(cube)
  const nextVisited = new Set(visited).add(cube)

  return (
    <div className={cn('text-xs', depth > 0 && 'ml-4 border-l border-border pl-2')}>
      <div className="flex items-center gap-1 py-0.5 group">
        {sources.length > 0 && !cycle ? (
          <button onClick={() => setOpen(o => !o)} className="shrink-0 text-muted-foreground">
            {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : <span className="w-3 shrink-0" />}
        <button
          onClick={ev => onOpen(cube, ev.altKey)}
          className="font-mono hover:text-primary truncate text-left"
          title={`${cube} — Alt-click to open here`}
        >
          {cube}
        </button>
        {cycle && <span className="text-muted-foreground/50 text-[10px]">(cycle)</span>}
        {node.error && <span className="text-red-400 text-[10px]">(error)</span>}
        {!node.hasRules && !cycle && <span className="text-muted-foreground/50 text-[10px]">no rules</span>}
      </div>
      {open && !cycle && sources.map(s => (
        <LineageNode key={s} cube={s} tree={tree} depth={depth + 1} onOpen={onOpen} visited={nextVisited} />
      ))}
    </div>
  )
}
