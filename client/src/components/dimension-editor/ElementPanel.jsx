import { useState } from 'react'
import { ChevronLeft, Loader2, Plus, Trash2, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useElementHierarchyParents, useHierarchyInfo } from '@/hooks/useApi'
import { TYPE_ICON, TYPE_COLOR, TYPE_LABEL } from '@/lib/dimension-editor/constants'
import WeightInput from './tree/WeightInput'

// Where an element sits in each hierarchy — the main one and any Alternate Hierarchy (same element,
// same data, another rollup). TM1's automatic 'Leaves' hierarchy is left out.
function HierarchyPlaces({ server, dimension, element }) {
  const { data: places, isLoading } = useElementHierarchyParents(server, dimension, element)
  return (
    <section>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">In each hierarchy</div>
      {isLoading && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
      {Object.entries(places ?? {}).map(([h, ps]) => (
        <div key={h} className="flex items-baseline gap-1.5 py-0.5 text-[11px]">
          <span className="font-mono">{h}</span>
          <span className="text-[10px] text-muted-foreground/70">{h === dimension ? 'default' : 'alternate'}</span>
          <span className="ml-auto text-muted-foreground truncate">{ps.length ? 'under ' + ps.join(', ') : 'top level'}</span>
        </div>
      ))}
    </section>
  )
}

// What the open hierarchy is, so an Alternate Hierarchy isn't mistaken for a hand-kept dimension.
export function AlternateBanner({ server, dimension, hierarchy }) {
  const { data: info } = useHierarchyInfo(server, dimension, hierarchy)
  if (!hierarchy || hierarchy === dimension) return null
  const built = info?.builtBy ?? []
  return (
    <div className="px-3 py-1.5 text-[11px] border-b border-border bg-muted/40 text-muted-foreground">
      <b className="text-foreground">Alternate Hierarchy</b> of <span className="font-mono">{dimension}</span> — the same elements as the main
      hierarchy, so the same data, rolled up another way.{' '}
      {info && (built.length
        ? <>Built by <span className="font-mono text-foreground">{built.join(', ')}</span> — edits made here are overwritten the next time it runs.</>
        : <>No process builds it — it is kept by hand.</>)}
    </div>
  )
}

// ── Element properties panel ────────────────────────────────────────────────
export default function ElementPanel({ server, dimension, el, parents, children, byName, consolElements, elemAttrs, loadingAttrs, hierarchies,
  onDelete, onAddParent, onRemoveParent, onUpdateWeight, onClose }) {
  const [addingParent, setAddingParent] = useState(false)
  const [newParent, setNewParent] = useState('')

  const existingParentNames = new Set(parents.map(p => p.ParentName))
  const availableParents = consolElements.filter(e => e.Name !== el.Name && !existingParentNames.has(e.Name))

  return (
    <div className="flex flex-col h-full border-l border-border bg-background text-xs">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted shrink-0">
        <span className={cn('text-[11px]', TYPE_COLOR[el.Type])}>{TYPE_ICON[el.Type]}</span>
        <span className="font-mono font-semibold truncate flex-1">{el.Name}</span>
        <span className={cn('shrink-0 text-[10px] px-1.5 py-px rounded border', TYPE_COLOR[el.Type])}>
          {TYPE_LABEL[el.Type]}
        </span>
        <span className="shrink-0 text-muted-foreground text-[10px]">L{el.Level}</span>
        <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground ml-1">
          <ChevronLeft size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">

        {/* Hierarchies */}
        {hierarchies && hierarchies.filter(h => h !== 'Leaves').length > 1 && (
          <HierarchyPlaces server={server} dimension={dimension} element={el.Name} />
        )}

        {/* Parents */}
        <section>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
            Parents ({parents.length})
          </div>
          {parents.length === 0 && (
            <p className="text-muted-foreground italic text-[11px]">Root element — no parents</p>
          )}
          {parents.map(p => (
            <div key={p.ParentName} className="flex items-center gap-1.5 py-0.5">
              <span className="text-orange-400 shrink-0 text-[10px]">◆</span>
              <span className="font-mono flex-1 truncate">{p.ParentName}</span>
              <span className="text-muted-foreground shrink-0">W</span>
              <WeightInput key={`${p.ParentName}-${p.Weight}`} value={p.Weight}
                onSave={w => onUpdateWeight(p.ParentName, el.Name, w)} />
              <button onClick={() => onRemoveParent(p.ParentName)}
                className="shrink-0 text-muted-foreground hover:text-red-400 p-0.5">
                <X size={10} />
              </button>
            </div>
          ))}
          {addingParent ? (
            <div className="flex items-center gap-1 mt-1">
              <select value={newParent} onChange={e => setNewParent(e.target.value)}
                className="flex-1 text-[10px] bg-muted border border-border rounded px-1 py-0.5 outline-none">
                <option value="">Pick consolidation…</option>
                {availableParents.map(e => <option key={e.Name} value={e.Name}>{e.Name}</option>)}
              </select>
              <button onClick={() => { if (newParent) { onAddParent(newParent); setAddingParent(false); setNewParent('') } }}
                className="p-0.5 text-primary shrink-0"><Check size={10} /></button>
              <button onClick={() => setAddingParent(false)}
                className="p-0.5 text-muted-foreground shrink-0"><X size={10} /></button>
            </div>
          ) : (
            <button onClick={() => setAddingParent(true)}
              className="flex items-center gap-0.5 mt-1 text-muted-foreground hover:text-foreground">
              <Plus size={9} /> Add parent
            </button>
          )}
        </section>

        {/* Children */}
        {el.Type === 'C' && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Children ({children.length})
            </div>
            {children.length === 0 && (
              <p className="text-muted-foreground italic text-[11px]">No children yet</p>
            )}
            {children.map(c => {
              const child = byName[c.ComponentName]
              return (
                <div key={c.ComponentName} className="flex items-center gap-1.5 py-0.5">
                  <span className={cn('shrink-0 text-[10px]', TYPE_COLOR[child?.Type] ?? 'text-muted-foreground')}>
                    {TYPE_ICON[child?.Type] ?? '·'}
                  </span>
                  <span className="font-mono flex-1 truncate">{c.ComponentName}</span>
                  <span className="text-muted-foreground shrink-0">W</span>
                  <WeightInput key={`${c.ComponentName}-${c.Weight}`} value={c.Weight}
                    onSave={w => onUpdateWeight(el.Name, c.ComponentName, w)} />
                </div>
              )
            })}
          </section>
        )}

        {/* Attributes */}
        <section>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Attributes</div>
          {loadingAttrs && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
          {!loadingAttrs && elemAttrs && Object.keys(elemAttrs).length === 0 && (
            <p className="text-muted-foreground italic text-[11px]">No attributes defined</p>
          )}
          {!loadingAttrs && elemAttrs && Object.entries(elemAttrs).map(([k, v]) => (
            <div key={k} className="flex items-start gap-2 py-0.5">
              <span className="text-muted-foreground shrink-0 min-w-[80px]">{k}:</span>
              <span className="font-mono break-all">{v ?? <span className="text-muted-foreground/50 italic">—</span>}</span>
            </div>
          ))}
        </section>

      </div>

      {/* Delete */}
      <div className="shrink-0 px-3 py-2 border-t border-border">
        <button onClick={() => onDelete(el.Name)}
          className="flex items-center gap-1.5 px-2 py-1.5 w-full justify-center text-xs rounded border border-red-400/30 text-red-400 hover:bg-red-500/10">
          <Trash2 size={11} /> Delete Element
        </button>
      </div>
    </div>
  )
}
