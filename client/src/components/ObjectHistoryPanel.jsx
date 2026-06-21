import { useState } from 'react'
import { X, GitBranch, RotateCcw, Diff, Loader2 } from 'lucide-react'
import { useObjectHistory, useRollbackEntry } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import DiffViewerModal from './DiffViewerModal'

const ACTION_COLOUR = {
  RULES_SAVED:   'text-amber-400',
  PROCESS_SAVED: 'text-blue-400',
  SUBSET_SAVED:  'text-blue-400',
  VIEW_SAVED:    'text-blue-400',
  ROLLED_BACK:   'text-purple-400',
}

function fmtDateTime(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return ts }
}

export default function ObjectHistoryPanel({ server, objectType, objectName, onClose }) {
  const [diffEntry,  setDiffEntry]  = useState(null)
  const [rollbackId, setRollbackId] = useState(null)

  const { data: entries = [], isFetching, refetch } = useObjectHistory(server, objectType, objectName)
  const rollback = useRollbackEntry()

  const handleRollback = async (entry) => {
    if (!confirm(`Restore "${objectName}" to its state from ${fmtDateTime(entry.timestamp)}?\n\nThis will overwrite the current version on the server.`)) return
    setRollbackId(entry.id)
    try {
      await rollback.mutateAsync({ entryId: entry.id, server })
      refetch()
    } finally {
      setRollbackId(null)
    }
  }

  return (
    <>
      <div className="absolute right-0 top-0 bottom-0 w-[340px] bg-popover border-l border-border shadow-xl z-30 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <GitBranch size={13} className="text-muted-foreground" />
            <div className="min-w-0">
              <div className="text-xs font-semibold">History</div>
              <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">{objectName}</div>
            </div>
            {isFetching && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={12} />
          </button>
        </div>

        {/* Entry list */}
        <div className="overflow-auto flex-1">
          {entries.length === 0 && !isFetching && (
            <p className="px-4 py-8 text-xs text-muted-foreground italic text-center">
              No history yet. Save this object while a session is active to start tracking.
            </p>
          )}

          {entries.map((entry, i) => {
            const hasDiff     = !!(entry.before_state && entry.after_state)
            const hasRollback = !!entry.before_state && entry.action !== 'ROLLED_BACK'
            const isLatest    = i === 0

            return (
              <div key={entry.id} className={cn('border-b border-border/40 px-3 py-2', isLatest && 'bg-muted/10')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isLatest && (
                        <span className="text-[9px] bg-primary/20 text-primary px-1 rounded shrink-0">latest</span>
                      )}
                      <span className={cn('text-[10px] font-medium', ACTION_COLOUR[entry.action] ?? 'text-muted-foreground')}>
                        {entry.action.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDateTime(entry.timestamp)}</div>
                    {entry.session_name && (
                      <div className="text-[10px] text-muted-foreground/50 font-mono truncate">{entry.session_name}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    {hasDiff && (
                      <button
                        onClick={() => setDiffEntry(entry)}
                        title="View diff (before → after)"
                        className="p-1.5 rounded hover:bg-muted text-emerald-500/70 hover:text-emerald-400 transition-colors"
                      >
                        <Diff size={12} />
                      </button>
                    )}
                    {hasRollback && (
                      <button
                        onClick={() => handleRollback(entry)}
                        disabled={rollbackId === entry.id}
                        title="Restore to this state"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-amber-400 transition-colors disabled:opacity-40"
                      >
                        {rollbackId === entry.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <RotateCcw size={12} />
                        }
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {diffEntry && <DiffViewerModal entry={diffEntry} onClose={() => setDiffEntry(null)} />}
    </>
  )
}
