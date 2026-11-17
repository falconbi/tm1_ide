import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TYPE_ICON, TYPE_COLOR } from '@/lib/dimension-editor/constants'

export default function AddRow({ onConfirm, onCancel, beforeOptions = [] }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('N')
  const [direction, setDirection] = useState('before')
  const [target, setTarget] = useState('')
  const insertBefore = () => {
    if (!target) return null
    const at = beforeOptions.indexOf(target)
    if (direction === 'before' || at < 0) return target
    return beforeOptions[at + 1] ?? null
  }
  const confirm = () => { if (name.trim()) onConfirm(name.trim(), type, insertBefore()) }
  return (
    <div className="py-1 px-1 bg-muted/40 rounded mb-1">
      <div className="flex items-center gap-1">
        <span className={cn('shrink-0 text-[10px] w-3', TYPE_COLOR[type])}>{TYPE_ICON[type]}</span>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onCancel() }}
          placeholder="element name…"
          className="flex-1 text-xs font-mono bg-transparent border-b border-primary outline-none py-px min-w-0" />
        <select value={type} onChange={e => setType(e.target.value)}
          className="text-[10px] bg-background border border-border rounded px-1 py-px text-muted-foreground shrink-0">
          <option value="N">Leaf</option>
          <option value="C">Consol</option>
          <option value="S">String</option>
        </select>
        <button onClick={confirm} className="p-1 text-primary shrink-0"><Check size={11} /></button>
        <button onClick={onCancel} className="p-1 text-muted-foreground shrink-0"><X size={11} /></button>
      </div>
      {beforeOptions.length > 0 && (
        <div className="flex items-center gap-1 mt-1 pl-4 text-[10px] text-muted-foreground">
          <span>Insert</span>
          <select value={direction} onChange={e => setDirection(e.target.value)}
            className="text-[10px] bg-background border border-border rounded px-1 py-px shrink-0">
            <option value="before">before</option>
            <option value="after">after</option>
          </select>
          <select value={target} onChange={e => setTarget(e.target.value)}
            className="text-[10px] bg-background border border-border rounded px-1 py-px max-w-[140px]">
            <option value="">— at end —</option>
            {beforeOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}
