import { useState } from 'react'
import { X } from 'lucide-react'

export default function SaveAsDialog({ sourceName, onSave, onClose, isPending }) {
  const [name, setName] = useState(`${sourceName}_copy`)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Save As</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>
        <div className="px-4 py-3">
          <label className="text-xs text-muted-foreground block mb-1.5">New process name</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); if (e.key === 'Escape') onClose() }}
            className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors">Cancel</button>
          <button
            onClick={() => name.trim() && onSave(name.trim())}
            disabled={!name.trim() || isPending}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {isPending ? 'Creating…' : 'Save As'}
          </button>
        </div>
      </div>
    </div>
  )
}
