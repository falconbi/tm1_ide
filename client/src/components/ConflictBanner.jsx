import { AlertTriangle, X } from 'lucide-react'

export function ConflictBanner({ conflict, onDismiss }) {
  if (!conflict) return null
  const when = conflict.timestamp
    ? new Date(conflict.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/30 text-amber-400 text-xs shrink-0">
      <AlertTriangle size={12} className="shrink-0" />
      <span className="flex-1">
        <span className="font-medium">{conflict.user}</span> saved this{when && ` at ${when}`} while you had it open — saving may overwrite their changes
      </span>
      <button onClick={onDismiss} className="p-0.5 rounded hover:bg-amber-500/20 text-amber-400/70 hover:text-amber-400">
        <X size={11} />
      </button>
    </div>
  )
}

export function ConflictSaveWarning({ conflict, onSaveAnyway, onCancel }) {
  if (!conflict) return null
  const when = conflict.timestamp
    ? new Date(conflict.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/40">
      <div className="w-96 bg-popover border border-border rounded-lg shadow-xl p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold">Concurrent edit detected</div>
            <div className="text-xs text-muted-foreground mt-1">
              <span className="font-medium text-foreground">{conflict.user}</span>
              {when && ` saved at ${when}`} while you were editing. Saving now will overwrite their changes.
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          <button onClick={onSaveAnyway} className="px-3 py-1.5 text-xs rounded bg-amber-600 text-white hover:bg-amber-500">
            Save anyway
          </button>
        </div>
      </div>
    </div>
  )
}
