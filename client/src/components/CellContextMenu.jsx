import { useEffect, useRef } from 'react'
import { X, Zap } from 'lucide-react'

export default function CellContextMenu({ ctx, onClose, onTrace }) {
  const ref = useRef(null)

  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const key  = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose])

  const x = Math.min(ctx.x, window.innerWidth  - 320)
  const y = Math.min(ctx.y, window.innerHeight - 120)

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: y, left: x, zIndex: 9999, width: 320 }}
      className="bg-popover border border-border rounded-lg shadow-xl overflow-hidden"
    >
      {/* ── Header ── */}
      <div className="flex items-start gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-semibold">{ctx.cube}</span>
            {!ctx.isAllLeaf
              ? <span className="badge bg-purple-500/20 text-purple-400">CONSOLIDATED</span>
              : <span className="badge bg-muted text-muted-foreground">LEAF</span>
            }
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {ctx.dimElemPairs.map(p => p.element).join(' · ')}
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
          <X size={12} />
        </button>
      </div>

      {/* ── Action bar ── */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          onClick={() => { onTrace(ctx); onClose() }}
          title="Show the rule chain for this cell"
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Zap size={10} /> Trace
        </button>
      </div>
    </div>
  )
}
