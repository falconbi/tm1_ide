import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLineage, useLineageConsumers } from '@/hooks/useApi'
import LineageNode from '@/components/rules-editor/lineage/LineageNode'

export default function LineagePanel({ server, cube, onOpen, mode, setMode }) {
  const { data: srcData, isFetching: srcFetching }   = useLineage(server, cube, mode === 'sources')
  const { data: conData, isFetching: conFetching }   = useLineageConsumers(server, cube, mode === 'consumers')

  const fetching = mode === 'sources' ? srcFetching : conFetching

  return (
    <div className="w-64 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rules lineage</span>
        {fetching && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
      </div>

      <div className="flex px-2 py-1.5 gap-1 border-b border-border shrink-0">
        {['sources', 'consumers'].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn('flex-1 py-0.5 text-xs rounded capitalize',
              mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-2 py-2">
        {mode === 'sources' && srcData && (
          <LineageNode cube={srcData.root} tree={srcData.tree} depth={0} onOpen={onOpen} />
        )}
        {mode === 'consumers' && conData && (
          conData.consumers.length === 0
            ? <p className="text-xs text-muted-foreground px-1">No cubes reference this cube.</p>
            : conData.consumers.map(c => (
                <button key={c} onClick={ev => onOpen(c, ev.altKey)}
                  className="flex items-center w-full px-1 py-0.5 text-xs font-mono hover:text-primary text-left truncate">
                  {c}
                </button>
              ))
        )}
        {!srcData && !conData && !fetching && (
          <p className="text-xs text-muted-foreground px-1">Loading…</p>
        )}
      </div>
    </div>
  )
}
