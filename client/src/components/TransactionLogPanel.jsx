import { useEffect } from 'react'
import { History, RefreshCw, X, Loader2, XCircle } from 'lucide-react'
import { useTransactionLog } from '@/hooks/useApi'

function fmt(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function Val({ v }) {
  if (v == null || v === '') return <span className="text-muted-foreground/40 italic">—</span>
  return <span>{v}</span>
}

// tupleFilter: array of element names in cube dimension order, or null for whole cube
export default function TransactionLogPanel({ server, cube, cubeDims, tupleFilter, onClearFilter, onClose }) {
  const log = useTransactionLog()

  const fetch = (filter) =>
    log.mutate({ server, cube, elements: filter ?? null })

  // Auto-fetch whenever server/cube/tupleFilter changes
  useEffect(() => {
    if (server && cube) fetch(tupleFilter)
  }, [server, cube, JSON.stringify(tupleFilter)])  // eslint-disable-line react-hooks/exhaustive-deps

  const entries = log.data ?? []
  const filtered = tupleFilter?.some(Boolean)

  return (
    <div className="w-96 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <History size={11} className="text-blue-400" />
          Transaction Log
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => fetch(tupleFilter)}
            title="Refresh"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {log.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          </button>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Active tuple filter indicator */}
      {filtered && (
        <div className="px-3 py-2 border-b border-border bg-blue-500/5 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Filtered to cell</span>
            <button
              onClick={() => { onClearFilter?.(); fetch(null) }}
              title="Clear filter — show all cube transactions"
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <XCircle size={10} /> Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {cubeDims?.map((dim, i) => tupleFilter[i] ? (
              <span key={dim} className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded border border-border truncate max-w-[120px]" title={`${dim}: ${tupleFilter[i]}`}>
                {tupleFilter[i]}
              </span>
            ) : null)}
          </div>
        </div>
      )}

      {/* Log table */}
      <div className="flex-1 min-h-0 overflow-auto">
        {log.isPending && (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
            <Loader2 size={11} className="animate-spin" /> Loading…
          </div>
        )}
        {log.isError && (
          <p className="px-3 py-4 text-xs text-red-400">{log.error?.message ?? 'Failed to load transaction log'}</p>
        )}
        {!log.isPending && !log.isError && entries.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground italic">
            {filtered ? 'No transactions for this cell.' : 'No transactions found.'}
          </p>
        )}
        {entries.length > 0 && (
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="sticky top-0 bg-sidebar border-b border-border">
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Time</th>
                <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">User</th>
                <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Old</th>
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">New</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.ID ?? i} className="border-b border-border/30 hover:bg-muted/20">
                  <td className="px-3 py-1 text-foreground/60 whitespace-nowrap">{fmt(e.TimeStamp)}</td>
                  <td className="px-2 py-1 font-mono text-foreground/70 max-w-[80px] truncate" title={e.User}>{e.User}</td>
                  <td className="px-2 py-1 text-right font-mono text-red-400/80"><Val v={e.OldValue} /></td>
                  <td className="px-3 py-1 text-right font-mono text-emerald-400"><Val v={e.NewValue} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {entries.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border shrink-0 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}{entries.length === 200 ? ' (max)' : ''}</span>
          {filtered && <span className="italic">cell filter active</span>}
        </div>
      )}
    </div>
  )
}
