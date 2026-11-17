import { useState } from 'react'
import { X } from 'lucide-react'

// ── Bulk add modal ──────────────────────────────────────────────────────────
export default function BulkAddModal({ consolElements, roots = [], childrenOf = {}, onConfirm, onClose }) {
  const [text, setText] = useState('')
  const [type, setType] = useState('N')
  const [parent, setParent] = useState('')
  const [direction, setDirection] = useState('before')
  const [target, setTarget] = useState('')

  const names = text.split('\n').map(s => s.trim()).filter(Boolean)
  const candidates = parent ? (childrenOf[parent] ?? []) : roots
  const pick = candidates.includes(target) ? target : ''
  const anchor = () => {
    if (!pick) return null
    const at = candidates.indexOf(pick)
    if (direction === 'before') return pick
    return candidates[at + 1] ?? null
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg w-[420px] shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Bulk Add Elements</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Paste element names — one per line</label>
            <textarea
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={"Revenue\nExpenses\nEBITDA\n..."}
              rows={8}
              className="w-full text-xs font-mono bg-muted border border-border rounded p-2 outline-none resize-none focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground shrink-0">Type:</span>
            {[['N','○ Leaf','text-blue-400'], ['C','◆ Consol','text-orange-400'], ['S','" String','text-green-400']].map(([v, label, col]) => (
              <label key={v} className="flex items-center gap-1 text-xs cursor-pointer">
                <input type="radio" name="btype" value={v} checked={type === v} onChange={() => setType(v)} />
                <span className={col}>{label}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Parent:</span>
            <select value={parent} onChange={e => setParent(e.target.value)}
              className="flex-1 text-xs bg-muted border border-border rounded px-2 py-1 outline-none">
              <option value="">None (root element)</option>
              {consolElements.map(e => <option key={e.Name} value={e.Name}>{e.Name}</option>)}
            </select>
          </div>
          {candidates.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Position:</span>
              <select value={direction} onChange={e => setDirection(e.target.value)}
                className="text-xs bg-muted border border-border rounded px-2 py-1 outline-none shrink-0">
                <option value="before">before</option>
                <option value="after">after</option>
              </select>
              <select value={pick} onChange={e => setTarget(e.target.value)}
                className="flex-1 text-xs bg-muted border border-border rounded px-2 py-1 outline-none min-w-0">
                <option value="">at end</option>
                {candidates.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}
          {type === 'S' && parent && (
            <div className="text-xs text-red-400">String elements cannot be added under a consolidation.</div>
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground">{names.length} element{names.length !== 1 ? 's' : ''} to add</span>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 text-xs border border-border rounded text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              onClick={() => names.length > 0 && onConfirm(names, type, parent || null, anchor())}
              disabled={names.length === 0 || (type === 'S' && !!parent)}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded disabled:opacity-40">
              Add {names.length > 0 ? names.length : ''} Element{names.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
