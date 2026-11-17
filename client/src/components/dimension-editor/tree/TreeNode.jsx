import { useState } from 'react'
import { ChevronRight, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isUnder } from '@/lib/dimension-editor/tree'
import { TYPE_ICON, TYPE_COLOR } from '@/lib/dimension-editor/constants'
import AddRow from './AddRow'
import DropLine from './DropLine'

export default function TreeNode({ name, childrenOf, byName, depth, onAddChild, onDelete, selected, onSelect, visited = new Set(), indexMap,
  drag, onDragStart, onDragEnd, onDropChildAt, filtering = false }) {
  const children = childrenOf[name] ?? []
  const hasChildren = children.length > 0
  const cycle = visited.has(name)
  const [open, setOpen] = useState(filtering || depth < 2)   // filtering: open all the way down to the matches
  const [addingChild, setAddingChild] = useState(false)
  const [dropOver, setDropOver] = useState(false)
  const el = byName[name]
  const isC = el?.Type === 'C'
  const isSel = selected === name
  const nextVisited = new Set(visited).add(name)
  const canAccept = isC && drag && drag !== name && !isUnder(childrenOf, drag, name)

  return (
    <div className={cn(depth > 0 && 'ml-4 border-l border-border/40 pl-1.5')}>
      <div
        draggable={!cycle}
        onDragStart={e => {
          e.stopPropagation()
          e.dataTransfer.setData('text/plain', name)
          e.dataTransfer.effectAllowed = 'move'
          onDragStart?.(name)
        }}
        onDragEnd={() => { onDragEnd?.(); setDropOver(false) }}
        onDragOver={e => {
          if (!canAccept) return
          e.preventDefault(); e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
          if (!dropOver) setDropOver(true)
        }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropOver(false) }}
        onDrop={e => {
          if (!canAccept) return
          e.preventDefault(); e.stopPropagation()
          setDropOver(false)
          onDropChildAt?.(name, null, e.dataTransfer.getData('text/plain') || drag)
          setOpen(true)
        }}
        onClick={() => onSelect(isSel ? null : name)}
        className={cn('flex items-center gap-1 py-0.5 cursor-pointer rounded-sm',
          isSel ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/50',
          dropOver && 'ring-1 ring-primary bg-primary/10')}
      >
        <button onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          className={cn('shrink-0 text-muted-foreground hover:text-foreground', (!hasChildren || cycle) && 'invisible')}>
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <span className={cn('shrink-0 text-[10px] w-3', TYPE_COLOR[el?.Type] ?? '')}>{TYPE_ICON[el?.Type] ?? '·'}</span>
        {indexMap && <span className="shrink-0 text-[9px] text-muted-foreground/50 w-7 text-right font-mono">{indexMap[name] ?? ''}</span>}
        <span className="text-xs font-mono truncate flex-1">{name}</span>
        {cycle && <span className="text-muted-foreground/50 text-[10px]">(cycle)</span>}
        {isSel && !cycle && (
          <span className="flex items-center gap-1 shrink-0 ml-1">
            {isC && (
              <button onClick={e => { e.stopPropagation(); setOpen(true); setAddingChild(true) }}
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-border bg-background text-muted-foreground hover:text-foreground">
                <Plus size={9} /> Child
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); onDelete(name) }}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-border bg-background text-muted-foreground hover:text-red-400 hover:border-red-400/40">
              <Trash2 size={9} /> Del
            </button>
          </span>
        )}
      </div>
      {open && !cycle && (
        <>
          {addingChild && (
            <div className="ml-4 border-l border-border/40 pl-1.5">
              <AddRow
                beforeOptions={children}
                onConfirm={(n, t, b) => { onAddChild(name, n, t, b); setAddingChild(false) }}
                onCancel={() => setAddingChild(false)}
              />
            </div>
          )}
          {children.map(c => (
            <div key={c}>
              {canAccept && <DropLine onDrop={child => onDropChildAt?.(name, c, child || drag)} />}
              <TreeNode name={c} childrenOf={childrenOf} byName={byName} depth={depth + 1}
                onAddChild={onAddChild} onDelete={onDelete} selected={selected} onSelect={onSelect} visited={nextVisited} indexMap={indexMap}
                drag={drag} onDragStart={onDragStart} onDragEnd={onDragEnd} onDropChildAt={onDropChildAt} filtering={filtering} />
            </div>
          ))}
          {canAccept && <DropLine onDrop={child => onDropChildAt?.(name, null, child || drag)} />}
        </>
      )}
    </div>
  )
}
