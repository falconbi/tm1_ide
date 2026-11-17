import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

export default function CollapsibleSection({ label, hint, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="shrink-0 border-b border-border">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-xs transition-colors"
      >
        {open ? <ChevronDown size={11} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={11} className="shrink-0 text-muted-foreground" />}
        <span className="font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        {hint && <span className="text-muted-foreground/60 font-mono normal-case tracking-normal ml-1">{hint}</span>}
      </button>
      {open && <div className="max-h-48 overflow-auto border-t border-border">{children}</div>}
    </div>
  )
}
