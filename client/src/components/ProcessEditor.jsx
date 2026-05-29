import { useState, useRef, useEffect, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useProcess, useSaveProcess, useRunProcess, useFetchProcessLog, useCreateProcess, useDebugProcess, useCubes, useViews } from '@/hooks/useApi'
import { registerTM1Completions, registerTM1Theme } from '@/lib/tm1-functions'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ChevronRight, ChevronDown, Play, X, Braces, Wand2, CheckCircle2, XCircle, Database, Trash2, Plus, Loader2, Bug, Search, AlertTriangle, AlertCircle } from 'lucide-react'
import { getSnippets } from '@/lib/tm1-snippets.js'
import { executeTI, scanVariables } from '@/lib/ti-interpreter'
import { parseDebugLog } from '@/lib/ti-debugger'
import { validateTICode } from '@/lib/ti-validator'
import SnippetPanel from '@/components/SnippetPanel'
import PatternDialog from '@/components/PatternDialog'

const CODE_TABS = [
  { key: 'PrologProcedure',    label: 'Prolog'   },
  { key: 'MetaDataProcedure',  label: 'Metadata' },
  { key: 'DataProcedure',      label: 'Data'     },
  { key: 'EpilogProcedure',    label: 'Epilog'   },
]

const PARAM_TYPE = { 1: 'Numeric', 2: 'String' }

function EditableParamsPanel({ params, onChange }) {
  const cell = 'w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary px-1 py-0.5 font-mono focus:outline-none text-xs'

  const set = (i, field, val) => onChange(params.map((p, idx) => idx === i ? { ...p, [field]: val } : p))
  const add = () => onChange([...params, { Name: 'p', Type: 2, Value: '', Prompt: '' }])
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
                    value={p.Type ?? 2}
                    onChange={e => set(i, 'Type', +e.target.value)}
                    className="w-full bg-transparent text-xs focus:outline-none"
                  >
                    <option value={2}>String</option>
                    <option value={1}>Numeric</option>
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
        {(options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
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
        {row('File (server)', 'dataSourceNameForServer', { placeholder: '.\\data\\file.csv' })}
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

const DS_TYPES = [
  { value: 'ASCII',              label: 'ASCII File',         desc: 'Delimited or fixed-width text file' },
  { value: 'ODBC',               label: 'ODBC',               desc: 'Database via ODBC DSN and SQL query' },
  { value: 'TM1CubeView',        label: 'TM1 Cube View',      desc: 'Another cube on this server' },
  { value: 'TM1DimensionSubset', label: 'TM1 Dimension',      desc: 'Dimension subset as datasource' },
  { value: 'NULL',               label: 'No datasource',      desc: 'Pure TI code, no data loop' },
]

function buildDsCode(type, fields) {
  const q = (v) => `'${v}'`
  if (type === 'ASCII') return [
    `DataSourceType = 'ASCII';`,
    `DataSourceNameForServer = ${q(fields.serverPath)};`,
    `DataSourceNameForClient = ${q(fields.clientPath || fields.serverPath)};`,
    `DataSourceASCIIDelimiterType = 'Character';`,
    `DataSourceASCIIDelimiterChar = ${q(fields.delimiter || ',')};`,
    `DataSourceASCIIHeaderRecords = ${fields.headerRows ?? 1};`,
    `DataSourceASCIIQuoteCharacter = '"';`,
  ].join('\n')

  if (type === 'ODBC') return [
    `DataSourceType = 'ODBC';`,
    `DataSourceNameForServer = ${q(fields.dsn)};`,
    `DataSourceNameForClient = ${q(fields.dsn)};`,
    `DataSourceQuery = ${q(fields.query)};`,
    fields.username ? `DataSourceUserName = ${q(fields.username)};` : null,
    fields.password ? `DataSourcePassword = ${q(fields.password)};` : null,
  ].filter(Boolean).join('\n')

  if (type === 'TM1CubeView') return [
    `DataSourceType = 'TM1CubeView';`,
    `DataSourceNameForServer = ${q(fields.cube)};`,
    `DataSourceNameForClient = ${q(fields.cube)};`,
    `DataSourceView = ${q(fields.view)};`,
  ].join('\n')

  if (type === 'TM1DimensionSubset') return [
    `DataSourceType = 'TM1DimensionSubset';`,
    `DataSourceNameForServer = ${q(fields.dimension)};`,
    `DataSourceNameForClient = ${q(fields.dimension)};`,
    `DataSourceDimensionSubset = ${q(fields.subset)};`,
  ].join('\n')

  return `DataSourceType = 'NULL';`
}

function DatasourceInsertDialog({ server, onInsert, onClose }) {
  const [type, setType]     = useState('ASCII')
  const [fields, setFields] = useState({})
  const set = (k, v) => setFields(f => ({ ...f, [k]: v }))

  const { data: cubes }                          = useCubes(server)
  const { data: views, isFetching: fetchingViews } = useViews(server, fields.cube)

  const input = (label, key, opts = {}) => (
    <div className="space-y-1" key={key}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type={opts.type ?? 'text'}
        value={fields[key] ?? opts.default ?? ''}
        onChange={e => set(key, e.target.value)}
        placeholder={opts.placeholder ?? ''}
        className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  )

  const select = (label, key, options, loading) => (
    <div className="space-y-1" key={key}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select
        value={fields[key] ?? ''}
        onChange={e => set(key, e.target.value)}
        className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">{loading ? 'Loading…' : `Select ${label.toLowerCase()}…`}</option>
        {(options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )

  const fields_for_type = () => {
    if (type === 'ASCII') return (
      <div className="space-y-3">
        {input('File path (server)', 'serverPath', { placeholder: '.\\data\\file.csv' })}
        {input('File path (client)', 'clientPath', { placeholder: 'Leave blank to mirror server path' })}
        {input('Delimiter char', 'delimiter', { placeholder: ',', default: ',' })}
        {input('Header rows', 'headerRows', { type: 'number', default: '1' })}
      </div>
    )
    if (type === 'ODBC') return (
      <div className="space-y-3">
        {input('DSN name', 'dsn', { placeholder: 'MyDatabase' })}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">SQL query</label>
          <textarea
            value={fields.query ?? ''}
            onChange={e => set('query', e.target.value)}
            placeholder="SELECT col1, col2 FROM table WHERE ..."
            rows={3}
            className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>
        {input('Username', 'username', { placeholder: 'Optional' })}
        {input('Password', 'password', { placeholder: 'Optional' })}
      </div>
    )
    if (type === 'TM1CubeView') return (
      <div className="space-y-3">
        {select('Cube', 'cube', cubes)}
        {select('View', 'view', views, fetchingViews)}
      </div>
    )
    if (type === 'TM1DimensionSubset') return (
      <div className="space-y-3">
        {input('Dimension name', 'dimension', { placeholder: 'e.g. CostCentre' })}
        {input('Subset name', 'subset', { placeholder: 'e.g. All CostCentres' })}
      </div>
    )
    return <p className="text-xs text-muted-foreground">Inserts <code>DataSourceType = &apos;NULL&apos;;</code></p>
  }

  const canInsert = () => {
    if (type === 'ASCII')              return !!fields.serverPath
    if (type === 'ODBC')               return !!fields.dsn && !!fields.query
    if (type === 'TM1CubeView')        return !!fields.cube && !!fields.view
    if (type === 'TM1DimensionSubset') return !!fields.dimension && !!fields.subset
    return true
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">

        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-semibold">Insert Datasource Block</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>

        <div className="overflow-auto flex-1 px-4 py-3 space-y-4">
          {/* Type selector */}
          <div className="grid grid-cols-1 gap-1">
            {DS_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => { setType(t.value); setFields({}) }}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded border text-left transition-colors',
                  type === t.value ? 'border-primary bg-primary/10 text-foreground' : 'border-border hover:bg-muted text-muted-foreground'
                )}
              >
                <span className="text-xs font-semibold w-36 shrink-0">{t.label}</span>
                <span className="text-xs">{t.desc}</span>
              </button>
            ))}
          </div>

          {/* Type-specific fields */}
          <div className="border-t border-border pt-3">
            {fields_for_type()}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onInsert(buildDsCode(type, fields))}
            disabled={!canInsert()}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            Insert
          </button>
        </div>
      </div>
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
                type={p.Type === 1 ? 'number' : 'text'}
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
  const [newType, setNewType] = useState('number')
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
    if (!name || watches.some(w => w.name.toLowerCase() === name.toLowerCase())) return
    onWatchesChange([...watches, { name, type: newType }])
    setNewName('')
    setFilterText('')
    setDropdownOpen(false)
  }

  const selectVar = (v) => {
    setNewName(v.name)
    setNewType(v.type)
    setFilterText('')
    setDropdownOpen(false)
  }

  const filteredVars = (availableVars ?? []).filter(v => {
    if (!filterText) return true
    const lo = filterText.toLowerCase()
    return v.name.toLowerCase().includes(lo) || v.section.toLowerCase().includes(lo)
  }).slice(0, 30)

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
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-orange-600 text-white disabled:opacity-50 hover:bg-orange-500 transition-colors"
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
              placeholder="variable or type…"
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
          <select
            value={newType}
            onChange={e => setNewType(e.target.value)}
            className="text-xs bg-muted border border-border rounded px-1 py-0.5 focus:outline-none w-12 shrink-0"
          >
            <option value="number">num</option>
            <option value="string">str</option>
          </select>
          <button onClick={addWatch} className="shrink-0 text-muted-foreground hover:text-foreground">
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Trace output */}
      <div className="flex-1 overflow-auto">
        {events.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground italic leading-relaxed">
            Add watches above, then Run. Watches are captured at end of each section — click the gutter to also capture at specific lines.
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
  const { server, dark, themeVersion, updateTabContent, markTabSaved, clearScrollTo, openTab } = useStore()
  const { data, isLoading } = useProcess(tab.server, tab.name)
  const saveProcess   = useSaveProcess()
  const runProcess    = useRunProcess()
  const fetchLog      = useFetchProcessLog()
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

  const SECTION_TO_KEY = { Prolog: 'PrologProcedure', Metadata: 'MetaDataProcedure', Data: 'DataProcedure', Epilog: 'EpilogProcedure' }

  const [activeSection, setActiveSection] = useState('PrologProcedure')
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [showRun, setShowRun] = useState(false)
  const [showDsInsert, setShowDsInsert] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [showPatterns, setShowPatterns] = useState(false)
  const [runOutput, setRunOutput] = useState(null)
  const [logContent, setLogContent] = useState(null)
  const [logOpen, setLogOpen] = useState(true)
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const pendingLineRef = useRef(null)

  // Local edits keyed by section; null = no changes
  const [edits, setEdits]           = useState({})
  const [paramEdits, setParamEdits] = useState(null)
  const [dsEdits, setDsEdits]       = useState(null)

  useEffect(() => {
    if (data) { updateTabContent(tab.id, data); setParamEdits(null); setDsEdits(null) }
  }, [data])

  // Build sorted variable list for watch dropdown
  const availableVars = (() => {
    const sections = {}
    CODE_TABS.forEach(({ key }) => { sections[key] = edits[key] ?? data?.[key] ?? '' })
    const params = paramEdits ?? data?.Parameters ?? []
    return scanVariables(sections, params)
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
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const sel = editor.getSelection()
    editor.executeEdits('snippet', [{ range: sel, text: code }])
    editor.focus()
  }

  const handleInsertDs = (code) => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const pos = editor.getPosition()
    const range = new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column)
    editor.executeEdits('insert-datasource', [{ range, text: '\n' + code + '\n' }])
    editor.focus()
    setShowDsInsert(false)
  }

  useEffect(() => {
    if (monacoRef.current) registerTM1Theme(monacoRef.current, dark)
  }, [dark, themeVersion])

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    if (!registeredRef.current) {
      registerTM1Completions(monaco, () => server)
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

  const handleInsertPattern = (generated) => {
    const keys = Object.keys(generated).filter(k => generated[k]?.trim())
    if (!keys.length) return
    setEdits(prev => {
      const next = { ...prev }
      for (const key of keys) {
        const existing = (prev[key] ?? data?.[key] ?? '').trimEnd()
        next[key] = existing ? existing + '\n\n' + generated[key] : generated[key]
      }
      return next
    })
    const firstKey = keys[0]
    if (firstKey !== activeSection) setActiveSection(firstKey)
  }

  const grabLog = () => {
    fetchLog.mutate({ server: tab.server, name: tab.name }, {
      onSuccess: (r) => setLogContent(r?.log ?? ''),
      onError:   ()  => setLogContent(''),
    })
  }

  const handleRun = (values) => {
    setRunOutput(null)
    setLogContent(null)
    setLogOpen(true)
    const id = toast.loading('Running process…')
    runProcess.mutate(
      { server: tab.server, name: tab.name, params: values },
      {
        onSuccess: (res) => {
          setShowRun(false)
          toast.success('Process completed', { id })
          setRunOutput({ status: 'ok', duration: res?.duration ?? null })
          grabLog()
        },
        onError: (e) => {
          toast.dismiss(id)
          const detail = e.response?.data ?? {}
          setRunOutput({
            status:  'error',
            message: detail.error || e.message,
            section: detail.section ?? null,
            line:    detail.line   ?? null,
          })
          grabLog()
        },
      },
    )
  }

  const handleSave = () => {
    if (!data) return
    const body = {}
    CODE_TABS.forEach(({ key }) => {
      body[key] = edits[key] ?? data[key] ?? ''
    })
    if (paramEdits !== null) {
      body.Parameters = paramEdits.map(p => ({
        Name:   p.Name,
        Type:   p.Type ?? 2,
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
        onSuccess: () => { markTabSaved(tab.id); toast.success('Process saved', { id }) },
        onError:   (e) => toast.error(e.message, { id }),
      },
    )
  }

  const handleSaveAs = (newName) => {
    const body = {}
    CODE_TABS.forEach(({ key }) => { body[key] = edits[key] ?? data?.[key] ?? '' })
    if (paramEdits !== null) body.Parameters = paramEdits.map(p => ({ Name: p.Name, Type: p.Type ?? 2, Value: String(p.Value ?? ''), Prompt: p.Prompt ?? '' }))
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

  // Keep decorations in sync whenever breakpoints or active section changes
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const bps = breakpoints[activeSection] ?? new Set()
    const newDecs = [...bps].map(line => ({
      range: new monaco.Range(line, 1, line, 1),
      options: { glyphMarginClassName: 'debug-bp-glyph' },
    }))
    const old = decorationIdsRef.current[activeSection] ?? []
    decorationIdsRef.current[activeSection] = editor.deltaDecorations(old, newDecs)
  }, [breakpoints, activeSection])

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
    const results = validateTICode(sections)
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
  }

  const handleDebugRun = (params) => {
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
        if (res.error) toast.warning(`Process errored: ${res.error}`)
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

      {/* ── Save As dialog ────────────────────────────────────────────── */}
      {showSaveAs && (
        <SaveAsDialog
          sourceName={tab.name}
          onSave={handleSaveAs}
          onClose={() => setShowSaveAs(false)}
          isPending={createProcess.isPending || saveProcess.isPending}
        />
      )}

      {/* ── Datasource insert dialog ──────────────────────────────────── */}
      {showDsInsert && (
        <DatasourceInsertDialog
          server={tab.server}
          onInsert={handleInsertDs}
          onClose={() => setShowDsInsert(false)}
        />
      )}

      {/* ── Pattern dialog ────────────────────────────────────────────── */}
      {showPatterns && (
        <PatternDialog
          onInsert={handleInsertPattern}
          onClose={() => setShowPatterns(false)}
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
            onClick={() => setShowPatterns(true)}
            title="Patterns"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Wand2 size={11} />
            <span className="hidden sm:inline">Patterns</span>
          </button>
          <button
            onClick={() => { setShowSnippets(s => !s); setShowDebug(false) }}
            title="Snippets"
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors',
              showSnippets ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <Braces size={11} />
            <span className="hidden sm:inline">Snippets</span>
          </button>
          <button
            onClick={() => setShowDsInsert(true)}
            disabled={!data}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            title="Insert datasource block"
          >
            <Database size={11} />
            <span className="hidden sm:inline">Datasource</span>
          </button>
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
          <button
            onClick={() => setShowSaveAs(true)}
            disabled={!data}
            className="px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            title="Save As — copy to new process name"
          >
            Save As
          </button>
          <button
            onClick={handleSave}
            disabled={(!Object.keys(edits).length && paramEdits === null && dsEdits === null) || saveProcess.isPending}
            className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {saveProcess.isPending ? 'Saving…' : 'Save'}
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
            onChange={setDsEdits}
          />
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
            onChange={setParamEdits}
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
              <button
                onClick={() => setLogOpen(o => !o)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Toggle log output"
              >
                {logOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span>Log</span>
                {fetchLog.isPending && <Loader2 size={10} className="animate-spin" />}
              </button>
              <button
                onClick={() => { setRunOutput(null); setLogContent(null) }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={11} />
              </button>
            </div>
          </div>

          {/* Log content */}
          {logOpen && (
            <div className="border-t border-border/50 max-h-52 overflow-auto px-4 py-2">
              {fetchLog.isPending || logContent === null ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={11} className="animate-spin" /> Fetching log…
                </div>
              ) : logContent === '' ? (
                <p className="text-xs text-muted-foreground italic">No log output.</p>
              ) : (
                <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">{logContent}</pre>
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
            theme={dark ? 'vs-dark' : 'vs'}
            onChange={v => setEdits(e => ({ ...e, [activeSection]: v }))}
            onMount={handleMount}
            options={{
              fontSize: 13,
              minimap: { enabled: false },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              glyphMargin: true,
            }}
          />
        </div>
        {showSnippets && (
          <div className="w-72 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
            <SnippetPanel snippets={getSnippets('ti')} onInsert={insertSnippet} />
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
