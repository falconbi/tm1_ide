import { useEffect, useState } from 'react'
import { Loader2, Microscope, RefreshCw, Eraser, X } from 'lucide-react'
import { useStore } from '@/store'
import { useTraceCellCalc } from '@/hooks/useApi'
import { getRulesSession, saveRulesSession } from '@/lib/rules-session'
import ElementPicker from '@/components/rules-editor/trace/ElementPicker'
import TraceNode from '@/components/rules-editor/trace/TraceNode'

export default function CellTracePanel({ tabId, server, cube, cubeDims, onClose }) {
  // the typed tuple and the last traced cell survive a tab switch (re-traced on return)
  const sessionKey = tabId ? `${tabId}::trace` : null
  const saved = getRulesSession(sessionKey)
  const [rows, setRows] = useState(() => saved?.rows ?? (cubeDims ?? []).map(d => ({ dim: d, element: '' })))
  const [lastPairs, setLastPairs] = useState(saved?.lastPairs ?? null)
  const trace = useTraceCellCalc()
  const { openTab } = useStore()

  useEffect(() => { saveRulesSession(sessionKey, { rows, lastPairs }) }, [sessionKey, rows, lastPairs])
  useEffect(() => { if (lastPairs) trace.mutate({ server, cube, dimElemPairs: lastPairs }) }, [])  // eslint-disable-line

  useEffect(() => {
    if (!cubeDims?.length) return
    setRows(prev => cubeDims.map((d, i) => ({ dim: d, element: prev[i]?.element ?? '' })))
  }, [cubeDims])

  const setElement = (i, val) => setRows(r => r.map((row, j) => j === i ? { ...row, element: val } : row))

  const run = () => {
    const pairs = rows.map(r => ({ dim: r.dim, element: r.element.trim() }))
    if (pairs.some(p => !p.element)) return
    setLastPairs(pairs)
    trace.mutate({ server, cube, dimElemPairs: pairs })
  }

  const refresh = () => { if (lastPairs) trace.mutate({ server, cube, dimElemPairs: lastPairs }) }
  const clear = () => { setRows(r => r.map(row => ({ ...row, element: '' }))); setLastPairs(null); trace.reset() }

  const handleShowHistory = (srcCube, tuple) => {
    const tgtCube = srcCube || cube
    const elements = tuple?.map(m => m.Name ?? m.UniqueName ?? '') ?? []
    openTab({
      id:       `txlog:${server}:${tgtCube}:${elements.join(':')}:${Date.now()}`,
      type:     'transactionlog',
      label:    `Log — ${tgtCube}`,
      server,
      cube:     tgtCube,
      elements,
    })
  }

  return (
    <div className="w-80 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <Microscope size={11} className="text-emerald-400" />
          Trace Cell
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={!lastPairs || trace.isPending} title="Refresh — trace the same cell again with current data"
            className="text-muted-foreground hover:text-foreground disabled:opacity-40">
            <RefreshCw size={12} className={trace.isPending ? 'animate-spin' : ''} />
          </button>
          <button onClick={clear} title="Clear — empty the tuple and the result" className="text-muted-foreground hover:text-foreground">
            <Eraser size={12} />
          </button>
          <button onClick={onClose} title="Close" className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
        </div>
      </div>

      {/* Tuple inputs */}
      <div className="px-3 py-2 space-y-1.5 border-b border-border shrink-0">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Tuple — {cube}</div>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground w-24 truncate shrink-0" title={row.dim}>{row.dim}</span>
            <ElementPicker
              server={server}
              dim={row.dim}
              value={row.element}
              onChange={val => setElement(i, val)}
              onCommit={i === rows.length - 1 ? run : undefined}
            />
          </div>
        ))}
        <button
          onClick={run}
          disabled={trace.isPending || rows.some(r => !r.element.trim())}
          className="w-full mt-1 flex items-center justify-center gap-1.5 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors"
        >
          {trace.isPending ? <Loader2 size={11} className="animate-spin" /> : <Microscope size={11} />}
          Trace
        </button>
      </div>

      {/* Result */}
      <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
        {trace.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={11} className="animate-spin" /> Tracing…
          </div>
        )}
        {trace.isError && (
          <p className="text-xs text-red-400">{trace.error?.message ?? 'Trace failed'}</p>
        )}
        {trace.data && !trace.isPending && (
          <TraceNode node={trace.data} depth={0} onShowHistory={handleShowHistory} />
        )}
        {!trace.data && !trace.isPending && !trace.isError && (
          <p className="text-xs text-muted-foreground italic">Enter a tuple and click Trace to see how this cell is calculated.</p>
        )}
      </div>
    </div>
  )
}
