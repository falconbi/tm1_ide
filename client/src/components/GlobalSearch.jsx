import { useState, useRef, useEffect } from 'react'
import { useSearchProcesses } from '@/hooks/useApi'
import { X, Search, Cog, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const SECTION_STYLE = {
  Prolog:   'bg-blue-500/20 text-blue-400',
  Metadata: 'bg-purple-500/20 text-purple-400',
  Data:     'bg-green-500/20 text-green-400',
  Epilog:   'bg-orange-500/20 text-orange-400',
}

function highlight(text, q) {
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return <span>{text}</span>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-400/30 text-yellow-200 not-italic rounded-sm px-px">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

export default function GlobalSearch({ server, onOpen, onClose }) {
  const [query, setQuery]   = useState('')
  const [results, setResults] = useState(null)
  const inputRef = useRef(null)
  const searchMut = useSearchProcesses()

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 0) }, [])

  const run = () => {
    if (!query.trim()) return
    searchMut.mutate({ server, q: query.trim() }, {
      onSuccess: r => setResults(r.results ?? []),
      onError:   () => setResults([]),
    })
  }

  const grouped = results
    ? results.reduce((acc, r) => { (acc[r.process] ??= []).push(r); return acc }, {})
    : null

  const totalProcesses = grouped ? Object.keys(grouped).length : 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/60" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[72vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Search size={14} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') run(); if (e.key === 'Escape') onClose() }}
            placeholder="Search across all TI processes…"
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
          {searchMut.isPending && <Loader2 size={13} className="animate-spin text-muted-foreground shrink-0" />}
          <button
            onClick={run}
            disabled={!query.trim() || searchMut.isPending}
            className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            Search
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 ml-1">
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 min-h-0 overflow-auto">
          {grouped === null && (
            <p className="px-4 py-8 text-sm text-muted-foreground text-center">
              Search Prolog, Metadata, Data and Epilog across all processes.
              <br /><span className="text-xs opacity-60">Ctrl+Shift+F to open · Escape to close</span>
            </p>
          )}
          {grouped !== null && totalProcesses === 0 && (
            <p className="px-4 py-8 text-sm text-muted-foreground text-center">No matches for "{query}".</p>
          )}
          {grouped !== null && Object.entries(grouped).map(([procName, matches]) => (
            <div key={procName} className="border-b border-border last:border-0">
              <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/40 sticky top-0">
                <Cog size={11} className="text-muted-foreground shrink-0" />
                <button
                  onClick={() => { onOpen(procName); onClose() }}
                  className="text-xs font-semibold font-mono hover:text-primary truncate text-left"
                >
                  {procName}
                </button>
                <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
                  {matches.length} match{matches.length !== 1 ? 'es' : ''}
                </span>
              </div>
              {matches.map((m, i) => (
                <button
                  key={i}
                  onClick={() => { onOpen(procName, m.section, m.line); onClose() }}
                  className="flex items-center gap-3 w-full px-4 py-1.5 hover:bg-muted/50 text-left group"
                >
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 w-16 text-center', SECTION_STYLE[m.section] ?? 'bg-muted text-muted-foreground')}>
                    {m.section}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0 w-8 text-right">{m.line}</span>
                  <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground truncate">
                    {highlight(m.preview, query)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        {results !== null && (
          <div className="px-4 py-1.5 border-t border-border shrink-0 text-[10px] text-muted-foreground">
            {results.length} match{results.length !== 1 ? 'es' : ''} in {totalProcesses} process{totalProcesses !== 1 ? 'es' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
