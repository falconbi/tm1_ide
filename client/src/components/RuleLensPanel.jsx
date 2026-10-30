import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, X, ListFilter, Workflow, AlertTriangle, AlertCircle, ArrowRight, History } from 'lucide-react'
import { cn } from '@/lib/utils'

// A cube's rules as reviewable items: target area/measures, expression, DB sources,
// feeders. Static reading aid — not TM1's evaluation order.
export default function RuleLensPanel({ server, cube, onOpenCube, onOpenMap, onClose, grouped, onToggleGrouped, onOpenLog }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/cube/rules-lens?server=${encodeURIComponent(server)}&cube=${encodeURIComponent(cube)}`, {
        headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' },
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      setData(d)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [server, cube])

  useEffect(() => { load() }, [load])

  const items = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return data?.items ?? []
    return (data?.items ?? []).filter(i =>
      i.area?.toLowerCase().includes(q) ||
      i.expression?.toLowerCase().includes(q) ||
      i.measures?.some(m => m.toLowerCase().includes(q)) ||
      i.dbSources?.some(c => c.toLowerCase().includes(q)) ||
      i.targetCubes?.some(c => c.toLowerCase().includes(q))
    )
  }, [data, filter])

  const groups = useMemo(() => {
    const list = items
    if (!grouped) return [{ key: '__file__', label: null, items: list }]
    const map = new Map(), order = []
    for (const it of list) {
      const ms = it.measures?.length ? it.measures : ['— no measure —']
      for (const m of ms) {
        if (!map.has(m)) { map.set(m, []); order.push(m) }
        map.get(m).push(it)
      }
    }
    return order.map(m => ({ key: m, label: m, items: map.get(m) }))
  }, [items, grouped])

  const openLog = measure => {
    const dims = data?.dims ?? []
    const elements = dims.map(d => d === data?.measureDim ? measure : null)
    onOpenLog?.(elements, dims, measure)
  }

  return (
    <div className="w-[380px] shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <ListFilter size={12} className="text-amber-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rule lens</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={onOpenMap} title="Open the Cube Map focused on this cube" className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted">
            <Workflow size={11} />
          </button>
          <button onClick={load} title="Refresh" className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted">
            <RefreshCw size={10} className={cn(loading && 'animate-spin')} />
          </button>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"><X size={11} /></button>
        </div>
      </div>

      {loading && <div className="p-3 text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Reading rules…</div>}
      {error && <div className="p-3 text-[11px] text-red-400">{error}</div>}
      {data && !loading && (
        <>
          <div className="px-3 py-1.5 border-b border-border text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap shrink-0">
            <span>{data.summary.calc} calc</span>
            <span>·</span>
            <span>{data.summary.feeders} feeders</span>
            <span>·</span>
            <span>{data.summary.cubesRead.length} cubes read</span>
            <div className="ml-auto flex items-center gap-1">
              {[['file', 'File order', false], ['measure', 'By measure', true]].map(([id, label, val]) => (
                <button key={id} onClick={() => onToggleGrouped(val)}
                  className={cn('px-1.5 py-0.5 rounded border text-[9px]',
                    !!grouped === val ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {data.checks?.length > 0 && (
            <div className="px-3 py-1.5 border-b border-border space-y-1 shrink-0">
              {data.checks.map((c, i) => (
                <div key={i} className={cn('flex items-start gap-1.5 text-[10px]', c.level === 'error' ? 'text-red-400' : 'text-amber-400')}>
                  {c.level === 'error' ? <AlertCircle size={10} className="mt-0.5 shrink-0" /> : <AlertTriangle size={10} className="mt-0.5 shrink-0" />}
                  <span>{c.message}</span>
                </div>
              ))}
            </div>
          )}
          <div className="px-2 py-1.5 border-b border-border shrink-0">
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter area, measure, cube…"
              className="w-full bg-background border border-border rounded px-2 py-1 text-[11px] outline-none focus:border-primary" />
          </div>
          <div className="flex-1 min-h-0 overflow-auto divide-y divide-border/50">
            {items.length === 0 && <div className="p-3 text-[11px] text-muted-foreground italic">No rules match.</div>}
            {groups.map(g => (
              <div key={g.key}>
                {g.label && (
                  <div className="sticky top-0 z-10 px-3 py-1 bg-sidebar border-b border-border/60 flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-semibold text-foreground/90 truncate">{g.label}</span>
                    <span className="text-[9px] text-muted-foreground/60">{g.items.length}</span>
                  </div>
                )}
                {g.items.map((it, idx) => <RuleItem key={`${g.key}-${idx}`} it={it} onOpenCube={onOpenCube} onOpenLog={openLog} />)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function RuleItem({ it, onOpenCube, onOpenLog }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className={cn('px-1 py-px rounded text-[9px] uppercase tracking-wider border shrink-0',
          it.type === 'calc' ? 'border-amber-500/40 text-amber-500' : 'border-slate-500/40 text-muted-foreground')}>
          {it.type}
        </span>
        <span className="font-mono text-[10px] text-foreground/90 truncate" title={it.area}>
          {!it.area || it.area === '[]' ? '[] — all cells' : it.area}
        </span>
        {it.measures?.length > 1 && <span className="ml-auto text-[8px] uppercase tracking-wider text-muted-foreground/50 shrink-0">shared</span>}
      </div>
      {it.measures?.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {it.measures.map(m => (
            <button key={m} onClick={() => onOpenLog?.(m)} title={`Transaction log for ${m} (other dimensions unfiltered)`}
              className="flex items-center gap-0.5 px-1 py-px rounded border border-border text-[9px] font-mono text-foreground/70 hover:text-foreground hover:bg-muted">
              <History size={8} /> {m}
            </button>
          ))}
        </div>
      )}
      {it.type === 'calc' && (
        <pre className="mt-1 max-h-24 overflow-auto bg-muted/40 rounded px-1.5 py-1 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-words">{it.expression}</pre>
      )}
      {it.type === 'feeder' && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground flex-wrap">
          <ArrowRight size={9} className="shrink-0" />
          {it.targetCubes?.length
            ? it.targetCubes.map(c => <button key={c} onClick={ev => onOpenCube(c, ev.altKey)} className="px-1 py-px rounded border border-border font-mono text-[9px] hover:text-foreground hover:bg-muted" title={`Open ${c} — Alt-click to open here`}>{c}</button>)
            : <span className="font-mono">{it.expression}</span>}
        </div>
      )}
      {it.dbSources?.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">reads</span>
          {it.dbSources.map(c => (
            <button key={c} onClick={ev => onOpenCube(c, ev.altKey)}
              className="px-1 py-px rounded border border-border font-mono text-[9px] text-foreground/75 hover:text-foreground hover:bg-muted"
              title={`Open ${c}'s rules — Alt-click to open here`}>{c}</button>
          ))}
        </div>
      )}
    </div>
  )
}
