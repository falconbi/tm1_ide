import { useState } from 'react'
import { Play, X } from 'lucide-react'
import { PARAM_TYPE } from '@/lib/process-editor/constants'

export default function RunDialog({ params, onRun, onClose, isPending, title = 'Run Process' }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries((params ?? []).map(p => [p.Name, String(p.Value ?? '')]))
  )

  const set = (name, val) => setValues(v => ({ ...v, [name]: val }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">{title}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        {/* Params */}
        <div className="px-4 py-3 space-y-3 max-h-80 overflow-auto">
          {!params?.length ? (
            <p className="text-xs text-muted-foreground">No parameters — process will run immediately.</p>
          ) : params.map(p => (
            <div key={p.Name} className="space-y-1">
              <label className="flex items-center gap-2 text-xs font-medium">
                <span className="font-mono">{p.Name}</span>
                <span className="text-muted-foreground">{PARAM_TYPE[p.Type] ?? p.Type}</span>
                {p.Prompt && <span className="text-muted-foreground/70 truncate">{p.Prompt}</span>}
              </label>
              <input
                type={p.Type === 1 || p.Type === 'Numeric' ? 'number' : 'text'}
                value={values[p.Name] ?? ''}
                onChange={e => set(p.Name, e.target.value)}
                className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onRun(values)}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            <Play size={11} />
            {isPending ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  )
}
