import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { X, Plus, Trash2, ShieldCheck, Loader2, CheckCircle2, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { TI_CATALOG, RULES_CATALOG } from '@/lib/tm1-completion'
import { MDX_CATALOG } from '@/lib/tm1-mdx-catalog'

const COMPAT_OPTS = ['both', 'v11', 'v12']
const COMPAT_LABEL = { both: 'Both', v11: 'V11', v12: 'V12' }
const COMPAT_CLASS = {
  both: 'bg-green-500/10 text-green-400 border-green-500/20',
  v11:  'bg-blue-500/10  text-blue-400  border-blue-500/20',
  v12:  'bg-violet-500/10 text-violet-400 border-violet-500/20',
}

// Flatten MDX catalog to a list of {name, params}
const MDX_FLAT = MDX_CATALOG.flatMap(c => c.fns.map(f => ({
  name: f.name,
  params: f.params ?? [],
  description: f.description ?? '',
  category: c.category,
})))

function buildRows(catalog, overrides = {}) {
  const { overrides: ov = {}, additions = {}, deletions = [] } = overrides
  const delSet = new Set(deletions)
  const rows = Object.entries(catalog).map(([name, entry]) => ({
    name,
    params:      ov[name]?.params      ?? entry.params      ?? [],
    compat:      ov[name]?.compat      ?? entry.compat      ?? 'both',
    returnType:  ov[name]?.returnType  ?? entry.returnType  ?? '',
    description: ov[name]?.description ?? entry.description ?? '',
    deprecated:  ov[name]?.deprecated  ?? entry.deprecated  ?? null,
    isStatement: entry.isStatement ?? false,
    source: 'builtin',
    deleted: delSet.has(name),
  }))
  const added = Object.entries(additions).map(([name, v]) => ({
    name,
    params:      v.params      ?? [],
    compat:      v.compat      ?? 'both',
    returnType:  v.returnType  ?? '',
    description: v.description ?? '',
    deprecated:  v.deprecated  ?? null,
    isStatement: false,
    source: 'user',
    deleted: false,
  }))
  return [...rows, ...added]
}

function buildMdxRows(overrides = {}) {
  const { overrides: ov = {}, additions = {}, deletions = [] } = overrides
  const delSet = new Set(deletions)
  const rows = MDX_FLAT.map(f => ({
    name: f.name,
    params: ov[f.name]?.params ?? f.params,
    compat: ov[f.name]?.compat ?? 'both',
    source: 'builtin',
    deleted: delSet.has(f.name),
    description: f.description,
    category: f.category,
  }))
  const added = Object.entries(additions).map(([name, v]) => ({
    name,
    params: v.params ?? [],
    compat: v.compat ?? 'both',
    source: 'user',
    deleted: false,
  }))
  return [...rows, ...added]
}

function CompatBadge({ value, onChange, readOnly }) {
  if (readOnly) return (
    <span className={cn('text-[9px] font-semibold border rounded px-1 py-0.5', COMPAT_CLASS[value])}>
      {COMPAT_LABEL[value]}
    </span>
  )
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={cn(
        'text-[9px] font-semibold border rounded px-1 py-0.5 bg-transparent cursor-pointer outline-none',
        COMPAT_CLASS[value]
      )}
    >
      {COMPAT_OPTS.map(o => <option key={o} value={o} className="bg-background text-foreground">{COMPAT_LABEL[o]}</option>)}
    </select>
  )
}

function FunctionRow({ row, onCompatChange, onDelete, onRestore, validateResult }) {
  const badge = validateResult
    ? validateResult.status === 'valid'   ? <span className="text-[9px] text-green-500">✓</span>
    : validateResult.status === 'invalid' ? <span className="text-[9px] text-red-400">✗</span>
    : <span className="text-[9px] text-amber-400">?</span>
    : null

  return (
    <tr className={cn('border-b border-border text-xs hover:bg-muted/30', row.deleted && 'opacity-40')}>
      <td className="px-3 py-1 font-mono text-[11px] text-foreground">
        <div className="flex items-center gap-1.5">
          <span className={row.deprecated ? 'line-through text-muted-foreground' : ''}>{row.name}</span>
          {badge}
          {row.isStatement && <span className="text-[8px] text-muted-foreground border border-border rounded px-1">stmt</span>}
        </div>
        {row.description && <div className="text-[10px] text-muted-foreground mt-0.5 font-sans font-normal max-w-[220px] truncate">{row.description}</div>}
        {row.deprecated  && <div className="text-[10px] text-amber-400 mt-0.5 font-sans font-normal max-w-[220px] truncate">⚠ {row.deprecated}</div>}
      </td>
      <td className="px-3 py-1 text-muted-foreground text-[10px] max-w-[160px] truncate font-mono align-top pt-2">
        {Array.isArray(row.params) ? row.params.join(', ') || '—' : '—'}
      </td>
      <td className="px-3 py-1 align-top pt-2">
        <div className="flex flex-col gap-1">
          <CompatBadge value={row.compat} onChange={v => onCompatChange(row.name, v, row.source)} />
          {row.returnType && (
            <span className="text-[8px] text-muted-foreground font-mono">→ {row.returnType}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-1 align-top pt-2">
        <span className={cn('text-[9px] border rounded px-1 py-0.5',
          row.source === 'user' ? 'text-amber-400 border-amber-500/20 bg-amber-500/10' : 'text-muted-foreground border-border')}>
          {row.source}
        </span>
      </td>
      <td className="px-3 py-1 text-right align-top pt-2">
        {row.deleted
          ? <button onClick={() => onRestore(row.name, row.source)} title="Restore" className="text-muted-foreground hover:text-foreground"><RotateCcw size={11} /></button>
          : <button onClick={() => onDelete(row.name, row.source)} title="Delete / suppress" className="text-muted-foreground hover:text-red-400"><Trash2 size={11} /></button>
        }
      </td>
    </tr>
  )
}

function AddFunctionForm({ onAdd }) {
  const [name, setName] = useState('')
  const [params, setParams] = useState('')
  const [compat, setCompat] = useState('both')

  const submit = () => {
    const n = name.trim().toUpperCase()
    if (!n) return
    onAdd(n, params.split(',').map(p => p.trim()).filter(Boolean), compat)
    setName(''); setParams(''); setCompat('both')
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/20">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="FUNCTION_NAME"
        className="font-mono text-[11px] bg-background border border-border rounded px-2 py-1 w-36 outline-none focus:border-primary"
        onKeyDown={e => e.key === 'Enter' && submit()}
      />
      <input
        value={params}
        onChange={e => setParams(e.target.value)}
        placeholder="param1, param2, ..."
        className="text-[11px] bg-background border border-border rounded px-2 py-1 flex-1 outline-none focus:border-primary"
        onKeyDown={e => e.key === 'Enter' && submit()}
      />
      <select
        value={compat}
        onChange={e => setCompat(e.target.value)}
        className={cn('text-[9px] font-semibold border rounded px-1 py-1 bg-background cursor-pointer outline-none', COMPAT_CLASS[compat])}
      >
        {COMPAT_OPTS.map(o => <option key={o} value={o} className="bg-background text-foreground">{COMPAT_LABEL[o]}</option>)}
      </select>
      <button
        onClick={submit}
        disabled={!name.trim()}
        className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
      >
        <Plus size={10} /> Add
      </button>
    </div>
  )
}

export default function CatalogAdmin({ server, onClose }) {
  const [tab, setTab]               = useState('ti')
  const [search, setSearch]         = useState('')
  const [overrides, setOverrides]   = useState(null)
  const [dirty, setDirty]           = useState(false)
  const [saving, setSaving]         = useState(false)
  const [validateResults, setValidateResults] = useState(null)
  const [validating, setValidating] = useState(false)
  const [filter, setFilter]         = useState('all') // 'all' | 'v12' | 'v11' | 'both'

  useEffect(() => {
    fetch('/api/admin/catalog-overrides')
      .then(r => r.json())
      .then(d => setOverrides(d))
      .catch(() => setOverrides({ ti: { overrides: {}, additions: {}, deletions: [] }, rules: { overrides: {}, additions: {}, deletions: [] }, mdx: { overrides: {}, additions: {}, deletions: [] } }))
  }, [])

  const rows = useMemo(() => {
    if (!overrides) return []
    const ov = overrides[tab] ?? { overrides: {}, additions: {}, deletions: [] }
    if (tab === 'ti')    return buildRows(TI_CATALOG, ov)
    if (tab === 'rules') return buildRows(RULES_CATALOG, ov)
    if (tab === 'mdx')   return buildMdxRows(ov)
    return []
  }, [overrides, tab])

  const filtered = useMemo(() => {
    let r = rows
    if (search) r = r.filter(row => row.name.toLowerCase().includes(search.toLowerCase()))
    if (filter !== 'all') r = r.filter(row => row.compat === filter)
    return r
  }, [rows, search, filter])

  const counts = useMemo(() => ({
    total: rows.length,
    v12: rows.filter(r => r.compat === 'v12').length,
    v11: rows.filter(r => r.compat === 'v11').length,
    both: rows.filter(r => r.compat === 'both').length,
  }), [rows])

  const mutateOverride = useCallback((lang, mutFn) => {
    setOverrides(prev => {
      const next = { ...prev, [lang]: mutFn({ ...prev[lang] }) }
      return next
    })
    setDirty(true)
  }, [])

  const handleCompatChange = useCallback((name, compat, source) => {
    mutateOverride(tab, ov => {
      if (source === 'user') {
        return { ...ov, additions: { ...ov.additions, [name]: { ...(ov.additions[name] ?? {}), compat } } }
      }
      return { ...ov, overrides: { ...ov.overrides, [name]: { ...(ov.overrides?.[name] ?? {}), compat } } }
    })
  }, [tab, mutateOverride])

  const handleDelete = useCallback((name, source) => {
    mutateOverride(tab, ov => {
      if (source === 'user') {
        const additions = { ...ov.additions }
        delete additions[name]
        return { ...ov, additions }
      }
      return { ...ov, deletions: [...(ov.deletions ?? []), name] }
    })
  }, [tab, mutateOverride])

  const handleRestore = useCallback((name, source) => {
    if (source !== 'builtin') return
    mutateOverride(tab, ov => ({ ...ov, deletions: (ov.deletions ?? []).filter(d => d !== name) }))
  }, [tab, mutateOverride])

  const handleAdd = useCallback((name, params, compat) => {
    mutateOverride(tab, ov => ({
      ...ov,
      additions: { ...ov.additions, [name]: { params, compat } },
      deletions: (ov.deletions ?? []).filter(d => d !== name),
    }))
  }, [tab, mutateOverride])

  const handleSave = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/admin/catalog-overrides', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrides),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      setDirty(false)
      toast.success('Catalog saved')
    } catch (e) {
      toast.error(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleValidate = useCallback(async () => {
    if (!server) return toast.error('No server selected')
    setValidating(true)
    setValidateResults(null)
    try {
      const catalog = tab === 'ti' ? TI_CATALOG : RULES_CATALOG
      const tests = Object.entries(catalog).map(([name, entry]) => {
        const params = entry.params ?? []
        const args = params.map(p => {
          const base = p.replace('*', '')
          return ['n', 'numeric', 'index', 'level', 'count', 'position', 'value'].includes(base) ? '1' : "'x'"
        })
        return { name, code: `${name}(${args.join(', ')});` }
      })
      const token = localStorage.getItem('tm1-token') ?? ''
      const r = await fetch('/api/admin/validate-ti-functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ide-token': token },
        body: JSON.stringify({ server, tests }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      const map = {}
      d.results.forEach(res => { map[res.name] = res })
      setValidateResults(map)
      const invalid = d.results.filter(r => r.status === 'invalid').length
      if (invalid) toast.warning(`${invalid} invalid function${invalid > 1 ? 's' : ''} found — shown with ✗`)
      else toast.success('All functions validated ✓')
    } catch (e) {
      toast.error(`Validate failed: ${e.message}`)
    } finally {
      setValidating(false)
    }
  }, [tab, server])

  const TABS = [
    { id: 'ti',    label: 'TI Functions' },
    { id: 'rules', label: 'Rules Functions' },
    { id: 'mdx',   label: 'MDX Functions' },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-[780px] max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck size={14} className="text-primary" />
            Function Catalog
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                Save
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setValidateResults(null); setSearch(''); setFilter('all') }}
              className={cn(
                'px-4 py-2 text-xs font-medium border-r border-border transition-colors',
                tab === t.id
                  ? 'bg-background text-foreground border-t-2 border-t-primary -mt-px'
                  : 'text-muted-foreground hover:text-foreground bg-muted/30'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search functions…"
            className="text-xs bg-background border border-border rounded px-2 py-1 w-48 outline-none focus:border-primary"
          />
          <div className="flex items-center gap-1 ml-1">
            {['all', 'both', 'v12', 'v11'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded border transition-colors',
                  filter === f ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {f === 'all' ? `All (${counts.total})` : `${COMPAT_LABEL[f]} (${counts[f]})`}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {(tab === 'ti' || tab === 'rules') && (
              <button
                onClick={handleValidate}
                disabled={validating || !server}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                title={server ? 'Test all functions against live TM1 server' : 'Connect to a server first'}
              >
                {validating ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
                Validate
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          {!overrides ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-xs gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                <tr className="text-xs text-muted-foreground">
                  <th className="px-3 py-1.5 text-left font-medium">Function</th>
                  <th className="px-3 py-1.5 text-left font-medium">Params</th>
                  <th className="px-3 py-1.5 text-left font-medium">Compat</th>
                  <th className="px-3 py-1.5 text-left font-medium">Source</th>
                  <th className="px-3 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-xs text-muted-foreground">No functions match</td></tr>
                ) : filtered.map(row => (
                  <FunctionRow
                    key={row.name}
                    row={row}
                    onCompatChange={handleCompatChange}
                    onDelete={handleDelete}
                    onRestore={handleRestore}
                    validateResult={validateResults?.[row.name]}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add form */}
        <AddFunctionForm onAdd={handleAdd} />

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground flex justify-between shrink-0">
          <span>Compat changes apply to autocomplete and static validation after page reload. Built-in deletions suppress warnings only.</span>
          {dirty && <span className="text-amber-400">Unsaved changes</span>}
        </div>
      </div>
    </div>
  )
}
