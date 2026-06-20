import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  X, PencilLine, Zap, History, MessageSquare, Copy, Sigma,
  Loader2, Check, Rss, Layers, Network, ExternalLink,
} from 'lucide-react'

const apiFetch = (path, opts = {}) => {
  const token = localStorage.getItem('tm1-token') ?? ''
  return fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-ide-token': token, ...(opts.headers ?? {}) },
  }).then(r => r.json())
}

// ── Cell type badge ────────────────────────────────────────────────────────────
function TypeBadge({ type }) {
  if (!type) return null
  const t = type.toLowerCase()
  if (t.includes('consol'))               return <span className="badge bg-purple-500/20 text-purple-400">CONSOLIDATED</span>
  if (t.includes('rule'))                 return <span className="badge bg-amber-500/20 text-amber-400">RULE</span>
  if (t.includes('feed'))                 return <span className="badge bg-blue-500/20 text-blue-400">FEEDER</span>
  if (t.includes('base') || t === 'leaf') return <span className="badge bg-emerald-500/20 text-emerald-400">BASE</span>
  return <span className="badge bg-muted text-muted-foreground">{type.toUpperCase()}</span>
}

// ── Shared micro-components ───────────────────────────────────────────────────
function Loading({ label }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground p-3">
      <Loader2 size={11} className="animate-spin" /> {label}
    </div>
  )
}
function ErrorMsg({ msg }) {
  return <div className="text-xs text-red-400 p-3">{msg}</div>
}
function Empty({ msg }) {
  return <div className="text-xs text-muted-foreground p-3">{msg}</div>
}

// ── Breakdown rows (shared by Breakdown + Leaves panels) ──────────────────────
function ContribRows({ rows }) {
  if (!rows.length) return <div className="text-xs text-muted-foreground">All values are zero.</div>
  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px]">
          <span className="text-foreground font-medium w-28 truncate shrink-0" title={r.element}>{r.element}</span>
          <div className="flex-1 bg-muted/40 rounded-full h-1.5 overflow-hidden min-w-0">
            <div
              className={cn('h-full rounded-full transition-all', r.value >= 0 ? 'bg-emerald-500' : 'bg-red-500')}
              style={{ width: `${r.pct}%` }}
            />
          </div>
          <span className={cn('font-mono tabular-nums shrink-0 w-20 text-right', r.value < 0 && 'text-red-400')}>
            {typeof r.value === 'number' ? r.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : r.value}
          </span>
          <span className="text-muted-foreground w-8 text-right shrink-0 text-[10px]">{r.pct}%</span>
        </div>
      ))}
    </div>
  )
}

// ── Trace panel ───────────────────────────────────────────────────────────────
function TracePanel({ server, cube, dimElemPairs }) {
  const [data,  setData]  = useState(null)
  const [error, setError] = useState(null)
  const [busy,  setBusy]  = useState(true)

  useEffect(() => {
    setBusy(true); setError(null); setData(null)
    apiFetch('/api/cube/trace', {
      method: 'POST',
      body: JSON.stringify({ server, cube, dimElemPairs }),
    })
      .then(d => { setBusy(false); d.error ? setError(d.error) : setData(d) })
      .catch(e => { setBusy(false); setError(e.message) })
  }, [server, cube, JSON.stringify(dimElemPairs)])  // eslint-disable-line

  if (busy)  return <Loading label="Tracing cell…" />
  if (error) return <ErrorMsg msg={error} />
  if (!data) return null

  const stmts = data.Statements ?? []
  const comps = data.Components ?? []

  return (
    <div className="p-3 space-y-2 text-xs max-h-64 overflow-y-auto">
      <div className="flex items-center gap-2">
        <TypeBadge type={data.Type} />
        <span className="text-muted-foreground">Value: <span className="text-foreground font-mono">{data.Value ?? '—'}</span></span>
      </div>

      {stmts.length > 0 && (
        <div className="space-y-1">
          {stmts.map((s, i) => (
            <div key={i} className="font-mono text-[11px] bg-muted/50 rounded px-2 py-1 break-all">{s}</div>
          ))}
        </div>
      )}

      {comps.length > 0 && (
        <div className="border-t border-border pt-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Components ({comps.length})</div>
          {comps.slice(0, 10).map((c, i) => {
            const tuple = (c.Tuple ?? []).map(t => t.Name).join(' · ')
            return (
              <div key={i} className="flex items-center gap-2 bg-muted/30 rounded px-2 py-1">
                <TypeBadge type={c.Type} />
                <span className="font-mono text-[10px] text-muted-foreground flex-1 truncate">
                  {c.Cube?.Name && <span className="text-foreground">{c.Cube.Name} </span>}[{tuple}]
                </span>
                <span className="font-mono text-[11px] shrink-0 tabular-nums">{c.Value ?? '—'}</span>
              </div>
            )
          })}
          {comps.length > 10 && <div className="text-[10px] text-muted-foreground">…and {comps.length - 10} more</div>}
        </div>
      )}
    </div>
  )
}

// ── Feeders panel ─────────────────────────────────────────────────────────────
function FeedersPanel({ server, cube, dimElemPairs }) {
  const [feeders, setFeeders] = useState(null)
  const [error,   setError]   = useState(null)
  const [busy,    setBusy]    = useState(true)

  useEffect(() => {
    setBusy(true); setError(null); setFeeders(null)
    apiFetch('/api/cube/feeders', {
      method: 'POST',
      body: JSON.stringify({ server, cube, dimElemPairs }),
    })
      .then(d => {
        setBusy(false)
        Array.isArray(d) ? setFeeders(d) : setError(d.error ?? 'Failed')
      })
      .catch(e => { setBusy(false); setError(e.message) })
  }, [server, cube, JSON.stringify(dimElemPairs)])  // eslint-disable-line

  if (busy)  return <Loading label="Checking feeders…" />
  if (error) return <ErrorMsg msg={error} />

  if (!feeders?.length) {
    return (
      <div className="p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-amber-400">
          <Rss size={11} /> No feeders found for this cell
        </div>
        <div className="text-[10px] text-muted-foreground">
          If this cell has a rule but shows zero, a feeder may be missing.
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 space-y-1.5 max-h-56 overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
        {feeders.length} feeder{feeders.length !== 1 ? 's' : ''} found
      </div>
      {feeders.map((f, i) => {
        const cubeName = f.Cube?.Name ?? cube
        const tuple    = (f.Tuple ?? []).map(t => t.Name).join(' · ')
        return (
          <div key={i} className="bg-blue-500/10 border border-blue-500/20 rounded px-2 py-1.5 text-[10px]">
            <span className="text-blue-400 font-medium">{cubeName}</span>
            {tuple && <span className="text-muted-foreground ml-1.5">[{tuple}]</span>}
          </div>
        )
      })}
    </div>
  )
}

// ── Transaction log panel ─────────────────────────────────────────────────────
function LogPanel({ server, cube, dimElemPairs, cubeDims }) {
  const [entries, setEntries] = useState(null)
  const [error,   setError]   = useState(null)
  const [busy,    setBusy]    = useState(true)

  useEffect(() => {
    setBusy(true); setError(null)
    const dimMap   = new Map(dimElemPairs.map(p => [p.dim, p.element]))
    const elements = cubeDims.map(d => dimMap.get(d) ?? null)
    const params   = new URLSearchParams({ server, cube, top: 30, elements: JSON.stringify(elements) })
    apiFetch(`/api/transactions?${params}`, { method: 'GET', body: undefined })
      .then(d => { setBusy(false); Array.isArray(d) ? setEntries(d) : setError(d.error ?? 'Failed') })
      .catch(e => { setBusy(false); setError(e.message) })
  }, [server, cube, JSON.stringify(dimElemPairs), JSON.stringify(cubeDims)])  // eslint-disable-line

  if (busy)          return <Loading label="Loading log…" />
  if (error)         return <ErrorMsg msg={error} />
  if (!entries?.length) return <Empty msg="No transaction log entries for this cell." />

  return (
    <div className="overflow-y-auto max-h-56">
      <table className="w-full text-[10px]">
        <thead className="sticky top-0 bg-popover border-b border-border">
          <tr>
            <th className="text-left px-3 py-1 text-muted-foreground font-medium">When</th>
            <th className="text-left px-3 py-1 text-muted-foreground font-medium">User</th>
            <th className="text-right px-3 py-1 text-muted-foreground font-medium">Old</th>
            <th className="text-right px-3 py-1 text-muted-foreground font-medium">New</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="border-b border-border/40 hover:bg-muted/30">
              <td className="px-3 py-1 text-muted-foreground whitespace-nowrap">
                {new Date(e.TimeStamp).toLocaleString()}
              </td>
              <td className="px-3 py-1">{e.User ?? '—'}</td>
              <td className="px-3 py-1 text-right font-mono text-red-400">{e.OldValue ?? '—'}</td>
              <td className="px-3 py-1 text-right font-mono text-emerald-400">{e.NewValue ?? e.Value ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Notes / annotations panel ─────────────────────────────────────────────────
function NotesPanel({ server, cube, dimElemPairs }) {
  const [annotations, setAnnotations] = useState(null)
  const [error,   setError]   = useState(null)
  const [busy,    setBusy]    = useState(true)
  const [newNote, setNewNote] = useState('')
  const [saving,  setSaving]  = useState(false)

  const matchCell = useCallback((a) => {
    if (!a.Tuple?.length) return false
    const pairs = new Map(dimElemPairs.map(p => [p.dim.toLowerCase(), p.element.toLowerCase()]))
    return a.Tuple.every(t => {
      const dim = t.Hierarchy?.Dimension?.Name?.toLowerCase()
      return !dim || pairs.get(dim) === t.Name?.toLowerCase()
    })
  }, [dimElemPairs])

  const load = useCallback(() => {
    setBusy(true); setError(null)
    const params = new URLSearchParams({ server, cube })
    apiFetch(`/api/cube/annotations?${params}`, { method: 'GET', body: undefined })
      .then(d => {
        setBusy(false)
        Array.isArray(d) ? setAnnotations(d.filter(matchCell)) : setError(d.error ?? 'Failed')
      })
      .catch(e => { setBusy(false); setError(e.message) })
  }, [server, cube, matchCell])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!newNote.trim()) return
    setSaving(true)
    try {
      await apiFetch('/api/cube/annotations', {
        method: 'POST',
        body: JSON.stringify({ server, cube, dimElemPairs, text: newNote.trim() }),
      })
      setNewNote(''); load()
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    const params = new URLSearchParams({ server })
    await apiFetch(`/api/cube/annotations/${encodeURIComponent(id)}?${params}`, { method: 'DELETE', body: undefined })
    load()
  }

  return (
    <div className="p-3 space-y-2 max-h-56 overflow-y-auto">
      {busy && <Loading label="Loading notes…" />}
      {error && <ErrorMsg msg={error} />}
      {!busy && annotations?.length === 0 && <Empty msg="No notes for this cell yet." />}
      {annotations?.map(a => (
        <div key={a.ID} className="bg-muted/40 rounded px-2 py-1.5 text-xs group flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-foreground break-words">{a.Text}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {a.Author} · {new Date(a.TimeStamp).toLocaleString()}
            </div>
          </div>
          <button
            onClick={() => handleDelete(a.ID)}
            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 shrink-0 transition-opacity"
          >
            <X size={10} />
          </button>
        </div>
      ))}
      <div className="flex gap-1 pt-1 border-t border-border">
        <input
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd() } }}
          placeholder="Add a note…"
          className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handleAdd}
          disabled={saving || !newNote.trim()}
          className="px-2 py-1 bg-primary text-primary-foreground rounded text-xs disabled:opacity-40"
        >
          {saving ? <Loader2 size={10} className="animate-spin" /> : 'Add'}
        </button>
      </div>
    </div>
  )
}

// ── Write panel ───────────────────────────────────────────────────────────────
function WritePanel({ server, cube, dimElemPairs, currentValue, onSuccess }) {
  const [val,   setVal]   = useState(currentValue != null ? String(currentValue) : '')
  const [busy,  setBusy]  = useState(false)
  const [done,  setDone]  = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  const handleWrite = async () => {
    setBusy(true); setError(null)
    const num = Number(val)
    try {
      const d = await apiFetch('/api/cells/write', {
        method: 'POST',
        body: JSON.stringify({ server, cube, dims: dimElemPairs, value: isNaN(num) ? val : num }),
      })
      if (d.error) throw new Error(d.error)
      setDone(true)
      setTimeout(onSuccess, 600)
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  return (
    <div className="p-3 space-y-2">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={val}
          onChange={e => { setVal(e.target.value); setDone(false); setError(null) }}
          onKeyDown={e => e.key === 'Enter' && handleWrite()}
          placeholder="New value"
          className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handleWrite}
          disabled={busy || done}
          className={cn('px-3 py-1 rounded text-xs font-medium disabled:opacity-40 transition-colors min-w-[52px] flex items-center justify-center',
            done ? 'bg-emerald-600 text-white' : 'bg-primary text-primary-foreground hover:bg-primary/90')}
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : done ? <Check size={10} /> : 'Write'}
        </button>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  )
}

// ── Consolidation breakdown panel ─────────────────────────────────────────────
function BreakdownPanel({ server, cube, dimElemPairs }) {
  const [data,  setData]  = useState(null)
  const [error, setError] = useState(null)
  const [busy,  setBusy]  = useState(true)

  useEffect(() => {
    setBusy(true); setError(null); setData(null)
    apiFetch('/api/cube/breakdown', {
      method: 'POST',
      body: JSON.stringify({ server, cube, dimElemPairs }),
    })
      .then(d => { setBusy(false); d.error ? setError(d.error) : setData(d) })
      .catch(e => { setBusy(false); setError(e.message) })
  }, [server, cube, JSON.stringify(dimElemPairs)])  // eslint-disable-line

  if (busy)  return <Loading label="Loading breakdown…" />
  if (error) return <ErrorMsg msg={error} />
  if (!data?.sections?.length) return <Empty msg={data?.note ?? 'No consolidated elements to break down.'} />

  return (
    <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
      {data.sections.map((sec, si) => (
        <div key={si} className="p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {sec.dim} — {sec.element} — direct children
          </div>
          {sec.error
            ? <div className="text-xs text-red-400">{sec.error}</div>
            : <ContribRows rows={sec.rows} />
          }
        </div>
      ))}
    </div>
  )
}

// ── Leaf contributors panel ────────────────────────────────────────────────────
function LeavesPanel({ server, cube, dimElemPairs }) {
  const [data,  setData]  = useState(null)
  const [error, setError] = useState(null)
  const [busy,  setBusy]  = useState(true)

  useEffect(() => {
    setBusy(true); setError(null); setData(null)
    apiFetch('/api/cube/leaves', {
      method: 'POST',
      body: JSON.stringify({ server, cube, dimElemPairs }),
    })
      .then(d => { setBusy(false); d.error ? setError(d.error) : setData(d) })
      .catch(e => { setBusy(false); setError(e.message) })
  }, [server, cube, JSON.stringify(dimElemPairs)])  // eslint-disable-line

  if (busy)  return <Loading label="Finding leaf contributors…" />
  if (error) return <ErrorMsg msg={error} />
  if (!data?.sections?.length) return <Empty msg={data?.note ?? 'No consolidated elements.'} />

  return (
    <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
      {data.sections.map((sec, si) => (
        <div key={si} className="p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center justify-between">
            <span>{sec.dim} — {sec.element}</span>
            {sec.totalLeaves > 0 && (
              <span className="normal-case">
                {sec.totalLeaves} leaf{sec.totalLeaves !== 1 ? 'ves' : ''}
                {sec.capped ? ', top 50 shown' : ''}
              </span>
            )}
          </div>
          {sec.error
            ? <div className="text-xs text-red-400">{sec.error}</div>
            : <ContribRows rows={sec.rows} />
          }
        </div>
      ))}
    </div>
  )
}

// ── Main context menu ─────────────────────────────────────────────────────────
export default function CellContextMenu({ ctx, cubeDims, onClose, onOpenRules, onOpenDimension, onWriteSuccess }) {
  const ref = useRef(null)
  const [panel, setPanel] = useState(null)

  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const key  = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose])

  const handleCopy = () => {
    const lines = ctx.dimElemPairs.map(p => `${p.dim}: ${p.element}`).join('\n')
    const mdx   = ctx.dimElemPairs.map(p => `[${p.dim}].[${p.dim}].[${p.element}]`).join(', ')
    navigator.clipboard.writeText(`${lines}\n\nMDX tuple: (${mdx})`)
    onClose()
  }

  // Clamp to viewport
  const x = Math.min(ctx.x, window.innerWidth  - 372)
  const y = Math.min(ctx.y, window.innerHeight - 460)

  const tabBtn = (id, icon, label, title) => (
    <button
      key={id}
      onClick={() => setPanel(p => p === id ? null : id)}
      title={title}
      className={cn(
        'flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors',
        panel === id
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
      )}
    >
      {icon}{label}
    </button>
  )

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: y, left: x, zIndex: 9999, width: 380 }}
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

      {/* ── Coordinates ── */}
      <div className="px-3 py-2 border-b border-border/50 flex flex-wrap gap-x-3 gap-y-0.5">
        {ctx.dimElemPairs.map(p => (
          <span key={p.dim} className="text-[10px] flex items-center gap-1">
            <span className="text-muted-foreground">{p.dim}:</span>{' '}
            <span className="text-foreground font-medium">{p.element}</span>
            {onOpenDimension && (
              <button
                onClick={() => { onOpenDimension(p.dim); onClose() }}
                title={`Open ${p.dim} in Dimension Editor`}
                className="text-muted-foreground/40 hover:text-muted-foreground transition-colors ml-0.5"
              >
                <ExternalLink size={8} />
              </button>
            )}
          </span>
        ))}
        {ctx.value != null && ctx.value !== '' && (
          <span className="text-[10px] ml-auto">
            <span className="text-muted-foreground">Value:</span>{' '}
            <span className="font-mono">{ctx.value}</span>
          </span>
        )}
      </div>

      {/* ── Action bar ── */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border flex-wrap">
        {ctx.isAllLeaf && tabBtn('write', <PencilLine size={10} />, 'Write', 'Write a new value to this cell')}
        {tabBtn('trace',   <Zap size={10} />,     'Trace',     'Show the rule chain for this cell')}
        {tabBtn('feeders', <Rss size={10} />,     'Feeders',   'Check what is feeding this cell')}
        {!ctx.isAllLeaf && tabBtn('breakdown', <Layers size={10} />,  'Breakdown', 'Show direct children contributions')}
        {!ctx.isAllLeaf && tabBtn('leaves',    <Network size={10} />, 'Leaves',    'Drill down to all leaf contributors')}
        {tabBtn('log',   <History size={10} />,       'Log',   'Transaction history for this intersection')}
        {tabBtn('notes', <MessageSquare size={10} />, 'Notes', 'Cell annotations')}
        <button
          onClick={handleCopy}
          title="Copy intersection coordinates to clipboard"
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Copy size={10} /> Copy
        </button>
        <button
          onClick={() => { onOpenRules(); onClose() }}
          title="Open rules editor for this cube"
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Sigma size={10} /> Rules
        </button>
      </div>

      {/* ── Panel content ── */}
      {panel === 'write' && ctx.isAllLeaf && (
        <WritePanel
          server={ctx.server}
          cube={ctx.cube}
          dimElemPairs={ctx.dimElemPairs}
          currentValue={ctx.value}
          onSuccess={() => { onWriteSuccess(); onClose() }}
        />
      )}
      {panel === 'trace' && (
        <TracePanel server={ctx.server} cube={ctx.cube} dimElemPairs={ctx.dimElemPairs} />
      )}
      {panel === 'feeders' && (
        <FeedersPanel server={ctx.server} cube={ctx.cube} dimElemPairs={ctx.dimElemPairs} />
      )}
      {panel === 'breakdown' && !ctx.isAllLeaf && (
        <BreakdownPanel server={ctx.server} cube={ctx.cube} dimElemPairs={ctx.dimElemPairs} />
      )}
      {panel === 'leaves' && !ctx.isAllLeaf && (
        <LeavesPanel server={ctx.server} cube={ctx.cube} dimElemPairs={ctx.dimElemPairs} />
      )}
      {panel === 'log' && (
        <LogPanel
          server={ctx.server}
          cube={ctx.cube}
          dimElemPairs={ctx.dimElemPairs}
          cubeDims={cubeDims}
        />
      )}
      {panel === 'notes' && (
        <NotesPanel server={ctx.server} cube={ctx.cube} dimElemPairs={ctx.dimElemPairs} />
      )}
    </div>
  )
}
