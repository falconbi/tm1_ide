import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'

function cleanInsert(code) {
  return code
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{0\}/g, '')
    .replace(/\$0/g, '')
}

export default function SnippetPanel({ snippets, onInsert }) {
  const allCats = useMemo(() => [...new Set(snippets.map(s => s.category))], [snippets])
  const [openCats, setOpenCats] = useState(() => new Set(allCats))
  const [query, setQuery] = useState('')

  const toggleCat = (cat) =>
    setOpenCats(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })

  const q = query.toLowerCase().trim()

  const filtered = useMemo(() =>
    q
      ? snippets.filter(s =>
          s.label.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.trigger.toLowerCase().includes(q)
        )
      : snippets
  , [snippets, q])

  const categories = useMemo(() => {
    const map = new Map()
    for (const s of filtered) {
      if (!map.has(s.category)) map.set(s.category, [])
      map.get(s.category).push(s)
    }
    return map
  }, [filtered])

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="text-xs font-semibold">Snippets</div>
        <div className="text-[10px] text-muted-foreground">Click any snippet to insert at cursor</div>
      </div>

      <div className="px-2 py-1.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 bg-muted rounded px-2 py-1">
          <Search size={10} className="text-muted-foreground shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter snippets…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60 min-w-0"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {categories.size === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground italic">No snippets match.</div>
        )}
        {[...categories.entries()].map(([cat, items]) => {
          const open = q ? true : openCats.has(cat)
          return (
            <div key={cat}>
              <button
                onClick={() => toggleCat(cat)}
                className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground border-b border-border/50 sticky top-0 bg-sidebar z-10"
              >
                {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <span className="flex-1 text-left">{cat}</span>
                <span className="font-mono normal-case tracking-normal text-muted-foreground/50">{items.length}</span>
              </button>
              {open && (
                <div className="py-0.5">
                  {items.map(s => (
                    <button
                      key={s.trigger}
                      onClick={() => onInsert(cleanInsert(s.code))}
                      className="w-full text-left px-3 py-1.5 hover:bg-sidebar-accent group border-b border-border/20"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-sidebar-foreground group-hover:text-sidebar-accent-foreground truncate">
                          {s.label}
                        </span>
                        <kbd className="ml-auto text-[9px] px-1 py-0.5 rounded bg-muted border border-border text-muted-foreground font-mono shrink-0">
                          {s.trigger}
                        </kbd>
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{s.description}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
