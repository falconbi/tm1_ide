import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Pencil, Check, XCircle, Play, RefreshCw, ListChecks, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// Assertions manager — list, add, edit, remove and run the model's stored
// assertions. List loads on open (cheap GET); runs are button-triggered.
const authHeader = () => ({ 'x-ide-token': localStorage.getItem('tm1-token') ?? '' })

const emptyForm = () => ({ description: '', mdx: '', expected: '', tolerance: '0.01', tags: '' })

export default function AssertionsManager({ server, onClose }) {
  const [list,    setList]    = useState(null)
  const [filter,  setFilter]  = useState('')
  const [adding,  setAdding]  = useState(false)
  const [editId,  setEditId]  = useState(null)
  const [form,    setForm]    = useState(emptyForm())
  const [running, setRunning] = useState(null)
  const [results, setResults] = useState({})
  const [error,   setError]   = useState(null)

  const load = async () => {
    setError(null)
    try {
      const r = await fetch(`/api/assertions?server=${encodeURIComponent(server)}`, { headers: authHeader() })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      setList(d)
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [server])

  const beginAdd = () => { setForm(emptyForm()); setEditId(null); setAdding(true) }
  const beginEdit = a => {
    setForm({ description: a.description ?? '', mdx: a.mdx ?? '', expected: String(a.expected ?? ''), tolerance: String(a.tolerance ?? '0.01'), tags: (a.tags ?? []).join(', ') })
    setEditId(a.id); setAdding(false)
  }
  const cancelForm = () => { setForm(emptyForm()); setAdding(false); setEditId(null) }

  const submit = async () => {
    setError(null)
    if (!form.description.trim() || !form.mdx.trim() || form.expected === '') { setError('Description, MDX and expected value are required.'); return }
    const body = {
      description: form.description, mdx: form.mdx,
      expected: Number(form.expected), tolerance: Number(form.tolerance || '0.01'),
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    }
    try {
      const url = `/api/assertions${editId ? `/${encodeURIComponent(editId)}` : ''}?server=${encodeURIComponent(server)}`
      const r = await fetch(url, { method: editId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      cancelForm()
      await load()
    } catch (e) { setError(e.message) }
  }

  const remove = async a => {
    if (!confirm(`Remove assertion "${a.description.slice(0, 60)}…"?`)) return
    setError(null)
    try {
      const r = await fetch(`/api/assertions/${encodeURIComponent(a.id)}?server=${encodeURIComponent(server)}`, { method: 'DELETE', headers: authHeader() })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      await load()
    } catch (e) { setError(e.message) }
  }

  const runOne = async a => {
    setRunning(a.id); setError(null)
    try {
      const r = await fetch(`/api/assertions/run?server=${encodeURIComponent(server)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ id: a.id }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      setResults(prev => ({ ...prev, [a.id]: d }))
    } catch (e) { setError(e.message) }
    finally { setRunning(null) }
  }

  const runAll = async () => {
    setRunning('all'); setError(null); setResults({})
    try {
      const r = await fetch(`/api/assertions/run?server=${encodeURIComponent(server)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({}) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      const map = {}
      for (const res of d.results ?? []) map[res.id] = res
      setResults(map)
    } catch (e) { setError(e.message) }
    finally { setRunning(null) }
  }

  const rows = (list?.assertions ?? []).filter(a =>
    !filter || (a.tags ?? []).some(t => t.toLowerCase().includes(filter.toLowerCase())) || (a.description ?? '').toLowerCase().includes(filter.toLowerCase())
  )

  const input = 'w-full bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring'
  const inputText = 'w-full bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="w-[760px] max-h-[85vh] flex flex-col bg-background border border-border rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <ListChecks size={14} className="text-muted-foreground" />
          <span className="text-sm font-semibold">Assertions — {server}</span>
          <span className="text-[10px] text-muted-foreground">{list ? `${list.assertions.length} stored (source: ${list.source})` : ''}</span>
          <div className="flex-1" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by tag…"
            className="w-36 bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
          <button onClick={runAll} disabled={running}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded border border-border text-foreground hover:bg-muted disabled:opacity-40 transition-colors">
            {running === 'all' ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />} Run all
          </button>
          <button onClick={beginAdd} className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 transition-colors"><Plus size={12} /> Add</button>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors" title="Close"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {error && <p className="text-xs text-red-600 border border-red-600/40 rounded px-3 py-2">{error}</p>}
          {!list && <p className="text-xs text-muted-foreground italic">Loading…</p>}

          {/* Add form — the top form is only for adding; editing happens inline in the row */}
          {adding && (
            <div className="border border-primary/40 rounded-md p-3 space-y-2">
              <div className="text-xs font-semibold">{editId ? 'Edit assertion' : 'New assertion'}</div>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What this checks, in words…" className={inputText} />
              <textarea value={form.mdx} onChange={e => setForm(f => ({ ...f, mdx: e.target.value }))} placeholder="MDX SELECT…" rows={3} className={cn(input, 'resize-y')} />
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-muted-foreground w-20 shrink-0">Expected</label>
                <input value={form.expected} onChange={e => setForm(f => ({ ...f, expected: e.target.value }))} placeholder="0" className={cn(input, 'w-28')} />
                <label className="text-[10px] text-muted-foreground w-20 shrink-0 ml-2">Tolerance</label>
                <input value={form.tolerance} onChange={e => setForm(f => ({ ...f, tolerance: e.target.value }))} placeholder="0.01" className={cn(input, 'w-24')} />
                <label className="text-[10px] text-muted-foreground w-10 shrink-0 ml-2">Tags</label>
                <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="comma, separated" className={cn(input, 'flex-1')} />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={submit} className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"><Check size={12} /> Save</button>
                <button onClick={cancelForm} className="px-3 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {rows.length === 0 && list && <p className="text-xs text-muted-foreground italic">No assertions match.</p>}

          {rows.map(a => {
            const res = results[a.id]
            const editing = editId === a.id
            return (
              <div key={a.id} className={cn('border rounded-md px-3 py-2', res && (res.pass ? 'border-emerald-600/30' : 'border-red-600/30'), !res && 'border-border')}>
                <div className="flex items-start gap-2">
                  <span className="flex-1">
                    <span className="block text-xs">{a.description}</span>
                    <span className="block text-[10px] text-muted-foreground mt-0.5">
                      expected {a.expected}{a.tolerance != null ? ` ± ${a.tolerance}` : ''}
                      {a.tags?.length > 0 && ` · ${a.tags.map(t => `# ${t}`).join('  ')}`}
                    </span>
                    {res && (
                      <span className={cn('block text-[10px] mt-0.5', res.pass ? 'text-emerald-600' : 'text-red-600')}>
                        {res.error ? `error: ${res.error}` : res.pass ? `pass — actual ${res.actual}` : `fail — expected ${res.expected}, got ${res.actual}`}
                      </span>
                    )}
                  </span>
                  <button onClick={() => runOne(a)} disabled={running === a.id} title="Run this assertion"
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">
                    {running === a.id ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
                  </button>
                  <button onClick={() => beginEdit(a)} title="Edit" className="p-1 text-muted-foreground hover:text-foreground transition-colors"><Pencil size={12} /></button>
                  <button onClick={() => remove(a)} title="Remove" className="p-1 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
                </div>
                {editing && (
                  <div className="mt-2 space-y-2">
                    <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={inputText} />
                    <textarea value={form.mdx} onChange={e => setForm(f => ({ ...f, mdx: e.target.value }))} rows={2} className={cn(input, 'resize-y')} />
                    <div className="flex items-center gap-2">
                      <input value={form.expected} onChange={e => setForm(f => ({ ...f, expected: e.target.value }))} className={cn(input, 'w-28')} />
                      <input value={form.tolerance} onChange={e => setForm(f => ({ ...f, tolerance: e.target.value }))} className={cn(input, 'w-24')} />
                      <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} className={cn(input, 'flex-1')} />
                      <button onClick={submit} className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"><Check size={11} /> Save</button>
                      <button onClick={cancelForm} className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted">Cancel</button>
                    </div>
                  </div>
                )}
                <details className="mt-1">
                  <summary className="text-[10px] text-muted-foreground cursor-pointer select-none hover:text-foreground">MDX</summary>
                  <pre className="mt-1 text-[10px] font-mono text-muted-foreground bg-muted/40 rounded px-2 py-1.5 whitespace-pre-wrap break-all">{a.mdx}</pre>
                </details>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}