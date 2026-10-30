// "+ Hierarchy → From an attribute": an Alternate Hierarchy generated from an attribute, kept in
// step by a process the IDE writes (core/hierarchy_gen.js) — never built or edited by hand.
import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { X, Loader2 } from 'lucide-react'
import { useDimAttributes, useDims, useProcs, useHierarchyFromAttribute } from '@/hooks/useApi'

export default function HierarchyFromAttributeDialog({ server, dimension, onClose, onDone }) {
  const { data: attrs = [] } = useDimAttributes(server, dimension)
  const { data: dims = [] }  = useDims(server)
  const { data: procs = [] } = useProcs(server)
  const build = useHierarchyFromAttribute()
  const usable = useMemo(() => attrs.filter(a => !/alias/i.test(a.type)), [attrs])
  const [attribute, setAttribute] = useState('')
  const [name, setName]           = useState('')
  const [levels, setLevels]       = useState('')
  const [hook, setHook]           = useState('')
  const hierName = name || (attribute ? `By ${attribute}` : '')
  const dimNames  = (dims ?? []).map(d => (typeof d === 'string' ? d : d.Name)).filter(d => d && d !== dimension)
  const procNames = (procs ?? []).map(p => (typeof p === 'string' ? p : p.Name)).filter(Boolean)

  const create = () => {
    if (!attribute || !hierName) return
    const id = toast.loading(`Building "${hierName}"…`)
    build.mutate({ server, dimension, hierarchy: hierName, attribute, levelDimension: levels, hookProcess: hook }, {
      onSuccess: r => {
        toast.success(`"${hierName}" built by ${r.process}${r.hooked ? ` — runs from ${r.hooked}` : ''}`, { id })
        onDone?.(hierName)
      },
      onError: e => toast.error(e.message, { id }),
    })
  }

  const field = 'w-full text-xs bg-background border border-border rounded px-2 py-1 text-foreground'
  return (
    <div className="fixed inset-0 z-[2100] flex items-start justify-center bg-black/30 pt-[12vh]" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-[440px] max-w-[92vw] rounded-lg border border-border bg-popover p-4 shadow-xl text-sm">
        <div className="flex items-center mb-1">
          <h3 className="font-semibold">New hierarchy from an attribute</h3>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          An <b>Alternate Hierarchy</b> of <span className="font-mono">{dimension}</span>: the same elements (so the same data),
          rolled up by an attribute. The IDE writes a process that builds it and keeps it in step — run that process
          (or hook it below), never edit the hierarchy by hand.
        </p>
        <div className="grid gap-2.5">
          <label className="grid gap-1 text-xs">Attribute — each element goes under its value
            <select className={field} value={attribute} onChange={e => setAttribute(e.target.value)}>
              <option value="">Choose…</option>
              {usable.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs">Hierarchy name
            <input className={field + ' font-mono'} value={name} placeholder={attribute ? `By ${attribute}` : 'By …'} onChange={e => setName(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs">Levels above, from a dimension (optional)
            <select className={field} value={levels} onChange={e => setLevels(e.target.value)}>
              <option value="">None — one group per value</option>
              {dimNames.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <span className="text-[11px] text-muted-foreground">e.g. Location → WFP Location gives city → country → region. Its element names must match the attribute's values.</span>
          </label>
          <label className="grid gap-1 text-xs">Keep it in step — also run from (optional)
            <select className={field} value={hook} onChange={e => setHook(e.target.value)}>
              <option value="">Nothing — I'll run it myself</option>
              {procNames.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className="text-[11px] text-muted-foreground">Adds a call at the end of that process's Epilog — pick the one that runs after the attribute changes (a load, or a recalculation).</span>
          </label>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <span className="text-[11px] text-muted-foreground truncate">{hierName && `Creates "${hierName}" and its rebuild process`}</span>
          <button onClick={onClose} className="ml-auto px-3 py-1 text-xs rounded border border-border hover:bg-muted">Cancel</button>
          <button onClick={create} disabled={!attribute || !hierName || build.isPending}
            className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1">
            {build.isPending && <Loader2 size={11} className="animate-spin" />} Create
          </button>
        </div>
      </div>
    </div>
  )
}
