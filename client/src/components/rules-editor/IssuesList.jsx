import { AlertTriangle, AlertCircle, X } from 'lucide-react'

export default function IssuesList({ errors, onClear, onJump }) {
  if (!errors.length) return null
  return (
    <div className="shrink-0 border-t border-border bg-background max-h-40 overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border sticky top-0 bg-background z-10">
        <span className="text-[11px] font-medium text-muted-foreground">
          {errors.filter(e => e.severity === 'error').length} error{errors.filter(e => e.severity === 'error').length !== 1 ? 's' : ''}
          {errors.filter(e => e.severity === 'warning').length > 0 && ` · ${errors.filter(e => e.severity === 'warning').length} warning${errors.filter(e => e.severity === 'warning').length !== 1 ? 's' : ''}`}
        </span>
        <button onClick={onClear} className="text-muted-foreground hover:text-foreground transition-colors">
          <X size={11} />
        </button>
      </div>
      {errors.map((e, i) => (
        <button
          key={i}
          onClick={() => onJump(e.line)}
          className="w-full flex items-start gap-2.5 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors group"
        >
          {e.severity === 'warning'
            ? <AlertTriangle size={11} className="text-amber-400 mt-0.5 shrink-0" />
            : <AlertCircle size={11} className="text-red-400 mt-0.5 shrink-0" />}
          <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-8 text-right">{e.line}</span>
          <span className="text-[11px] text-foreground/80 group-hover:text-foreground transition-colors">{e.message}</span>
        </button>
      ))}
    </div>
  )
}
