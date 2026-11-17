import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TYPE_ICON, TYPE_COLOR, TYPE_LABEL } from '@/lib/dimension-editor/constants'

export default function FlatList({ elements, selected, onSelect, onDelete, indexMap }) {
  const counts = { N: 0, C: 0, S: 0 }
  for (const e of elements) if (counts[e.Type] != null) counts[e.Type]++
  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-3 px-3 py-2 border-b border-border shrink-0 text-xs text-muted-foreground">
        {Object.entries(counts).map(([t, n]) => (
          <span key={t}><span className={TYPE_COLOR[t]}>{TYPE_ICON[t]}</span> {n} {TYPE_LABEL[t]}</span>
        ))}
        <span className="ml-auto">{elements.length} total</span>
      </div>
      <div className="flex-1 overflow-auto">
        {elements.map(e => {
          const isSel = selected === e.Name
          return (
            <div key={e.Name} onClick={() => onSelect(isSel ? null : e.Name)}
              className={cn('flex items-center gap-2 px-3 py-0.5 text-xs cursor-pointer',
                isSel ? 'bg-primary/10' : 'hover:bg-muted/50')}>
              <span className={cn('shrink-0 text-[10px]', TYPE_COLOR[e.Type])}>{TYPE_ICON[e.Type] ?? '·'}</span>
              {indexMap && <span className="shrink-0 text-[9px] text-muted-foreground/50 w-7 text-right font-mono">{indexMap[e.Name] ?? ''}</span>}
              <span className="font-mono truncate flex-1">{e.Name}</span>
              <span className="text-muted-foreground/50 shrink-0 text-[10px]">L{e.Level}</span>
              {isSel && (
                <button onClick={ev => { ev.stopPropagation(); onDelete(e.Name) }}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-border bg-background text-muted-foreground hover:text-red-400 hover:border-red-400/40 shrink-0">
                  <Trash2 size={9} /> Del
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
