import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Sparkles, Pencil, Check, X, RefreshCw, AlertTriangle, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Review / generate the sidecar "what does this process do" summaries shown in the
// Data sources hover. Stored in data/process-summaries.json — the TI is never edited.
export default function ProcessSummariesDialog({ open, onClose, server, cube, writers, aiConfigured, onChanged }) {
  const [rows, setRows] = useState({})
  const [busy, setBusy] = useState(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const [scope, setScope] = useState('cube')
  const [all, setAll] = useState([])
  const cancelRef = useRef(false)

  const writersRef = useRef(writers)
  useEffect(() => { writersRef.current = writers }, [writers])
  useEffect(() => {
    if (!open) return
    setRows(Object.fromEntries(writersRef.current.map(w => [w.process, {
      summary: w.summary ?? null, at: w.summaryAt ?? null, source: w.summarySource ?? null, stale: !!w.summaryStale,
    }])))
    setEditing(null); setError(null); setRunning(false); cancelRef.current = false; setScope('cube'); setAll([])
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/process/summaries?server=${encodeURIComponent(server)}`, { headers: { 'x-ide-token': token() } })
        const d = await r.json()
        if (!r.ok || d.error) throw new Error(d.error || r.statusText)
        if (cancelled) return
        const list = d.processes ?? []
        setAll(list)
        setRows(prev => {
          const next = { ...prev }
          for (const p of list) if (!(p.process in next)) next[p.process] = { summary: p.summary, at: p.at, source: p.sourceKind, stale: p.stale }
          return next
        })
      } catch (e) { if (!cancelled) setError(`Could not load all processes: ${e.message}`) }
    })()
    return () => { cancelled = true }
  }, [open, server])

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const cubeList = writers.map(w => ({ process: w.process, header: w.header, parameters: w.parameters, kinds: w.kinds }))
  const visible = scope === 'cube' ? cubeList : all.map(p => ({ process: p.process, header: p.header, parameters: p.parameters }))
  const staleCount = useMemo(() => visible.filter(w => !rows[w.process]?.summary || rows[w.process]?.stale).length, [visible, rows])
  if (!open) return null

  function token() { return localStorage.getItem('tm1-token') ?? '' }

  async function generate(name, force) {
    setBusy(name); setError(null)
    try {
      const r = await fetch('/api/process/summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ide-token': token() },
        body: JSON.stringify({ server, name, force }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      setRows(prev => ({ ...prev, [name]: { summary: d.summary, at: d.at, source: d.source, stale: false } }))
      onChanged?.()
      return true
    } catch (e) {
      setError(`${name}: ${e.message}`)
      return false
    } finally { setBusy(null) }
  }

  async function generateList(names, force) {
    if (!names.length) return
    setRunning(true); cancelRef.current = false
    setProgress({ done: 0, total: names.length })
    for (let i = 0; i < names.length; i++) {
      if (cancelRef.current) break
      await generate(names[i], force)
      setProgress({ done: i + 1, total: names.length })
    }
    setRunning(false)
  }

  async function saveEdit(name) {
    setBusy(name); setError(null)
    try {
      const r = await fetch('/api/process/summary', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-ide-token': token() },
        body: JSON.stringify({ server, name, summary: draft }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      setRows(prev => ({ ...prev, [name]: { summary: d.summary, at: d.at, source: d.source, stale: false } }))
      setEditing(null)
      onChanged?.()
    } catch (e) { setError(`${name}: ${e.message}`) }
    finally { setBusy(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-popover border border-border rounded-lg shadow-2xl w-[860px] max-w-[calc(100vw-2rem)] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-2 px-4 py-3 border-b border-border shrink-0">
          <Sparkles size={14} className="text-sky-400 mt-0.5" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Process summaries — {cube}</div>
            <div className="text-[11px] text-muted-foreground">
              Plain-English notes shown in the Data sources hover. Stored outside the TI (<span className="font-mono">data/process-summaries.json</span>) — no code changes.
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1 mr-1">
            {[['cube', `This cube (${writers.length})`], ['all', `All processes (${all.length})`]].map(([id, label]) => (
              <button key={id} onClick={() => setScope(id)}
                className={cn('px-2 py-0.5 rounded text-[10px] border',
                  scope === id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted')}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"><X size={13} /></button>
        </div>

        {!aiConfigured && (
          <div className="flex items-start gap-2 px-4 py-2 border-b border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-500">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>AI is not configured, so generation is off. Set <span className="font-mono">AI_PROVIDER</span> and <span className="font-mono">AI_API_KEY</span> in <span className="font-mono">.env</span> (or use a local OpenAI-compatible model). You can still write and edit summaries by hand below.</span>
          </div>
        )}
        {error && (
          <div className="px-4 py-2 border-b border-red-500/30 bg-red-500/10 text-[11px] text-red-400">{error}</div>
        )}

        <div className="flex-1 min-h-0 overflow-auto divide-y divide-border/60">
          {visible.length === 0 && <div className="p-4 text-xs text-muted-foreground italic">{scope === 'cube' ? 'No TI writers for this cube.' : 'No processes on this server.'}</div>}
          {visible.map(w => {
            const row = rows[w.process] ?? {}
            const isEditing = editing === w.process
            const status = row.summary ? (row.stale ? 'stale' : row.source === 'manual' ? 'manual' : 'ai') : 'missing'
            return (
              <div key={w.process} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-foreground truncate">{w.process}</span>
                  <span className={cn('px-1.5 py-px rounded text-[9px] uppercase tracking-wider border',
                    status === 'missing' ? 'border-border text-muted-foreground' :
                    status === 'stale' ? 'border-amber-500/40 text-amber-500 bg-amber-500/10' :
                    status === 'manual' ? 'border-sky-500/40 text-sky-400 bg-sky-500/10' :
                    'border-emerald-500/40 text-emerald-500 bg-emerald-500/10')}>
                    {status === 'ai' ? `AI${row.at ? ' · ' + row.at.slice(0, 10) : ''}` : status}
                  </span>
                  {w.kinds?.includes('clear') && <span className="text-[10px] text-muted-foreground">clears</span>}
                  {w.kinds?.includes('feeders') && <span className="text-[10px] text-muted-foreground">feeders</span>}
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => generate(w.process, !!row.summary)} disabled={!aiConfigured || running || busy === w.process}
                      title={aiConfigured ? (row.summary ? 'Regenerate with AI' : 'Generate with AI') : 'AI is not configured'}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40">
                      {busy === w.process ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                      {row.summary ? 'Regenerate' : 'Generate'}
                    </button>
                    <button onClick={() => { setEditing(w.process); setDraft(row.summary ?? '') }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted">
                      <Pencil size={10} /> Edit
                    </button>
                  </div>
                </div>
                {w.header && !isEditing && (
                  <div className="mt-1 text-[10px] text-muted-foreground/70 line-clamp-2 whitespace-pre-line">{w.header}</div>
                )}
                {isEditing ? (
                  <div className="mt-1.5">
                    <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} autoFocus
                      placeholder="What it does, what it writes, when it runs…"
                      className="w-full bg-background border border-border rounded px-2 py-1.5 text-[11px] outline-none focus:border-primary resize-y" />
                    <div className="flex items-center gap-1.5 mt-1">
                      <button onClick={() => saveEdit(w.process)} disabled={!draft.trim() || busy === w.process}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] disabled:opacity-40">
                        {busy === w.process ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Save
                      </button>
                      <button onClick={() => setEditing(null)} className="px-2 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground">Cancel</button>
                    </div>
                  </div>
                ) : row.summary ? (
                  <p className="mt-1 text-[11px] text-foreground/80 whitespace-pre-line">{row.summary}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground/60 italic">No summary yet — the hover falls back to the TI header and the write statements.</p>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border shrink-0">
          <button onClick={() => {
            const names = visible.filter(w => !rows[w.process]?.summary || rows[w.process]?.stale).map(w => w.process)
            if (scope === 'all' && names.length > 5 && !window.confirm(`Generate ${names.length} summaries with AI? That calls the model once per process.`)) return
            generateList(names, false)
          }}
            disabled={!aiConfigured || running || staleCount === 0}
            className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground text-[11px] disabled:opacity-40">
            {running ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            Generate missing{staleCount ? ` (${staleCount})` : ''}
          </button>
          <button onClick={() => { if (window.confirm(`Regenerate all ${visible.length} summaries with AI?`)) generateList(visible.map(w => w.process), true) }}
            disabled={!aiConfigured || running || visible.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40">
            <RefreshCw size={11} /> Regenerate all
          </button>
          {running && (
            <>
              <span className="text-[10px] text-muted-foreground">{progress.done}/{progress.total}</span>
              <button onClick={() => { cancelRef.current = true }} className="px-2 py-1 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground">Stop</button>
            </>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">{visible.length} process{visible.length !== 1 ? 'es' : ''}</span>
          <button onClick={onClose} className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground">Close</button>
        </div>
      </div>
    </div>
  )
}
