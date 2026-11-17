import { useEffect, useRef, useState } from 'react'
import { get } from '@/lib/api'
import { cn } from '@/lib/utils'

export default function ElementPicker({ server, dim, value, onChange, onCommit }) {
  const [open, setOpen]       = useState(false)
  const [search, setSearch]   = useState(value)
  const [elements, setElems]  = useState(null)   // null = not yet fetched
  const [loading, setLoading] = useState(false)
  const containerRef          = useRef(null)

  useEffect(() => { setSearch(value) }, [value])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const fetchElems = async () => {
    if (elements !== null) return
    setLoading(true)
    try {
      const d = await get(`/api/elements?server=${encodeURIComponent(server)}&dimension=${encodeURIComponent(dim)}`)
      setElems(Array.isArray(d) ? d.map(e => e.Name ?? e) : [])
    } catch { setElems([]) }
    finally { setLoading(false) }
  }

  const filtered = (elements ?? [])
    .filter(e => e.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 60)

  const select = (name) => {
    onChange(name)
    setSearch(name)
    setOpen(false)
    onCommit?.()
  }

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <input
        value={search}
        onChange={e => { setSearch(e.target.value); onChange(e.target.value) }}
        onFocus={() => { fetchElems(); setOpen(true) }}
        onKeyDown={e => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter') { if (filtered.length === 1) select(filtered[0]); else onCommit?.(); setOpen(false) }
        }}
        placeholder="search…"
        className="w-full bg-muted border border-border rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:border-primary"
      />
      {open && (
        <div className="absolute left-0 top-full mt-0.5 w-full z-50 bg-popover border border-border rounded shadow-lg max-h-48 overflow-y-auto">
          {loading && <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>}
          {!loading && filtered.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground italic">No matches</div>}
          {filtered.map(name => (
            <button
              key={name}
              onMouseDown={e => { e.preventDefault(); select(name) }}
              className={cn(
                'w-full text-left px-2 py-1 text-xs font-mono hover:bg-muted transition-colors truncate',
                name === value ? 'bg-primary/10 text-primary' : 'text-foreground'
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
