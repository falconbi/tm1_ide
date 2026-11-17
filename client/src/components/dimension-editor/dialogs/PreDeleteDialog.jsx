import { AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react'

export default function PreDeleteDialog({ check, elementName, onConfirm, onCancel }) {
  if (!check) return null
  const { blockers, warnings, info, can_delete } = check
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          {can_delete
            ? <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
          <span className="font-semibold text-sm">Delete &quot;{elementName}&quot;</span>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3 text-sm">
          {blockers.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 font-semibold text-red-500 mb-1.5">
                <XCircle className="w-3.5 h-3.5" /> Blockers — cannot delete
              </div>
              <ul className="space-y-1">
                {blockers.map((b, i) => (
                  <li key={i} className="text-xs bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5 text-red-700 dark:text-red-300">{b.message}</li>
                ))}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 font-semibold text-amber-500 mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Warnings — references will break
              </div>
              <ul className="space-y-1">
                {warnings.map((w, i) => (
                  <li key={i} className="text-xs bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5 text-amber-700 dark:text-amber-300">{w.message}</li>
                ))}
              </ul>
            </div>
          )}

          {info.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 font-semibold text-muted-foreground mb-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Info
              </div>
              <ul className="space-y-1">
                {info.map((n, i) => (
                  <li key={i} className="text-xs bg-muted/50 rounded px-2 py-1.5 text-muted-foreground">{n.message}</li>
                ))}
              </ul>
            </div>
          )}

          {blockers.length === 0 && warnings.length === 0 && info.length === 0 && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              No references found — safe to delete.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <button onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded border hover:bg-muted">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!can_delete}
            className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {can_delete ? 'Delete' : 'Cannot Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
