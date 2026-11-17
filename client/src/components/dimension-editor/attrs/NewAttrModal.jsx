import { useState } from 'react'
import { cn } from '@/lib/utils'

export default function NewAttrModal({ onConfirm, onClose }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('String')
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg p-4 w-72 shadow-xl" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold mb-3">New Attribute</p>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder="Attribute name (e.g. DOB)"
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim(), type) }}
          className="w-full text-xs bg-muted border border-border rounded px-2 py-1.5 mb-2 outline-none focus:border-primary" />
        <div className="flex gap-2 mb-3">
          {['String', 'Numeric', 'Alias'].map(t => (
            <button key={t} onClick={() => setType(t)}
              className={cn('flex-1 text-xs px-2 py-1 rounded border transition-colors',
                type === t ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted')}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => name.trim() && onConfirm(name.trim(), type)}
            disabled={!name.trim()}
            className="flex-1 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-40">
            Create
          </button>
          <button onClick={onClose} className="flex-1 text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
