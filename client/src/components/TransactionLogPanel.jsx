import { useEffect, useMemo, useState } from 'react'
import { History, RefreshCw, X, Loader2, XCircle, Search } from 'lucide-react'
import { useTransactionLog } from '@/hooks/useApi'
import { cn } from '@/lib/utils'

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
export default function TransactionLogPanel({ server, cube, cubeDims, tupleFilter, onClearFilter, onClose, fill = false }) {
  const log = useTransactionLog()

  const fetch = (filter) =>
    log.mutate({ server, cube, elements: filter ?? null })

  // Auto-fetch whenever server/cube/tupleFilter changes
  useEffect(() => {
    if (server && cube) fetch(tupleFilter)
  }, [server, cube, JSON.stringify(tupleFilter)])  // eslint-disable-line react-hooks/exhaustive-deps

  const entries = log.data ?? []
  const filtered = tupleFilter?.some(Boolean)
  const [q, setQ] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const users = useMemo(() => [...new Set(entries.map(e => e.User).filter(Boolean))].sort(), [entries])
  const visible = useMemo(() => {
    const text = q.trim().toLowerCase()
    return entries.filter(e => {
      if (userFilter && e.User !== userFilter) return false
      if (!text) return true
      const hay = [e.User, ...(Array.isArray(e.Tuple) ? e.Tuple : []), e.OldValue, e.NewValue, e.TimeStamp]
        .map(v => String(v ?? '').toLowerCase())
      return hay.some(v => v.includes(text))
    })
  }, [entries, q, userFilter])
  const cellText = e => Array.isArray(e.Tuple) && e.Tuple.length ? e.Tuple.join(' · ') : ''
  const cellTitle = e => Array.isArray(e.Tuple)
    ? e.Tuple.map((v, i) => `${cubeDims?.[i] ?? `Dim ${i + 1}`}: ${v}`).join('\n')
    : ''

  return (
    <div className={cn('border-l border-border flex flex-col bg-sidebar overflow-hidden', fill ? 'flex-1 w-full min-w-0' : 'w-[28rem] shrink-0')}>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <History size={11} className="text-blue-400 shrink-0" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Transaction Log</span>
          <span className="text-[10px] font-mono text-foreground/70 truncate" title={cube}>{cube}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => fetch(tupleFilter)}
            title="Refresh"
            className="p-1 rounded text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
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

      {/* Filters */}
      {entries.length > 0 && (
        <div className="px-3 py-1.5 border-b border-border flex items-center gap-1.5 flex-wrap shrink-0">
          <select value={userFilter} onChange={e => setUserFilter(e.target.value)} title="Filter by TM1 user"
            className="text-[10px] bg-background border border-border rounded px-1.5 py-0.5 text-foreground max-w-[110px]">
            <option value="">All users</option>
            {users.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <div className="flex items-center gap-1 bg-background border border-border rounded px-1.5 py-0.5 flex-1 min-w-[140px]">
            <Search size={9} className="text-muted-foreground shrink-0" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter cell, user, value…"
              className="bg-transparent text-[10px] outline-none w-full placeholder:text-muted-foreground" />
            {q && <button onClick={() => setQ('')} className="text-muted-foreground hover:text-foreground shrink-0"><X size={9} /></button>}
          </div>
          <span className="text-[9px] text-muted-foreground shrink-0">{visible.length}/{entries.length}</span>
          {(q || userFilter) && (
            <button onClick={() => { setQ(''); setUserFilter('') }} className="text-[9px] text-muted-foreground hover:text-foreground shrink-0" title="Clear filters">Clear</button>
          )}
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
            {filtered ? 'No transactions for this filter.' : 'No transactions found. Cube logging may be off (}CubeProperties → Logging).'}
          </p>
        )}
        {!log.isPending && !log.isError && entries.length > 0 && visible.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground italic">No transactions match these filters.</p>
        )}
        {visible.length > 0 && (
          <table className="w-full min-w-[520px] text-[10px] border-collapse">
            <thead>
              <tr className="sticky top-0 bg-sidebar border-b border-border">
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Time</th>
                <th className="text-left px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">User</th>
                <th className="text-left px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Cell</th>
                <th className="text-right px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Old</th>
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">New</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, i) => (
                <tr key={e.ID ?? i} className="border-b border-border/30 hover:bg-muted/20">
                  <td className="px-3 py-1 text-foreground/60 whitespace-nowrap">{fmt(e.TimeStamp)}</td>
                  <td className="px-2 py-1 font-mono text-foreground/70 max-w-[80px] truncate" title={e.User}>{e.User}</td>
                  <td className="px-2 py-1 font-mono text-foreground/60 max-w-[150px] truncate" title={cellTitle(e)}>{cellText(e) || '—'}</td>
                  <td className="px-2 py-1 text-right font-mono text-red-400/80 whitespace-nowrap"><Val v={e.OldValue} /></td>
                  <td className="px-3 py-1 text-right font-mono text-emerald-400 whitespace-nowrap"><Val v={e.NewValue} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {entries.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border shrink-0 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{visible.length === entries.length ? entries.length : `${visible.length} of ${entries.length}`} entr{(visible.length === entries.length ? entries.length : visible.length) === 1 ? 'y' : 'ies'}{entries.length === 200 ? ' (max)' : ''}</span>
          {(filtered || q || userFilter) && <span className="italic">filter active</span>}
        </div>
      )}
    </div>
  )
}
