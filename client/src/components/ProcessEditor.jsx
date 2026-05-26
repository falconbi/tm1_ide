import { useState, useRef, useEffect } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useProcess, useSaveProcess, useRunProcess, useCubes, useViews } from '@/hooks/useApi'
import { registerTM1Completions, registerTM1Theme } from '@/lib/tm1-functions'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ChevronRight, ChevronDown, Play, X, Braces, Wand2, CheckCircle2, XCircle, Database } from 'lucide-react'
import { getSnippets } from '@/lib/tm1-snippets.js'
import SnippetPanel from '@/components/SnippetPanel'
import PatternDialog from '@/components/PatternDialog'

const CODE_TABS = [
  { key: 'PrologProcedure',    label: 'Prolog'   },
  { key: 'MetaDataProcedure',  label: 'Metadata' },
  { key: 'DataProcedure',      label: 'Data'     },
  { key: 'EpilogProcedure',    label: 'Epilog'   },
]

const PARAM_TYPE = { 1: 'Numeric', 2: 'String' }

function ParamsPanel({ params }) {
  if (!params?.length) return (
    <div className="px-4 py-3 text-xs text-muted-foreground">No parameters</div>
  )
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted text-muted-foreground">
            <th className="text-left px-3 py-1.5">Name</th>
            <th className="text-left px-3 py-1.5">Type</th>
            <th className="text-left px-3 py-1.5">Default</th>
            <th className="text-left px-3 py-1.5">Prompt</th>
          </tr>
        </thead>
        <tbody>
          {params.map(p => (
            <tr key={p.Name} className="border-b border-border hover:bg-muted/50">
              <td className="px-3 py-1.5 font-mono">{p.Name}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{PARAM_TYPE[p.Type] ?? p.Type}</td>
              <td className="px-3 py-1.5 font-mono">{String(p.Value ?? '')}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{p.Prompt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const DS_TYPE_BADGE = {
  ASCII:                'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ODBC:                 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  TM1CubeView:          'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  TM1DimensionSubset:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  None:                 'bg-muted text-muted-foreground',
}

function buildDsRows(ds) {
  const { Type, password, dataSourceNameForClient, dataSourceNameForServer, ...rest } = ds

  const rows = []

  if (Type === 'TM1CubeView' || Type === 'TM1DimensionSubset') {
    rows.push(['Cube', dataSourceNameForServer ?? dataSourceNameForClient ?? ''])
    if (rest.view)   rows.push(['View',   rest.view])
    if (rest.subset) rows.push(['Subset', rest.subset])
    return rows
  }

  if (Type === 'ODBC') {
    const dsn = dataSourceNameForServer ?? dataSourceNameForClient ?? ''
    rows.push(['DSN', dsn])
    if (rest.query)    rows.push(['SQL query', rest.query])
    if (rest.userName) rows.push(['Username',  rest.userName])
    if (rest.usesUnicode !== undefined) rows.push(['Unicode', String(rest.usesUnicode)])
    return rows
  }

  // ASCII / default: show file path once if client == server, else show both
  if (dataSourceNameForServer && dataSourceNameForServer === dataSourceNameForClient) {
    rows.push(['File path', dataSourceNameForServer])
  } else {
    if (dataSourceNameForServer) rows.push(['File (server)', dataSourceNameForServer])
    if (dataSourceNameForClient) rows.push(['File (client)', dataSourceNameForClient])
  }

  const ASCII_LABELS = {
    asciiDelimiterType:    'Delimiter type',
    asciiDelimiterChar:    'Delimiter char',
    asciiDecimalSeparator: 'Decimal separator',
    asciiThousandSeparator:'Thousand separator',
    asciiQuoteCharacter:   'Quote char',
    asciiHeaderRecords:    'Header rows',
  }
  for (const [k, label] of Object.entries(ASCII_LABELS)) {
    if (rest[k] !== undefined) rows.push([label, String(rest[k])])
  }
  return rows
}

function DatasourcePanel({ ds }) {
  if (!ds || ds.Type === 'None') return (
    <div className="px-4 py-3 text-xs text-muted-foreground">No datasource configured</div>
  )
  const rows = buildDsRows(ds)
  return (
    <div className="px-3 py-2 space-y-2">
      <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full inline-block', DS_TYPE_BADGE[ds.Type] ?? DS_TYPE_BADGE.None)}>
        {ds.Type}
      </span>
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-border last:border-0">
              <td className="py-1 pr-4 text-muted-foreground w-36 shrink-0">{label}</td>
              <td className="py-1 font-mono text-foreground break-all">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

function RunDialog({ params, onRun, onClose, isPending }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries((params ?? []).map(p => [p.Name, String(p.Value ?? '')]))
  )

  const set = (name, val) => setValues(v => ({ ...v, [name]: val }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Run Process</span>
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

export default function ProcessEditor({ tab }) {
  const { server, dark, themeVersion, updateTabContent, markTabSaved, clearScrollTo } = useStore()
  const { data, isLoading } = useProcess(tab.server, tab.name)
  const saveProcess = useSaveProcess()
  const runProcess  = useRunProcess()
  const registeredRef = useRef(false)

  const SECTION_TO_KEY = { Prolog: 'PrologProcedure', Metadata: 'MetaDataProcedure', Data: 'DataProcedure', Epilog: 'EpilogProcedure' }

  const [activeSection, setActiveSection] = useState('PrologProcedure')
  const [showRun, setShowRun] = useState(false)
  const [showDsInsert, setShowDsInsert] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [showPatterns, setShowPatterns] = useState(false)
  const [runOutput, setRunOutput] = useState(null)
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const pendingLineRef = useRef(null)

  // Local edits keyed by section
  const [edits, setEdits] = useState({})

  useEffect(() => {
    if (data) updateTabContent(tab.id, data)
  }, [data])

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

  const handleRun = (values) => {
    setRunOutput(null)
    const id = toast.loading('Running process…')
    runProcess.mutate(
      { server: tab.server, name: tab.name, params: values },
      {
        onSuccess: (res) => {
          setShowRun(false)
          toast.success('Process completed', { id })
          setRunOutput({ status: 'ok', duration: res?.duration ?? null })
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
    const id = toast.loading('Saving process…')
    saveProcess.mutate(
      { server: tab.server, name: tab.name, body },
      {
        onSuccess: () => { markTabSaved(tab.id); toast.success('Process saved', { id }) },
        onError:   (e) => toast.error(e.message, { id }),
      },
    )
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

  if (isLoading && !data) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading process…</div>
  }

  const value = edits[activeSection] ?? data?.[activeSection] ?? ''

  return (
    <div className="flex flex-col h-full">

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
            onClick={() => setShowSnippets(s => !s)}
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
            onClick={() => setShowRun(true)}
            disabled={!data}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-green-600 text-white disabled:opacity-40 hover:bg-green-700 transition-colors"
          >
            <Play size={11} />
            Run
          </button>
          <button
            onClick={handleSave}
            disabled={!Object.keys(edits).length || saveProcess.isPending}
            className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {saveProcess.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Collapsible metadata sections ─────────────────────────────── */}
      {data?.DataSource?.Type && data.DataSource.Type !== 'None' && (
        <CollapsibleSection
          label="Datasource"
          hint={(() => {
            const ds = data.DataSource
            const name = ds.dataSourceNameForServer ?? ds.dataSourceNameForClient ?? ''
            return `${ds.Type}  ·  ${name}`
          })()}
        >
          <DatasourcePanel ds={data.DataSource} />
        </CollapsibleSection>
      )}

      {data?.Variables?.length > 0 && (
        <CollapsibleSection label="Variables" hint={`${data.Variables.length} column${data.Variables.length !== 1 ? 's' : ''}`}>
          <VariablesPanel variables={data.Variables} />
        </CollapsibleSection>
      )}

      {data?.Parameters?.length > 0 && (
        <CollapsibleSection label="Parameters" hint={`${data.Parameters.length} parameter${data.Parameters.length !== 1 ? 's' : ''}`}>
          <ParamsPanel params={data.Parameters} />
        </CollapsibleSection>
      )}

      {/* ── Run output panel ──────────────────────────────────────────── */}
      {runOutput && (
        <div className={cn(
          'shrink-0 border-t border-border flex items-center gap-3 px-4 py-2 text-xs',
          runOutput.status === 'error' ? 'bg-red-950/20' : 'bg-green-950/10'
        )}>
          {runOutput.status === 'ok' ? (
            <>
              <CheckCircle2 size={13} className="text-green-500 shrink-0" />
              <span className="text-green-400">
                Completed successfully{runOutput.duration != null ? ` — ${runOutput.duration}ms` : ''}
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
          <button
            onClick={() => setRunOutput(null)}
            className="shrink-0 ml-auto text-muted-foreground hover:text-foreground"
          >
            <X size={11} />
          </button>
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
            }}
          />
        </div>
        {showSnippets && (
          <div className="w-72 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
            <SnippetPanel snippets={getSnippets('ti')} onInsert={insertSnippet} />
          </div>
        )}
      </div>

    </div>
  )
}
