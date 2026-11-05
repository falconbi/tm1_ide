import { useState, useRef, useEffect, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useProcess, useSaveProcess, useRunProcess, useCreateProcess, useDebugProcess, useCubes, useViews, usePreviewDatasource, useConflictCheck } from '@/hooks/useApi'
import { registerTM1Completions, registerTM1Theme } from '@/lib/tm1-functions'
import { registerTICompletions } from '@/lib/tm1-completion'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ChevronRight, ChevronDown, Play, X, Braces, CheckCircle2, XCircle, Trash2, Plus, Loader2, Bug, Search, AlertTriangle, AlertCircle, Map, Upload, History, Locate, HelpCircle, ListTree, ChevronsUpDown, ChevronsDownUp, Undo2, Redo2 } from 'lucide-react'
import { enableQuoteDoubleClick } from '@/lib/quote-select'
import HelpPanel from '@/components/HelpPanel'
import ObjectHistoryPanel from '@/components/ObjectHistoryPanel'
import { getFunctionRef } from '@/lib/tm1-snippets.js'
import { loadSettings, saveSettings } from '@/lib/formatters/settings.js'
import { scanVariables } from '@/lib/ti-interpreter'
import { parseDebugLog } from '@/lib/ti-debugger'
import { validateTICode } from '@/lib/ti-validator'
import SnippetPanel from '@/components/SnippetPanel'
import { ConflictBanner, ConflictSaveWarning } from '@/components/ConflictBanner'
import DiffViewerModal from '@/components/DiffViewerModal'

const CODE_TABS = [
  { key: 'PrologProcedure',    label: 'Prolog'   },
  { key: 'MetadataProcedure',  label: 'Metadata' },
  { key: 'DataProcedure',      label: 'Data'     },
  { key: 'EpilogProcedure',    label: 'Epilog'   },
]
const SECTION_LABEL = Object.fromEntries(CODE_TABS.map(({ key, label }) => [key, label]))

const PARAM_TYPE = { 1: 'Numeric', 2: 'String', Numeric: 'Numeric', String: 'String' }
const toTypeStr = t => (t === 1 ? 'Numeric' : t === 2 ? 'String' : t ?? 'String')

function EditableParamsPanel({ params, onChange }) {
  const cell = 'w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary px-1 py-0.5 font-mono focus:outline-none text-xs'

  const set = (i, field, val) => onChange(params.map((p, idx) => idx === i ? { ...p, [field]: val } : p))
  const add = () => onChange([...params, { Name: 'p', Type: 'String', Value: '', Prompt: '' }])
  const remove = (i) => onChange(params.filter((_, idx) => idx !== i))

  return (
    <div>
      {params.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="text-left px-3 py-1.5">Name</th>
              <th className="text-left px-3 py-1.5 w-24">Type</th>
              <th className="text-left px-3 py-1.5">Default</th>
              <th className="text-left px-3 py-1.5">Prompt</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {params.map((p, i) => (
              <tr key={i} className="border-b border-border hover:bg-muted/30 group">
                <td className="px-2 py-0.5">
                  <input value={p.Name ?? ''} onChange={e => set(i, 'Name', e.target.value)} className={cell} />
                </td>
                <td className="px-2 py-0.5">
                  <select
                    value={toTypeStr(p.Type)}
                    onChange={e => set(i, 'Type', e.target.value)}
                    className="w-full bg-transparent text-xs focus:outline-none"
                  >
                    <option value="String">String</option>
                    <option value="Numeric">Numeric</option>
                  </select>
                </td>
                <td className="px-2 py-0.5">
                  <input value={String(p.Value ?? '')} onChange={e => set(i, 'Value', e.target.value)} className={cell} />
                </td>
                <td className="px-2 py-0.5">
                  <input value={p.Prompt ?? ''} onChange={e => set(i, 'Prompt', e.target.value)} className={cell} />
                </td>
                <td className="px-1 py-0.5">
                  <button
                    onClick={() => remove(i)}
                    className="hidden group-hover:flex items-center text-muted-foreground hover:text-red-400 p-0.5"
                  >
                    <Trash2 size={10} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {params.length === 0 && (
        <p className="px-4 py-2 text-xs text-muted-foreground italic">No parameters — click below to add one.</p>
      )}
      <button
        onClick={add}
        className="flex items-center gap-1 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-t border-border"
      >
        <Plus size={10} /> Add parameter
      </button>
    </div>
  )
}

function EditableDatasourcePanel({ ds, server, onChange }) {
  const type = ds?.Type ?? 'None'
  const set  = (k, v) => onChange({ ...ds, Type: type, [k]: v })
  const csvInputRef = useRef(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const enc = encodeURIComponent

  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvUploading(true)
    try {
      const buffer = await file.arrayBuffer()
      const r = await fetch(
        `/api/files/upload?server=${enc(server)}&name=${enc(file.name)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-ide-token': localStorage.getItem('tm1-token') ?? '' }, body: buffer }
      )
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Upload failed')
      set('dataSourceNameForServer', file.name)
      toast.success(`Uploaded: ${file.name}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCsvUploading(false)
      e.target.value = ''
    }
  }

  const { data: cubes }  = useCubes(server)
  const { data: views }  = useViews(server, type === 'TM1CubeView' ? (ds?.dataSourceNameForServer ?? '') : null)

  const row = (label, key, opts = {}) => (
    <div key={key} className="flex items-center gap-3">
      <span className="text-[10px] text-muted-foreground w-28 shrink-0">{label}</span>
      <input
        type={opts.type ?? 'text'}
        value={ds?.[key] ?? opts.default ?? ''}
        onChange={e => set(key, e.target.value)}
        placeholder={opts.placeholder ?? ''}
        className="flex-1 bg-transparent border-b border-border focus:border-primary text-xs font-mono py-0.5 focus:outline-none"
      />
    </div>
  )

  const sel = (label, key, options, loading) => (
    <div key={key} className="flex items-center gap-3">
      <span className="text-[10px] text-muted-foreground w-28 shrink-0">{label}</span>
      <select
        value={ds?.[key] ?? ''}
        onChange={e => set(key, e.target.value)}
        className="flex-1 bg-muted border border-border rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none"
      >
        <option value="">{loading ? 'Loading…' : 'Select…'}</option>
        {(options ?? []).map(o => typeof o === 'string' ? o : (o?.name ?? o?.Name)).filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )

  return (
    <div className="px-3 py-2 space-y-2.5">
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Type</span>
        <select
          value={type}
          onChange={e => onChange({ Type: e.target.value })}
          className="flex-1 bg-muted border border-border rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none"
        >
          <option value="None">None (no data loop)</option>
          <option value="ASCII">ASCII File</option>
          <option value="ODBC">ODBC</option>
          <option value="TM1CubeView">TM1 Cube View</option>
          <option value="TM1DimensionSubset">TM1 Dimension Subset</option>
        </select>
      </div>

      {type === 'ASCII' && <>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-28 shrink-0">File (server)</span>
          <input
            type="text"
            value={ds?.dataSourceNameForServer ?? ''}
            onChange={e => set('dataSourceNameForServer', e.target.value)}
            placeholder=".\\data\\file.csv"
            className="flex-1 bg-transparent border-b border-border focus:border-primary text-xs font-mono py-0.5 focus:outline-none"
          />
          <input type="file" accept=".csv,.txt,.asc" ref={csvInputRef} onChange={handleCsvUpload} className="hidden" />
          <button
            onClick={() => csvInputRef.current?.click()}
            disabled={csvUploading}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 disabled:opacity-50 shrink-0"
          >
            {csvUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Upload
          </button>
        </div>
        {row('File (client)', 'dataSourceNameForClient', { placeholder: 'Leave blank = mirror server' })}
        {row('Delimiter char', 'asciiDelimiterChar', { placeholder: ',', default: ',' })}
        {row('Header rows', 'asciiHeaderRecords', { type: 'number', default: '1' })}
        {row('Quote char', 'asciiQuoteCharacter', { placeholder: '"' })}
      </>}

      {type === 'ODBC' && <>
        {row('DSN', 'dataSourceNameForServer', { placeholder: 'MyDatabase' })}
        <div className="flex items-start gap-3">
          <span className="text-[10px] text-muted-foreground w-28 shrink-0 pt-1">SQL query</span>
          <textarea
            value={ds?.query ?? ''}
            onChange={e => set('query', e.target.value)}
            rows={3}
            placeholder="SELECT col1, col2 FROM table"
            className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>
        {row('Username', 'userName', { placeholder: 'Optional' })}
      </>}

      {type === 'TM1CubeView' && <>
        {sel('Cube', 'dataSourceNameForServer', cubes)}
        {sel('View', 'view', views)}
      </>}

      {type === 'TM1DimensionSubset' && <>
        {row('Dimension', 'dataSourceNameForServer', { placeholder: 'CostCentre' })}
        {row('Subset', 'subset', { placeholder: 'All CostCentres' })}
      </>}
    </div>
  )
}

// Preview of what the process will read, for every datasource type: the ODBC query's rows (with ?pName?
// tokens filled from the parameter defaults, as TM1 does), the first lines of a file, a subset's elements,
// the first records of a cube view (read from the server, never the whole view), or a subset's elements.
function DatasourcePreviewPanel({ ds, server, params }) {
  const { openTab } = useStore()
  const preview = usePreviewDatasource()
  const [result, setResult]   = useState(null)
  const [error,  setError]    = useState(null)
  const [loading, setLoading] = useState(false)
  const type = ds?.Type ?? 'None'
  const name = ds?.dataSourceNameForServer ?? ''
  const enc  = encodeURIComponent
  const hdrs = { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' }

  useEffect(() => { setResult(null); setError(null) }, [type, name, ds?.view, ds?.subset, ds?.query])

  // TM1 substitutes ?pName? as plain text, no quoting
  const fillParams = q => (q ?? '').replace(/\?(\w+)\?/g, (m, n) => {
    const p = (params ?? []).find(x => x.Name?.toLowerCase() === n.toLowerCase())
    return p ? String(p.Value ?? '') : m
  })

  const fail = e => { setError(e.message ?? String(e)); setLoading(false) }

  const run = async () => {
    setResult(null); setError(null)
    if (type === 'ODBC') {
      preview.mutate({ dsn: name, query: fillParams(ds?.query) }, { onSuccess: setResult, onError: fail })
      return
    }
    setLoading(true)
    try {
      if (type === 'TM1CubeView') {
        const r = await fetch(`/api/view/preview-records?server=${enc(server)}&cube=${enc(name)}&view=${enc(ds?.view ?? '')}`, { method: 'POST', headers: hdrs })
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Could not read the view')
        setResult({ columns: d.columns, rows: d.rows, rowCount: d.rows.length, note: `the first records, as the process receives them · the view has ${d.viewRows.toLocaleString()} rows` })
      } else if (type === 'TM1DimensionSubset') {
        const r = await fetch(`/api/subset/elements?server=${enc(server)}&dimension=${enc(name)}&name=${enc(ds?.subset ?? '')}`, { headers: hdrs })
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Could not read the subset')
        const els = (Array.isArray(d) ? d : d.elements ?? []).map(e => e.name ?? e.Name ?? e)
        setResult({ columns: ['Element'], rows: els.slice(0, 200).map(e => [e]), rowCount: els.length })
      } else if (type === 'ASCII') {
        const file = name.split(/[\\/]/).pop()
        const r = await fetch(`/api/files/content?server=${enc(server)}&name=${enc(file)}`, { headers: hdrs })
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          throw new Error(d.error || `Could not read ${file}. Reading server files needs Planning Analytics v12; on v11 TM1 has no way to read them over its API.`)
        }
        const lines = (await r.text()).split(/\r?\n/).filter(l => l !== '')
        const delim = ds?.asciiDelimiterChar || ','
        const head  = Number(ds?.asciiHeaderRecords ?? 1) || 0
        const split = l => l.split(delim)
        const body  = lines.slice(head)
        const width = Math.max(1, ...body.slice(0, 20).map(l => split(l).length))
        const columns = head > 0 ? split(lines[0]) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
        setResult({ columns, rows: body.slice(0, 20).map(split), rowCount: body.length, note: 'first 20 records' })
      }
      setLoading(false)
    } catch (e) { fail(e) }
  }

  const openSubset = () => openTab({ id: `subset:${server}:${name}:${ds.subset}`, type: 'subset', label: ds.subset, server, dimension: name, subsetName: ds.subset })

  const busy = loading || preview.isPending
  const btn  = 'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40'
  const canPreview = type === 'TM1CubeView' ? !!(name && ds?.view) : type === 'ODBC' ? !!(name && ds?.query) : type === 'ASCII' ? !!name : type === 'TM1DimensionSubset' ? !!(name && ds?.subset) : false

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-muted-foreground truncate">
          {type === 'TM1CubeView'
            ? <>The process reads every record of <span className="font-mono text-foreground">{ds?.view || '—'}</span> on <span className="font-mono text-foreground">{name || '—'}</span></>
            : type === 'ODBC' ? <>DSN: <span className="font-mono text-foreground">{name || '—'}</span>{/\?\w+\?/.test(ds?.query ?? '') && ' · parameters filled from their defaults'}</>
            : type === 'ASCII' ? <>File: <span className="font-mono text-foreground">{name || '—'}</span></>
            : <>Subset: <span className="font-mono text-foreground">{ds?.subset || '—'}</span> of <span className="font-mono text-foreground">{name || '—'}</span></>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {type === 'TM1DimensionSubset' && (
            <button onClick={openSubset} disabled={!name || !ds?.subset} className={btn} title="Open the source subset in its own tab">Open subset</button>
          )}
          <button
            onClick={run}
            disabled={busy || !canPreview}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-emerald-700 text-white disabled:opacity-40 hover:bg-emerald-600 transition-colors"
          >
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
            Preview
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-red-400 text-xs">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <span className="font-mono whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {result && (
        <div className="border border-border rounded overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1 bg-muted border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {result.rowCount} {type === 'TM1CubeView' ? 'record' : 'row'}{result.rowCount !== 1 ? 's' : ''}{result.note ? ` — showing ${result.note}` : ''}{result.duration != null ? ` — ${result.duration}ms` : ''}
            </span>
          </div>
          <div className="overflow-x-auto max-h-48">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {result.columns.map((c, i) => (
                    <th key={i} className="text-left px-2 py-1 font-medium text-muted-foreground border-b border-border whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className={cn('border-b border-border/50', i % 2 === 0 ? 'bg-background' : 'bg-muted/20')}>
                    {row.map((cell, j) => (
                      <td key={j} className="px-2 py-0.5 font-mono whitespace-nowrap max-w-xs truncate text-foreground/80">
                        {cell === null ? <span className="text-muted-foreground italic">NULL</span> : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function CollapsibleSection({ label, hint, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="shrink-0 border-b border-border">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-xs transition-colors"
      >
        {open ? <ChevronDown size={11} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={11} className="shrink-0 text-muted-foreground" />}
        <span className="font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        {hint && <span className="text-muted-foreground/60 font-mono normal-case tracking-normal ml-1">{hint}</span>}
      </button>
      {open && <div className="max-h-48 overflow-auto border-t border-border">{children}</div>}
    </div>
  )
}

function VariablesPanel({ variables }) {
  if (!variables?.length) return (
    <div className="px-4 py-3 text-xs text-muted-foreground">No variables</div>
  )
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted text-muted-foreground">
            <th className="text-left px-3 py-1.5">#</th>
            <th className="text-left px-3 py-1.5">Name</th>
            <th className="text-left px-3 py-1.5">Type</th>
          </tr>
        </thead>
        <tbody>
          {variables.map(v => (
            <tr key={v.Name} className="border-b border-border hover:bg-muted/50">
              <td className="px-3 py-1.5 text-muted-foreground">{v.Position ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono">{v.Name}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{v.Type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RunDialog({ params, onRun, onClose, isPending, title = 'Run Process' }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries((params ?? []).map(p => [p.Name, String(p.Value ?? '')]))
  )

  const set = (name, val) => setValues(v => ({ ...v, [name]: val }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">{title}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        {/* Params */}
        <div className="px-4 py-3 space-y-3 max-h-80 overflow-auto">
          {!params?.length ? (
            <p className="text-xs text-muted-foreground">No parameters — process will run immediately.</p>
          ) : params.map(p => (
            <div key={p.Name} className="space-y-1">
              <label className="flex items-center gap-2 text-xs font-medium">
                <span className="font-mono">{p.Name}</span>
                <span className="text-muted-foreground">{PARAM_TYPE[p.Type] ?? p.Type}</span>
                {p.Prompt && <span className="text-muted-foreground/70 truncate">{p.Prompt}</span>}
              </label>
              <input
                type={p.Type === 1 || p.Type === 'Numeric' ? 'number' : 'text'}
                value={values[p.Name] ?? ''}
                onChange={e => set(p.Name, e.target.value)}
                className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onRun(values)}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            <Play size={11} />
            {isPending ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SaveAsDialog({ sourceName, onSave, onClose, isPending }) {
  const [name, setName] = useState(`${sourceName}_copy`)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Save As</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>
        <div className="px-4 py-3">
          <label className="text-xs text-muted-foreground block mb-1.5">New process name</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); if (e.key === 'Escape') onClose() }}
            className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors">Cancel</button>
          <button
            onClick={() => name.trim() && onSave(name.trim())}
            disabled={!name.trim() || isPending}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {isPending ? 'Creating…' : 'Save As'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DebugPanel({ watches, onWatchesChange, events, isDebugging, onRun, onJumpTo, availableVars }) {
  const [newName, setNewName] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const addWatch = () => {
    const name = newName.trim()
    const known = (availableVars ?? []).find(v => v.name.toLowerCase() === name.toLowerCase())
    if (!known || watches.some(w => w.name.toLowerCase() === name.toLowerCase())) return
    onWatchesChange([...watches, { name: known.name, type: known.type }])
    setNewName('')
    setFilterText('')
    setDropdownOpen(false)
  }

  const selectVar = (v) => {
    if (watches.some(w => w.name.toLowerCase() === v.name.toLowerCase())) return
    onWatchesChange([...watches, { name: v.name, type: v.type }])
    setNewName('')
    setFilterText('')
    setDropdownOpen(false)
  }

  const filteredVars = (availableVars ?? []).filter(v => {
    if (!filterText) return true
    const lo = filterText.toLowerCase()
    return v.name.toLowerCase().includes(lo) || v.section.toLowerCase().includes(lo)
  })

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
    <div className="w-64 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
      {/* Header + run */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <Bug size={11} /> Debug
        </span>
        <button
          onClick={onRun}
          disabled={isDebugging}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-emerald-700 text-white disabled:opacity-40 hover:bg-emerald-600 transition-colors"
        >
          {isDebugging ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
          {isDebugging ? 'Running…' : 'Run'}
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
        <div className="flex items-center gap-1 px-2 pt-1 pb-2 border-t border-border/50" ref={dropdownRef}>
          <div className="relative flex-1 min-w-0">
            <input
              value={dropdownOpen ? filterText : newName}
              onChange={e => {
                const v = e.target.value
                if (dropdownOpen) {
                  setFilterText(v)
                  setNewName(v)
                } else {
                  setNewName(v)
                }
              }}
              onFocus={() => { setDropdownOpen(true); setFilterText(newName) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { addWatch(); e.preventDefault() }
                if (e.key === 'Escape') setDropdownOpen(false)
                if (e.key === 'ArrowDown' && filteredVars.length > 0) {
                  e.preventDefault()
                  // focus first item — simplified: just select it
                }
              }}
              placeholder="Search variables…"
              className="w-full text-xs font-mono bg-muted border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {dropdownOpen && filteredVars.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 w-56 max-h-48 overflow-auto bg-popover border border-border rounded shadow-lg z-50">
                {filteredVars.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => selectVar(v)}
                    className="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted text-left"
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
          <button onClick={addWatch} className="shrink-0 text-muted-foreground hover:text-foreground">
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Trace output */}
      <div className="flex-1 overflow-auto">
        {events.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground italic leading-relaxed">
            Click the margin to set a breakpoint, add watches above, then Run. Watches are captured each time the run reaches a breakpoint.
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

export default function ProcessEditor({ tab }) {
  const { server, serverVersion, dark, themeVersion, initTabContent, markTabSaved, clearScrollTo, openTab, patchTab, setRevealTarget } = useStore()
  const { data, isLoading } = useProcess(tab.server, tab.name)
  const saveProcess   = useSaveProcess()
  const runProcess    = useRunProcess()
  const createProcess = useCreateProcess()
  const registeredRef    = useRef(false)
  const decorationIdsRef = useRef({})
  const debugProcess     = useDebugProcess()

  const [showDebug, setShowDebug]       = useState(false)
  const [breakpoints, setBreakpoints]   = useState({})
  const [watches, setWatches]           = useState([])
  const [debugEvents, setDebugEvents]   = useState([])
  const [isDebugging, setIsDebugging]   = useState(false)
  const [showDebugRun, setShowDebugRun] = useState(false)
  const [checkResults, setCheckResults] = useState(null)
  const [showCheck, setShowCheck]       = useState(false)
  const [showHelp, setShowHelp]         = useState(false)

  const SECTION_TO_KEY = { Prolog: 'PrologProcedure', Metadata: 'MetadataProcedure', Data: 'DataProcedure', Epilog: 'EpilogProcedure' }

  const [activeSection, setActiveSection] = useState('PrologProcedure')
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [showSaveMenu, setShowSaveMenu] = useState(false)
  const [saveMenuRect, setSaveMenuRect] = useState(null)   // fixed position: the toolbar row clips anything hanging below it
  const [draftName, setDraftName] = useState('')
  const [showRun, setShowRun] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [showMinimap, setShowMinimap]   = useState(() => loadSettings().editor?.minimap?.ti ?? false)
  const [showHistory, setShowHistory]   = useState(false)
  const [dismissedId, setDismissedId]   = useState(null)
  const [saveConflict, setSaveConflict] = useState(null)
  const [conflictDiff, setConflictDiff] = useState(null)
  const { openConflict, checkBeforeSave } = useConflictCheck(tab.server, 'process', tab.name)
  const [runOutput, setRunOutput] = useState(null)
  const [logContent, setLogContent] = useState(null)
  const [logOpen, setLogOpen] = useState(true)
  const [errorLogFilename, setErrorLogFilename] = useState(null)
  const [errorLogContent, setErrorLogContent] = useState(null)
  const [errorLogOpen, setErrorLogOpen] = useState(false)
  const [errorLogLoading, setErrorLogLoading] = useState(false)
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const pendingLineRef = useRef(null)
  // each section (Prolog/Metadata/Data/Epilog) is its own editor, so each keeps its own collapsed state
  const [collapsedSections, setCollapsedSections] = useState({})
  const regionsCollapsed = !!collapsedSections[activeSection]
  const setRegionsCollapsed = v => setCollapsedSections(c => ({ ...c, [activeSection]: v }))
  const [showRegionMenu, setShowRegionMenu] = useState(false)
  const [regionRect, setRegionRect] = useState(null)
  const [regionList, setRegionList] = useState([])   // scanned when the menu opens
  const regionBtnRef = useRef(null)

  // Local edits keyed by section; null = no changes
  const [edits, setEdits]           = useState({})
  const [paramEdits, setParamEdits] = useState(null)
  const [dsEdits, setDsEdits]       = useState(null)

  useEffect(() => {
    if (data) { initTabContent(tab.id, data); setParamEdits(null); setDsEdits(null) }
  }, [data])

  const markDirty = useCallback(() => {
    const current = useStore.getState().tabs.find(t => t.id === tab.id)
    if (current && !current.dirty) patchTab(tab.id, { dirty: true })
  }, [tab.id, patchTab])

  // Build sorted variable list for watch dropdown
  const availableVars = (() => {
    const sections = {}
    CODE_TABS.forEach(({ key }) => { sections[key] = edits[key] ?? data?.[key] ?? '' })
    const params = paramEdits ?? data?.Parameters ?? []
    return scanVariables(sections, params, data?.Variables)
  })()

  useEffect(() => {
    if (!tab.scrollToLine) return
    const key = SECTION_TO_KEY[tab.scrollToSection] ?? 'PrologProcedure'
    pendingLineRef.current = tab.scrollToLine
    clearScrollTo(tab.id)
    if (key !== activeSection) {
      setActiveSection(key)  // Monaco remounts → handleMount fires with pendingLineRef set
    } else if (editorRef.current) {
      editorRef.current.revealLineInCenter(tab.scrollToLine)
      editorRef.current.setPosition({ lineNumber: tab.scrollToLine, column: 1 })
      pendingLineRef.current = null
    }
  }, [tab.scrollToLine])

  const insertSnippet = (code) => {
    const editor = editorRef.current
    if (!editor) return
    // Use Monaco's snippet controller so ${1:...} tab stops work, instead of
    // inserting the braces as literal text.
    const snippets = editor.getContribution('snippetController2')
    if (snippets) snippets.insert(code)
    else {
      const sel = editor.getSelection()
      editor.executeEdits('snippet', [{ range: sel, text: code }])
    }
    editor.focus()
  }

  const toggleMinimap = () => {
    const next = !showMinimap
    setShowMinimap(next)
    editorRef.current?.updateOptions({ minimap: { enabled: next } })
    const s = loadSettings()
    saveSettings({ ...s, editor: { ...s.editor, minimap: { ...(s.editor.minimap ?? {}), ti: next } } })
  }

  useEffect(() => {
    if (!showRegionMenu) return
    const handler = (e) => {
      if (!e.target.closest('.region-menu-container')) setShowRegionMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showRegionMenu])

  const toggleRegions = () => {
    const editor = editorRef.current
    if (!editor) return
    if (regionsCollapsed) {
      editor.trigger('fold', 'editor.unfoldAllMarkerRegions')
      setRegionsCollapsed(false)
    } else {
      editor.trigger('fold', 'editor.foldAllMarkerRegions')
      setRegionsCollapsed(true)
    }
  }

  const getRegions = () => {
    const editor = editorRef.current
    if (!editor) return []
    const regions = []
    const lineCount = editor.getModel().getLineCount()
    for (let line = 1; line <= lineCount; line++) {
      const text = editor.getModel().getLineContent(line).trim()
      const match = text.match(/^#Region\b\s*(.*)$/i)
      if (match) {
        regions.push({ line, name: match[1].trim() || 'Region' })
      }
    }
    return regions
  }

  const goToRegion = (line) => {
    const editor = editorRef.current
    if (!editor) return
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
    setShowRegionMenu(false)
  }

  const openRegionMenu = () => {
    const next = !showRegionMenu
    setShowRegionMenu(next)
    if (next) setRegionList(getRegions())
    if (next && regionBtnRef.current) {
      const r = regionBtnRef.current.getBoundingClientRect()
      setRegionRect({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
  }

  useEffect(() => {
    if (monacoRef.current) registerTM1Theme(monacoRef.current, dark)
  }, [dark, themeVersion])

  // Re-apply the user's font preferences when they change in the preferences panel
  useEffect(() => {
    const editorSettings = loadSettings().editor ?? {}
    editorRef.current?.updateOptions({
      fontFamily: editorSettings.fontFamily ?? undefined,
      fontSize:   editorSettings.fontSize ?? undefined,
      lineHeight: editorSettings.lineHeight ?? undefined,
    })
  }, [themeVersion])

  const undo = () => editorRef.current?.trigger('tm1ide', 'undo', null)
  const redo = () => editorRef.current?.trigger('tm1ide', 'redo', null)

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    enableQuoteDoubleClick(editor)
    // Explicit undo/redo bindings, as in the Rules editor, so the shortcuts stay in the editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => editor.trigger('tm1ide', 'undo', null))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () => editor.trigger('tm1ide', 'redo', null))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => editor.trigger('tm1ide', 'redo', null))
    if (regionsCollapsed) requestAnimationFrame(() => editor.trigger('fold', 'editor.foldAllMarkerRegions'))
    // apply the user's editor font preferences (fontFamily / fontSize / lineHeight from settings)
    const editorSettings = loadSettings().editor ?? {}
    editor.updateOptions({
      fontFamily: editorSettings.fontFamily ?? undefined,
      fontSize:   editorSettings.fontSize ?? undefined,
      lineHeight: editorSettings.lineHeight ?? undefined,
    })
    if (!registeredRef.current) {
      registerTM1Completions(monaco, () => server, () => serverVersion)
      registerTICompletions(monaco)
      registerTM1Theme(monaco, dark)
      registeredRef.current = true
    }
    if (pendingLineRef.current) {
      editor.revealLineInCenter(pendingLineRef.current)
      editor.setPosition({ lineNumber: pendingLineRef.current, column: 1 })
      pendingLineRef.current = null
    }
    // Apply any existing breakpoints for this section
    const bps = breakpoints[activeSection] ?? new Set()
    if (bps.size > 0) {
      const decs = [...bps].map(line => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { glyphMarginClassName: 'debug-bp-glyph' },
      }))
      decorationIdsRef.current[activeSection] = editor.deltaDecorations([], decs)
    }
    // TI comment toggle — uses # (not // which is Monaco's default)
    editor.addAction({
      id: 'ti-toggle-comment',
      label: 'Toggle TI Comment (#)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
      run: (ed) => {
        const model = ed.getModel()
        const sel   = ed.getSelection()
        const edits = []
        for (let ln = sel.startLineNumber; ln <= sel.endLineNumber; ln++) {
          const text = model.getLineContent(ln)
          const trimmed = text.trimStart()
          if (trimmed.startsWith('#')) {
            const idx = text.indexOf('#')
            edits.push({ range: new monaco.Range(ln, idx + 1, ln, idx + 2), text: '' })
          } else {
            edits.push({ range: new monaco.Range(ln, 1, ln, 1), text: '#' })
          }
        }
        ed.executeEdits('ti-comment', edits)
      }
    })

    // Typing '(' right after a function name can leave Monaco's suggest
    // widget showing stale results from the snippet-library provider
    // (tm1-snippets.js) instead of cleanly re-querying every provider — both
    // are registered on tm1ti, but only tm1-completion.js declares '(' as a
    // trigger character, and Monaco doesn't reliably discard the other
    // provider's already-rendered items on that kind of re-trigger. Force a
    // full close + fresh re-open so it can't hold onto the wrong list.
    editor.onDidType(text => {
      if (text === '(') {
        editor.trigger('tm1ide', 'hideSuggestWidget', {})
        setTimeout(() => editor.trigger('tm1ide', 'editor.action.triggerSuggest', {}), 0)
      }
    })

    // Font zoom shortcuts (Ctrl++/Ctrl+-/Ctrl+0)
    editor.onKeyDown(e => {
      if (e.ctrlKey || e.metaKey) {
        const code = e.browserEvent.code
        if (code === 'Equal' || code === 'NumpadAdd') {
          e.browserEvent.preventDefault(); e.browserEvent.stopPropagation()
          editor.getAction('editor.action.fontZoomIn')?.run()
        } else if (code === 'Minus' || code === 'NumpadSubtract') {
          e.browserEvent.preventDefault(); e.browserEvent.stopPropagation()
          editor.getAction('editor.action.fontZoomOut')?.run()
        } else if (code === 'Digit0' || code === 'Numpad0') {
          e.browserEvent.preventDefault(); e.browserEvent.stopPropagation()
          editor.getAction('editor.action.fontZoomReset')?.run()
        }
      }
    })

    // Toggle breakpoint on glyph margin click
    editor.onMouseDown(e => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const line = e.target.position?.lineNumber
        if (line) toggleBreakpoint(activeSection, line)
      }
    })
  }

  const jumpToError = (tmSection, line) => {
    const key = SECTION_TO_KEY[tmSection]
    if (!key) return
    pendingLineRef.current = line
    if (key !== activeSection) {
      setActiveSection(key)
    } else if (editorRef.current) {
      editorRef.current.revealLineInCenter(line)
      editorRef.current.setPosition({ lineNumber: line, column: 1 })
      pendingLineRef.current = null
    }
  }

  const handleRun = (values) => {
    setRunOutput(null)
    setLogContent(null)
    setLogOpen(true)
    setErrorLogFilename(null)
    setErrorLogContent(null)
    setErrorLogOpen(false)
    const id = toast.loading('Running process…')
    runProcess.mutate(
      { server: tab.server, name: tab.name, params: values },
      {
        onSuccess: (res) => {
          setShowRun(false)
          toast.success('Process completed', { id })
          setRunOutput({ status: 'ok', duration: res?.duration ?? null })
          setLogContent(res?.runLog ?? '')
          if (res?.errorLogFilename) setErrorLogFilename(res.errorLogFilename)
        },
        onError: (e) => {
          toast.dismiss(id)
          const detail = e.data ?? {}
          setRunOutput({
            status:  'error',
            message: detail.error || e.message,
            section: detail.section ?? null,
            line:    detail.line   ?? null,
          })
          setLogContent(detail.runLog ?? '')
          if (detail.errorLogFilename) setErrorLogFilename(detail.errorLogFilename)
        },
      },
    )
  }

  const loadErrorLog = async () => {
    if (!errorLogFilename) return
    setErrorLogOpen(true)
    setErrorLogLoading(true)
    setErrorLogContent(null)
    try {
      const r = await fetch(`/api/process/errorlog/content?server=${encodeURIComponent(tab.server)}&filename=${encodeURIComponent(errorLogFilename)}`, { headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' } })
      const d = await r.json()
      setErrorLogContent(d.content ?? '')
    } catch {
      setErrorLogContent('Failed to load error log.')
    } finally {
      setErrorLogLoading(false)
    }
  }

  const handleCreateNew = () => {
    const name = draftName.trim()
    if (!name) return
    const body = {}
    CODE_TABS.forEach(({ key }) => { body[key] = edits[key] ?? '' })
    if (paramEdits !== null) body.Parameters = paramEdits.map(p => ({ Name: p.Name, Type: toTypeStr(p.Type), Value: String(p.Value ?? ''), Prompt: p.Prompt ?? '' }))
    if (dsEdits !== null) body.DataSource = dsEdits
    const id = toast.loading(`Creating "${name}"…`)
    createProcess.mutate({ server: tab.server, name }, {
      onSuccess: () => saveProcess.mutate({ server: tab.server, name, body }, {
        onSuccess: () => { toast.success(`Process created`, { id }); patchTab(tab.id, { name, label: name }) },
        onError: e => toast.error(e.message, { id }),
      }),
      onError: e => toast.error(e.message, { id }),
    })
  }

  const doSave = () => {
    if (!data) return
    const body = {}
    CODE_TABS.forEach(({ key }) => {
      body[key] = edits[key] ?? data[key] ?? ''
    })
    if (paramEdits !== null) {
      body.Parameters = paramEdits.map(p => ({
        Name:   p.Name,
        Type:   toTypeStr(p.Type),
        Value:  String(p.Value ?? ''),
        Prompt: p.Prompt ?? '',
      }))
    }
    if (dsEdits !== null) {
      body.DataSource = dsEdits
    }
    const id = toast.loading('Saving process…')
    saveProcess.mutate(
      { server: tab.server, name: tab.name, body },
      {
        onSuccess: () => {
          markTabSaved(tab.id)
          toast.success('Process saved', { id })
          // Non-blocking reference integrity check
          const sections = {}
          CODE_TABS.forEach(({ key }) => { sections[key] = edits[key] ?? data[key] ?? '' })
          const token = localStorage.getItem('tm1-token') ?? ''
          fetch('/api/process/check-references', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-ide-token': token },
            body: JSON.stringify({ server: tab.server, sections }),
          })
            .then(r => r.json())
            .then(d => { d.warnings?.forEach(w => toast.warning(w.message, { duration: 8000 })) })
            .catch(() => {})
        },
        onError:   (e) => toast.error(e.message, { id }),
      },
    )
  }

  const handleSave = async () => {
    if (!tab.name) { handleCreateNew(); return }
    const conflict = await checkBeforeSave()
    if (conflict) { setSaveConflict(conflict); return }
    doSave()
  }

  const handleSaveAs = (newName) => {
    const body = {}
    CODE_TABS.forEach(({ key }) => { body[key] = edits[key] ?? data?.[key] ?? '' })
    if (paramEdits !== null) body.Parameters = paramEdits.map(p => ({ Name: p.Name, Type: toTypeStr(p.Type), Value: String(p.Value ?? ''), Prompt: p.Prompt ?? '' }))
    if (dsEdits !== null) body.DataSource = dsEdits
    const id = toast.loading(`Creating "${newName}"…`)
    createProcess.mutate({ server: tab.server, name: newName }, {
      onSuccess: () => saveProcess.mutate({ server: tab.server, name: newName, body }, {
        onSuccess: () => {
          toast.success(`Saved as "${newName}"`, { id })
          setShowSaveAs(false)
          openTab({ id: `process:${tab.server}:${newName}`, type: 'process', label: newName, server: tab.server, name: newName, content: null })
        },
        onError: e => toast.error(e.message, { id }),
      }),
      onError: e => toast.error(e.message, { id }),
    })
  }

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [data, edits])

  const toggleBreakpoint = useCallback((sectionKey, lineNum) => {
    setBreakpoints(prev => {
      const next = { ...prev }
      const set = new Set(next[sectionKey] ?? [])
      set.has(lineNum) ? set.delete(lineNum) : set.add(lineNum)
      next[sectionKey] = set
      return next
    })
  }, [])

  // Keep decorations in sync whenever breakpoints, active section, or debug mode changes
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const bps = showDebug ? (breakpoints[activeSection] ?? new Set()) : new Set()
    const newDecs = [...bps].map(line => ({
      range: new monaco.Range(line, 1, line, 1),
      options: { glyphMarginClassName: 'debug-bp-glyph' },
    }))
    const old = decorationIdsRef.current[activeSection] ?? []
    decorationIdsRef.current[activeSection] = editor.deltaDecorations(old, newDecs)
  }, [breakpoints, activeSection, showDebug])

  const jumpToDebugLine = useCallback((section, lineNum) => {
    const key = SECTION_TO_KEY[section]
    if (!key) return
    pendingLineRef.current = lineNum
    if (key !== activeSection) {
      setActiveSection(key)
    } else if (editorRef.current) {
      editorRef.current.revealLineInCenter(lineNum)
      editorRef.current.setPosition({ lineNumber: lineNum, column: 1 })
      pendingLineRef.current = null
    }
  }, [activeSection])

  const handleCheck = () => {
    const sections = {}
    CODE_TABS.forEach(({ key }) => {
      sections[key] = edits[key] ?? data?.[key] ?? ''
    })
    const results = validateTICode(sections, { version: serverVersion })
    setCheckResults(results)
    setShowCheck(true)
    if (results.length === 0) {
      toast.success('No issues found')
    } else {
      const errors = results.filter(r => r.severity === 'error').length
      const warnings = results.filter(r => r.severity === 'warning').length
      toast[errors > 0 ? 'error' : 'warning'](
        `${errors > 0 ? `${errors} error${errors > 1 ? 's' : ''}, ` : ''}${warnings} warning${warnings !== 1 ? 's' : ''} found`
      )
    }
    // Set Monaco markers for the active section
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (editor && monaco) {
      const model = editor.getModel()
      if (model) {
        const activeLabel = SECTION_LABEL[activeSection]
        const secResults = results.filter(r => r.section === activeLabel)
        const markers = secResults.map(r => ({
          severity: r.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: r.message,
          startLineNumber: r.line,
          startColumn: 1,
          endLineNumber: r.line,
          endColumn: model.getLineMaxColumn(r.line),
        }))
        monaco.editor.setModelMarkers(model, 'ti-check', markers)
      }
    }
  }

  const handleDebugRun = (params) => {
    // Instrumenting an unknown name makes TI abort before any breakpoint can
    // report. Catch it here with the actual variable list instead.
    const knownVars = new Set(availableVars.map(v => v.name.toLowerCase()))
    const unknown = watches.filter(w => !knownVars.has(w.name.toLowerCase()))
    if (unknown.length) {
        toast.warning(`Unknown watch variable${unknown.length > 1 ? 's' : ''}: ${unknown.map(w => w.name).join(', ')}. Add the variable to the process or remove the watch.`)
        return
    }
    setShowDebugRun(false)
    setRunOutput(null)
    setIsDebugging(true)
    setDebugEvents([])
    const sections = {}
    CODE_TABS.forEach(({ key }) => {
      sections[key] = edits[key] ?? data?.[key] ?? ''
    })
    // Build param array from RunDialog values
    const paramArray = (data?.Parameters ?? []).map(p => {
      const raw = params?.[p.Name]
      return { Name: p.Name, Value: raw !== undefined ? raw : (p.Value ?? '') }
    })
    debugProcess.mutate({
      server: tab.server,
      name: tab.name,
      params: paramArray,
      sections,
      watches,
      breakpoints,
    }, {
      onSuccess: res => {
        setDebugEvents(parseDebugLog(res.log))
        setCheckResults((res.warnings ?? []).map(w => ({
          severity: 'warning',
          section: w.section,
          line: w.line,
          message: w.msg || `Unknown function "${w.name}"`,
        })))
        if (res.warnings?.length) {
          toast.warning(`${res.warnings.length} unknown function${res.warnings.length > 1 ? 's' : ''} commented out — see Issues panel`)
        }
        setIsDebugging(false)
        if (res.error) {
            if (res.error.includes('invalid string expression')) {
                toast.warning(`Process errored: ${res.error} — this may be a TM1 variable name length bug. Try shortening variable names to ≤ 8 characters.`)
            } else {
                toast.warning(`Process errored: ${res.error}`)
            }
        }
        else if (res.badVars?.length) toast.warning(`Variable names may cause TM1 API issues: ${res.badVars.join(', ')} — consider shortening`)
        else if (res.noCapture) toast.info('Debug run complete — no watches or breakpoints set')
        else toast.success('Debug run complete')
      },
      onError: e => {
        setIsDebugging(false)
        toast.error(`Debug failed: ${e.message}`)
      },
    })
  }

  if (isLoading && !data) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading process…</div>
  }

  const value = edits[activeSection] ?? data?.[activeSection] ?? ''

  return (
    <div className="flex flex-col h-full">
      <ConflictBanner conflict={openConflict?.id !== dismissedId ? openConflict : null} onDismiss={() => setDismissedId(openConflict?.id)} />
      <ConflictSaveWarning
        conflict={saveConflict}
        onSaveAnyway={() => { setSaveConflict(null); doSave() }}
        onCancel={() => setSaveConflict(null)}
        onShowDiff={() => {
          const current = {
            prolog:   edits.PrologProcedure   ?? data?.PrologProcedure   ?? '',
            metadata: edits.MetadataProcedure ?? data?.MetadataProcedure ?? '',
            data:     edits.DataProcedure     ?? data?.DataProcedure     ?? '',
            epilog:   edits.EpilogProcedure   ?? data?.EpilogProcedure   ?? '',
          }
          setConflictDiff({
            object_type: 'process',
            object_name: tab.name,
            timestamp:   saveConflict.timestamp,
            action:      'CONFLICT',
            session_name: null,
            before_state: saveConflict.after_state ?? current,
            after_state:  current,
          })
        }}
      />
      {conflictDiff && <DiffViewerModal entry={conflictDiff} onClose={() => setConflictDiff(null)} />}
      {tab.name && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border bg-muted/30 shrink-0">
          <span className="text-xs font-mono font-semibold text-foreground">{tab.name}</span>
          <button
            onClick={() => setRevealTarget({ type: 'process', server: tab.server, name: tab.name })}
            className="flex items-center text-amber-400 hover:text-amber-300 transition-colors"
            title="Show in tree"
          >
            <Locate size={11} />
          </button>
          <span className="text-xs text-muted-foreground">TI Process</span>
          <button
            onClick={() => setShowHelp(true)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs border bg-background/80 border-border text-muted-foreground hover:text-foreground transition-colors"
            title="Help — TI Process Editor"
          >
            <HelpCircle size={11} />
          </button>
        </div>
      )}
      <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="ti" />

      {/* ── Save As dialog ────────────────────────────────────────────── */}
      {showSaveAs && (
        <SaveAsDialog
          sourceName={tab.name}
          onSave={handleSaveAs}
          onClose={() => setShowSaveAs(false)}
          isPending={createProcess.isPending || saveProcess.isPending}
        />
      )}

      {/* ── Run dialog ────────────────────────────────────────────────── */}
      {showRun && (
        <RunDialog
          params={data?.Parameters}
          onRun={handleRun}
          onClose={() => setShowRun(false)}
          isPending={runProcess.isPending}
        />
      )}

      {/* ── Debug run dialog ──────────────────────────────────────────── */}
      {showDebugRun && (
        <RunDialog
          title="Debug Run"
          params={paramEdits ?? data?.Parameters}
          onRun={handleDebugRun}
          onClose={() => setShowDebugRun(false)}
          isPending={isDebugging}
        />
      )}


      {/* ── Section tabs + actions ─────────────────────────────────────── */}
      <div className="flex items-center border-b border-border bg-muted shrink-0 overflow-x-auto">
        {CODE_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            className={cn(
              'px-4 py-1.5 text-xs font-medium border-r border-border transition-colors',
              activeSection === key
                ? 'bg-background text-foreground border-t-2 border-t-primary -mt-px'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
            )}
          >
            {label}
            {edits[key] !== undefined && (
              <span className="ml-1.5 text-orange-400">●</span>
            )}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1 mr-2">
          <button
            onClick={() => setShowHistory(v => !v)}
            disabled={!tab.name}
            title="Object history"
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors disabled:opacity-40',
              showHistory ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <History size={11} />
          </button>
          <button
            onClick={undo}
            title="Undo (Ctrl/Cmd+Z)"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Undo2 size={11} />
          </button>
          <button
            onClick={redo}
            title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Redo2 size={11} />
          </button>
          {!tab.name ? (
            <>
              <input
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateNew()}
                placeholder="Process name…"
                className="px-2 py-1 text-xs border rounded bg-background font-mono outline-none focus:border-primary w-44"
              />
              <button
                onClick={handleCreateNew}
                disabled={!draftName.trim() || createProcess.isPending || saveProcess.isPending}
                className="px-3 py-1 text-xs rounded bg-emerald-700 text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {createProcess.isPending || saveProcess.isPending ? 'Creating…' : 'Create & Save'}
              </button>
            </>
          ) : (
            <div className="relative flex items-center">
              <button
                onClick={handleSave}
                disabled={(!Object.keys(edits).length && paramEdits === null && dsEdits === null) || saveProcess.isPending}
                title="Save (Ctrl+S)"
                className="px-3 py-1 text-xs rounded-l bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {saveProcess.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setSaveMenuRect({ top: r.bottom + 4, right: window.innerWidth - r.right })
                  setShowSaveMenu(v => !v)
                }}
                disabled={!data}
                title="Save options"
                className="px-1 py-1 text-xs rounded-r bg-primary text-primary-foreground border-l border-primary-foreground/20 disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                <ChevronDown size={11} />
              </button>
              {showSaveMenu && saveMenuRect && (
                <div className="fixed bg-popover border border-border rounded shadow-lg py-1 w-44"
                  style={{ top: saveMenuRect.top, right: saveMenuRect.right, zIndex: 9999 }}
                  onMouseLeave={() => setShowSaveMenu(false)}>
                  <button onClick={() => { setShowSaveAs(true); setShowSaveMenu(false) }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors">
                    Save As… (new name)
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => {
              setShowDebug(false)
              setShowSnippets(false)
              if (showCheck) {
                setShowCheck(false)
              } else {
                handleCheck()
              }
            }}
            disabled={!data}
            title="Check code for errors and warnings"
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors disabled:opacity-40',
              showCheck ? 'bg-amber-600 text-white border-amber-600 hover:bg-amber-700' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <Search size={11} />
            <span className="hidden sm:inline">Check</span>
          </button>
          <button
            onClick={() => { setShowDebug(d => !d); setShowSnippets(false) }}
            disabled={!data}
            title="Debug — click gutter to set breakpoints"
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors disabled:opacity-40',
              showDebug ? 'bg-orange-600 text-white border-orange-600 hover:bg-orange-700' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <Bug size={11} />
            <span className="hidden sm:inline">Debug</span>
          </button>
          <button
            onClick={() => setShowRun(true)}
            disabled={!data}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-green-600 text-white disabled:opacity-40 hover:bg-green-700 transition-colors"
          >
            <Play size={11} />
            Run
          </button>
          <div className="relative region-menu-container shrink-0">
            <button
              ref={regionBtnRef}
              onClick={openRegionMenu}
              title="Go to region"
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors',
                showRegionMenu ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <ListTree size={11} />
            </button>
            {showRegionMenu && regionRect && (
              <div
                className="fixed w-56 bg-popover border border-border rounded shadow-lg max-h-64 overflow-auto text-xs"
                style={{ top: regionRect.top, right: regionRect.right, zIndex: 9999 }}
              >
                {regionList.length === 0 ? (
                  <div className="px-3 py-1.5 text-muted-foreground italic">No regions found</div>
                ) : (
                  regionList.map(r => (
                    <button
                      key={r.line}
                      onClick={() => goToRegion(r.line)}
                      className="flex items-center gap-1.5 w-full px-3 py-1 text-left hover:bg-muted text-sidebar-foreground truncate"
                      title={`Line ${r.line}`}
                    >
                      <span className="text-muted-foreground/50 font-mono text-[10px] shrink-0">{r.line}</span>
                      <span className="truncate">{r.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            onClick={toggleRegions}
            title={regionsCollapsed ? 'Expand all regions' : 'Collapse all regions'}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors',
              regionsCollapsed ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            {regionsCollapsed ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
          </button>
          <button
            onClick={() => { setShowSnippets(s => !s); setShowDebug(false) }}
            title="Function reference"
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors',
              showSnippets ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <Braces size={11} />
          </button>
          <button
            onClick={toggleMinimap}
            title="Toggle minimap"
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors',
              showMinimap ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <Map size={11} />
          </button>
        </div>
      </div>

      {/* ── Collapsible metadata sections ─────────────────────────────── */}
      {data && (
        <CollapsibleSection
          label="Datasource"
          hint={(() => {
            const d = dsEdits ?? data.DataSource
            const t = d?.Type ?? 'None'
            if (!d || t === 'None') return dsEdits !== null ? 'None · unsaved' : 'None'
            const name = d.dataSourceNameForServer ?? d.dataSourceNameForClient ?? ''
            return `${t}${name ? '  ·  ' + name : ''}${dsEdits !== null ? ' · unsaved' : ''}`
          })()}
        >
          <EditableDatasourcePanel
            ds={dsEdits ?? data.DataSource ?? { Type: 'None' }}
            server={tab.server}
            onChange={v => { setDsEdits(v); markDirty() }}
          />
        </CollapsibleSection>
      )}

      {data && ['ODBC', 'ASCII', 'TM1CubeView', 'TM1DimensionSubset'].includes((dsEdits ?? data.DataSource)?.Type) && (
        <CollapsibleSection label="Datasource Preview" hint={(dsEdits ?? data.DataSource)?.dataSourceNameForServer ?? ''}>
          <DatasourcePreviewPanel ds={dsEdits ?? data.DataSource} server={tab.server} params={paramEdits ?? data.Parameters} />
        </CollapsibleSection>
      )}

      {data?.Variables?.length > 0 && (
        <CollapsibleSection label="Variables" hint={`${data.Variables.length} column${data.Variables.length !== 1 ? 's' : ''}`}>
          <VariablesPanel variables={data.Variables} />
        </CollapsibleSection>
      )}

      {data && (
        <CollapsibleSection
          label="Parameters"
          hint={(() => {
            const list = paramEdits ?? data.Parameters ?? []
            const base = `${list.length} parameter${list.length !== 1 ? 's' : ''}`
            return paramEdits !== null ? base + ' · unsaved' : base
          })()}
        >
          <EditableParamsPanel
            params={paramEdits ?? data.Parameters ?? []}
            onChange={v => { setParamEdits(v); markDirty() }}
          />
        </CollapsibleSection>
      )}

      {/* ── Run output + log panel ────────────────────────────────────── */}
      {runOutput && (
        <div className={cn(
          'shrink-0 border-t border-border',
          runOutput.status === 'error' ? 'bg-red-950/20' : 'bg-green-950/10'
        )}>
          {/* Status bar */}
          <div className="flex items-center gap-3 px-4 py-1.5 text-xs">
            {runOutput.status === 'ok' ? (
              <>
                <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                <span className="text-green-400">
                  Completed{runOutput.duration != null ? ` — ${runOutput.duration}ms` : ''}
                </span>
              </>
            ) : (
              <>
                <XCircle size={13} className="text-red-400 shrink-0" />
                <span className="text-red-300 font-mono truncate flex-1">{runOutput.message}</span>
                {runOutput.section && runOutput.line && (
                  <button
                    onClick={() => jumpToError(runOutput.section, runOutput.line)}
                    className="shrink-0 text-red-300 hover:text-red-100 underline underline-offset-2"
                  >
                    → {runOutput.section} line {runOutput.line}
                  </button>
                )}
              </>
            )}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {errorLogFilename && (
                <button
                  onClick={errorLogOpen ? () => setErrorLogOpen(false) : loadErrorLog}
                  className={cn(
                    'flex items-center gap-1 text-xs transition-colors',
                    errorLogOpen ? 'text-amber-400 hover:text-amber-300' : 'text-amber-500 hover:text-amber-400'
                  )}
                  title={`View TM1 error log: ${errorLogFilename}`}
                >
                  <AlertCircle size={11} />
                  Error Log
                </button>
              )}
              <button
                onClick={() => setLogOpen(o => !o)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Toggle run log output"
              >
                {logOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span>Log</span>
              </button>
              <button
                onClick={() => { setRunOutput(null); setLogContent(null); setErrorLogFilename(null); setErrorLogContent(null); setErrorLogOpen(false) }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={11} />
              </button>
            </div>
          </div>

          {/* __RUN_LOG content */}
          {logOpen && (
            <div className="border-t border-border/50 max-h-52 overflow-auto px-4 py-2">
              {logContent === null ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={11} className="animate-spin" /> Running…
                </div>
              ) : logContent === '' ? (
                <p className="text-xs text-muted-foreground italic">No log output. Use AttrPutS to write to __RUN_LOG in your TI.</p>
              ) : (
                <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">{logContent}</pre>
              )}
            </div>
          )}

          {/* TM1 Error Log file content */}
          {errorLogOpen && (
            <div className="border-t border-amber-900/40 bg-amber-950/10 max-h-64 overflow-auto px-4 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-amber-500/70 truncate">{errorLogFilename}</span>
              </div>
              {errorLogLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={11} className="animate-spin" /> Loading…
                </div>
              ) : (
                <pre className="text-xs font-mono text-amber-200/80 whitespace-pre-wrap leading-relaxed">{errorLogContent ?? ''}</pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Monaco editor ─────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 min-w-0">
          <MonacoEditor
            key={activeSection}
            height="100%"
            language="tm1ti"
            value={value}
            theme="tm1-custom"
            beforeMount={monaco => registerTM1Theme(monaco, dark)}
            onChange={v => { setEdits(e => ({ ...e, [activeSection]: v })); markDirty() }}
            onMount={handleMount}
            options={{
              padding: { top: 48, bottom: 12 },
              fontFamily: loadSettings().editor?.fontFamily ?? undefined,
              fontSize: loadSettings().editor?.fontSize ?? undefined,
              lineHeight: loadSettings().editor?.lineHeight ?? undefined,
              minimap: { enabled: showMinimap },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              glyphMargin: true,
              folding: true,
              foldingStrategy: 'auto',
              find: { seedSearchStringFromSelection: 'always', autoFindInSelection: 'never' },
              wordBasedSuggestions: 'off',
            }}
          />
          {showHistory && tab.name && (
            <ObjectHistoryPanel
              server={tab.server}
              objectType="process"
              objectName={tab.name}
              onClose={() => setShowHistory(false)}
            />
          )}
        </div>
        {showSnippets && (
          <div className="w-72 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
            <SnippetPanel snippets={getFunctionRef('ti')} language="ti" onInsert={insertSnippet} />
          </div>
        )}
        {showDebug && (
            <DebugPanel
              watches={watches}
              onWatchesChange={setWatches}
              events={debugEvents}
              isDebugging={isDebugging}
              availableVars={availableVars}
              onRun={() => {
                const params = paramEdits ?? data?.Parameters ?? []
                if (params.length) setShowDebugRun(true)
                else handleDebugRun({})
              }}
              onJumpTo={jumpToDebugLine}
            />
          )}
          {showCheck && checkResults && (
            <div className="w-80 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <Search size={11} /> Issues
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {checkResults.length === 0
                    ? 'No issues'
                    : `${checkResults.filter(r => r.severity === 'error').length} err / ${checkResults.filter(r => r.severity === 'warning').length} warn`}
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                {checkResults.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground italic flex items-center gap-1.5">
                    <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                    All checks passed
                  </div>
                ) : (
                  <div className="py-1">
                    {checkResults.map((r, i) => (
                      <div
                        key={i}
                        onClick={() => r.line && jumpToDebugLine(r.section, r.line)}
                        className={cn(
                          'flex items-start gap-2 px-3 py-1.5 text-xs border-b border-border/30 last:border-0 cursor-pointer hover:bg-muted/50',
                          r.severity === 'error' ? 'text-red-400' : 'text-amber-400'
                        )}
                      >
                        {r.severity === 'error'
                          ? <XCircle size={12} className="mt-0.5 shrink-0" />
                          : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={cn(
                              'font-semibold uppercase text-[10px]',
                              r.section === 'Prolog' ? 'text-blue-400' :
                              r.section === 'Metadata' ? 'text-purple-400' :
                              r.section === 'Data' ? 'text-green-400' :
                              r.section === 'Epilog' ? 'text-orange-400' : ''
                            )}>{r.section}</span>
                            {r.line && <span className="text-muted-foreground text-[10px]">:{r.line}</span>}
                          </div>
                          <div className="text-foreground/80 text-[11px] leading-relaxed break-words">{r.message}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

    </div>
  )
}
