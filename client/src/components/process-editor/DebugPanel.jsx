import { useState, useRef, useEffect } from 'react'
import { Play, X, Bug, Loader2, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CAPTURE_WHEN_HELP } from '@/lib/process-editor/constants'

export default function DebugPanel({ watches, onWatchesChange, events, isDebugging, onRun, onJumpTo, availableVars, captureWhen, onCaptureWhenChange }) {
  const [newName, setNewName] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const addVar = (v) => {
    if (!v || watches.some(w => w.name.toLowerCase() === v.name.toLowerCase())) return
    onWatchesChange([...watches, { name: v.name, type: v.type }])
    setNewName('')
    setFilterText('')
    setActiveIndex(0)
    setDropdownOpen(false)
  }

  const filteredVars = (availableVars ?? []).filter(v => {
    if (!filterText) return true
    const lo = filterText.toLowerCase()
    return v.name.toLowerCase().includes(lo) || v.section.toLowerCase().includes(lo)
  })

  const addWatch = () => {
    const name = newName.trim()
    const known = dropdownOpen && filteredVars[activeIndex]
      ? filteredVars[activeIndex]
      : (availableVars ?? []).find(v => v.name.toLowerCase() === name.toLowerCase())
    addVar(known)
  }

  const selectVar = (v) => addVar(v)

  // Group events into frames anchored at each breakpoint hit
  const frames = []
  let cur = null
  for (const evt of events) {
    if (evt.type === 'breakpoint') {
      if (cur) frames.push(cur)
      cur = { section: evt.section, line: evt.line, watches: [], logs: [] }
    } else if (evt.type === 'watch' && cur) {
      cur.watches.push(evt)
    } else if (evt.type === 'log') {
      if (cur) cur.logs.push(evt.message)
      else frames.push({ section: null, line: null, watches: [], logs: [evt.message] })
    }
  }
  if (cur) frames.push(cur)

  const SECTION_COLOR = {
    Prolog: 'text-blue-400', Metadata: 'text-purple-400',
    Data: 'text-green-400',  Epilog: 'text-orange-400',
  }

  return (
    <div className="w-72 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
      {/* Header + run */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <Bug size={11} /> Debug capture
        </span>
        <button
          onClick={onRun}
          disabled={isDebugging}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-emerald-700 text-white disabled:opacity-40 hover:bg-emerald-600 transition-colors"
        >
          {isDebugging ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
          {isDebugging ? 'Capturing…' : 'Run and capture'}
        </button>
      </div>

      {/* Watch variables */}
      <div className="shrink-0 border-b border-border">
        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Watches
        </div>
        {watches.length === 0 && (
          <div className="px-3 pb-2 text-xs italic text-muted-foreground">None added</div>
        )}
        {watches.map((w, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-0.5 group hover:bg-muted/50">
            <span className="flex-1 text-xs font-mono truncate">{w.name}</span>
            <span className="text-[10px] text-muted-foreground w-7 shrink-0">{w.type === 'number' ? 'num' : 'str'}</span>
            <button
              onClick={() => onWatchesChange(watches.filter((_, idx) => idx !== i))}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <div className="px-2 pt-1 pb-2 border-t border-border/50" ref={dropdownRef}>
          <div className="relative w-full">
            <input
              value={dropdownOpen ? filterText : newName}
              onChange={e => {
                const v = e.target.value
                setActiveIndex(0)
                if (dropdownOpen) {
                  setFilterText(v)
                  setNewName(v)
                } else {
                  setNewName(v)
                }
              }}
              onFocus={() => { setDropdownOpen(true); setFilterText(newName); setActiveIndex(0) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { addWatch(); e.preventDefault() }
                if (e.key === 'Escape') setDropdownOpen(false)
                if (e.key === 'ArrowDown' && filteredVars.length > 0) {
                  e.preventDefault()
                  setActiveIndex(i => Math.min(i + 1, filteredVars.length - 1))
                }
                if (e.key === 'ArrowUp' && filteredVars.length > 0) {
                  e.preventDefault()
                  setActiveIndex(i => Math.max(i - 1, 0))
                }
              }}
              placeholder="Find variable…  (Enter to add)"
              className="w-full text-xs font-mono bg-muted border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {dropdownOpen && filteredVars.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 w-full max-h-48 overflow-auto bg-popover border border-border rounded shadow-lg z-50">
                {filteredVars.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => selectVar(v)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn('w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted text-left', i === activeIndex && 'bg-muted')}
                  >
                    <span className={cn(
                      'font-mono flex-1 truncate',
                      v.section === 'Param' ? 'text-amber-400' : 'text-foreground'
                    )}>{v.name}</span>
                    <span className={cn(
                      'text-[10px] shrink-0',
                      v.section === 'Prolog' ? 'text-blue-400' :
                      v.section === 'Metadata' ? 'text-purple-400' :
                      v.section === 'Data' ? 'text-green-400' :
                      v.section === 'Epilog' ? 'text-orange-400' :
                      v.section === 'Param' ? 'text-amber-400' : 'text-muted-foreground'
                    )}>{v.section}{v.line ? `:${v.line}` : ''}</span>
                    <span className="text-[10px] text-muted-foreground w-7 shrink-0 text-right">{v.type === 'number' ? 'num' : 'str'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="px-2 pb-2">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider cursor-help" title={CAPTURE_WHEN_HELP}>Capture when</span>
              <HelpCircle size={10} className="text-muted-foreground/60 cursor-help" title={CAPTURE_WHEN_HELP} />
              {captureWhen?.trim() && <span className="text-[9px] px-1 py-px rounded bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400">filter</span>}
            </div>
            <input
              value={captureWhen ?? ''}
              onChange={e => onCaptureWhenChange(e.target.value)}
              title={CAPTURE_WHEN_HELP}
              placeholder="TI condition, e.g. nBad = 1"
              className="w-full text-xs font-mono bg-muted border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      {/* Trace output */}
      <div className="flex-1 overflow-auto">
        {events.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground italic leading-relaxed">
            Click the margin to add a capture point, add watches above, then Run and capture. The process runs to completion; watches are recorded each time execution reaches a capture point.
          </p>
        ) : (
          <div className="py-1">
            {frames.map((f, fi) => (
              <div key={fi} className="border-b border-border/30 last:border-0 pb-1 mb-1">
                {f.line != null && (
                  <button
                    onClick={() => onJumpTo(f.section, f.line)}
                    className={cn(
                      'flex items-center gap-1 w-full px-3 py-1 text-xs hover:bg-muted/50 font-semibold',
                      SECTION_COLOR[f.section] ?? 'text-muted-foreground'
                    )}
                  >
                    {f.section}
                    <span className="font-normal text-muted-foreground ml-0.5">:{f.line}</span>
                  </button>
                )}
                {f.watches.map((w, wi) => (
                  <div key={wi} className="flex items-baseline gap-1 px-4 py-0.5">
                    <span className="text-xs font-mono text-foreground/80 shrink-0">{w.name}</span>
                    <span className="text-[10px] text-muted-foreground mx-0.5">=</span>
                    <span className="text-xs font-mono text-primary truncate">{w.value}</span>
                  </div>
                ))}
                {f.logs.map((msg, li) => (
                  <div key={li} className="px-3 py-0.5 text-xs font-mono text-muted-foreground/80 break-all leading-relaxed">{msg}</div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
