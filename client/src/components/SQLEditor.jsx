import { useState, useRef, useEffect, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useSQLConnections, useSaveSQLConn, useDeleteSQLConn, useTestSQLConn, useExecuteSQL, useSQLSchema, useSQLQueries, useSaveSQLQuery, useDeleteSQLQuery, usePostToTI, useODBCProcs } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import { Play, Plus, Trash2, ChevronDown, ChevronRight, Database, Settings, X, CheckCircle, AlertCircle, Loader2, Copy, Table, Save, BookOpen, Pencil, Send, Cog, Map } from 'lucide-react'
import { toast } from 'sonner'
import { loadSettings, saveSettings } from '@/lib/formatters/settings.js'

const DRIVERS = [
  { id: 'mssql',  label: 'SQL Server' },
  { id: 'pg',     label: 'PostgreSQL' },
  { id: 'mysql2', label: 'MySQL' },
  { id: 'sqlite', label: 'SQLite' },
]

const EMPTY_CONN = { name: '', driver: 'mssql', server: '', port: '', database: '', auth: 'sql', username: '', password: '', encrypt: false, file: '', dsn: '' }

// ── Connection Form ───────────────────────────────────────────────────────────

function ConnectionForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_CONN, ...initial })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const testConn = useTestSQLConn()

  const handleTest = () => {
    testConn.mutate(form, {
      onSuccess: () => toast.success('Connection successful'),
      onError:   (e) => toast.error(e.message),
    })
  }

  const isSQLite = form.driver === 'sqlite'

  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Name</label>
          <input value={form.name} onChange={e => set('name', e.target.value)}
            className="w-full mt-1 bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Driver</label>
          <select value={form.driver} onChange={e => set('driver', e.target.value)}
            className="w-full mt-1 bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none">
            {DRIVERS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>
        {isSQLite ? (
          <div className="col-span-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">File path</label>
            <input value={form.file} onChange={e => set('file', e.target.value)}
              placeholder="/path/to/database.sqlite"
              className="w-full mt-1 bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
        ) : (<>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Auth</label>
            <select value={form.auth} onChange={e => set('auth', e.target.value)}
              className="w-full mt-1 bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none">
              <option value="sql">SQL Auth</option>
              <option value="windows">Windows Auth</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Server</label>
            <input value={form.server} onChange={e => set('server', e.target.value)}
              placeholder="localhost or host\instance"
              className="w-full mt-1 bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Port</label>
            <input value={form.port} onChange={e => set('port', e.target.value)}
              placeholder={form.driver === 'pg' ? '5432' : form.driver === 'mysql2' ? '3306' : '1433'}
              className="w-full mt-1 bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Database</label>
            <input value={form.database} onChange={e => set('database', e.target.value)}
              className="w-full mt-1 bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          {form.auth !== 'windows' && (<>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Username</label>
              <input value={form.username} onChange={e => set('username', e.target.value)}
                className="w-full mt-1 bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Password</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
                className="w-full mt-1 bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </>)}
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <input type="checkbox" id="encrypt" checked={form.encrypt} onChange={e => set('encrypt', e.target.checked)} className="rounded" />
            <label htmlFor="encrypt" className="text-xs text-muted-foreground">Encrypt connection</label>
          </div>
        </>)}
        <div className="col-span-2">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">TM1 DSN name <span className="normal-case">— for Apply to TI</span></label>
          <input value={form.dsn} onChange={e => set('dsn', e.target.value)}
            placeholder="e.g. TM1_SQLite_Test"
            className="w-full mt-1 bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={handleTest} disabled={testConn.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors">
          {testConn.isPending ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
          Test
        </button>
        <button onClick={() => onSave(form)}
          className="flex-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
          Save
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Schema Tree ───────────────────────────────────────────────────────────────

function SchemaTree({ schema, onInsert }) {
  const [open, setOpen] = useState({})
  const toggle = t => setOpen(o => ({ ...o, [t]: !o[t] }))

  if (!schema?.length) return (
    <div className="px-3 py-4 text-xs text-muted-foreground italic text-center">No schema loaded</div>
  )

  return (
    <div className="text-xs">
      {schema.map(({ table, columns }) => (
        <div key={table}>
          <button onClick={() => toggle(table)}
            className="w-full flex items-center gap-1.5 px-3 py-1 hover:bg-muted/50 text-left group">
            {open[table] ? <ChevronDown size={10} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={10} className="shrink-0 text-muted-foreground" />}
            <Table size={10} className="shrink-0 text-muted-foreground" />
            <span className="font-mono truncate flex-1">{table}</span>
            <span onClick={e => { e.stopPropagation(); onInsert(table) }}
              className="hidden group-hover:inline text-[9px] text-muted-foreground hover:text-foreground px-1 cursor-pointer">
              SELECT
            </span>
          </button>
          {open[table] && (
            <div className="ml-7 border-l border-border/50 pl-2">
              {columns.map(c => (
                <button key={c.name} onClick={() => onInsert(c.name)}
                  className="w-full flex items-center gap-2 px-2 py-0.5 hover:bg-muted/30 text-left">
                  <span className="font-mono flex-1 truncate">{c.name}</span>
                  <span className="text-[9px] text-muted-foreground shrink-0">{c.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Results Grid ──────────────────────────────────────────────────────────────

function ResultsGrid({ result, error, duration }) {
  if (error) return (
    <div className="flex items-start gap-2 p-3 text-red-400">
      <AlertCircle size={14} className="shrink-0 mt-0.5" />
      <pre className="text-xs font-mono whitespace-pre-wrap">{error}</pre>
    </div>
  )
  if (!result) return (
    <div className="flex items-center justify-center h-full text-xs text-muted-foreground italic">
      Run a query to see results
    </div>
  )

  const { columns, rows, rowCount } = result

  const copyCSV = () => {
    const csv = [columns.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
    navigator.clipboard.writeText(csv)
    toast.success('Copied as CSV')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-[10px] text-muted-foreground">
          {rowCount} row{rowCount !== 1 ? 's' : ''}{duration != null ? ` — ${duration}ms` : ''}
        </span>
        <button onClick={copyCSV} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
          <Copy size={10} /> CSV
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {columns.map(c => (
                <th key={c} className="text-left px-3 py-1.5 font-medium text-muted-foreground border-b border-border whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={cn('border-b border-border/50', i % 2 === 0 ? 'bg-background' : 'bg-muted/20')}>
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1 font-mono whitespace-nowrap max-w-xs truncate text-foreground/80">
                    {cell === null ? <span className="text-muted-foreground italic">NULL</span> : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main SQL Editor ───────────────────────────────────────────────────────────

export default function SQLEditor({ tab }) {
  const { dark, themeVersion, server } = useStore()
  const monacoRef    = useRef(null)
  const editorRef    = useRef(null)
  const runQueryRef  = useRef(null)

  const { data: connections = [] } = useSQLConnections()
  const saveConn    = useSaveSQLConn()
  const deleteConn  = useDeleteSQLConn()
  const executeSQL  = useExecuteSQL()

  const [connId, setConnId]       = useState(tab.connectionId ?? null)
  const [sql, setSql]             = useState(tab.sql ?? '-- Write your SQL here\nSELECT 1')
  const [result, setResult]       = useState(null)
  const [queryError, setQueryError] = useState(null)
  const [duration, setDuration]   = useState(null)
  const [showConnForm, setShowConnForm] = useState(false)
  const [editingConn, setEditingConn]   = useState(null)
  const [showSchema, setShowSchema]     = useState(true)
  const [isRunning, setIsRunning]       = useState(false)
  const [showSavedQueries, setShowSavedQueries] = useState(false)
  const [showMinimap, setShowMinimap] = useState(() => loadSettings().editor?.minimap?.sql ?? false)
  const savedQueriesRef = useRef(null)
  const [currentQueryId,   setCurrentQueryId]   = useState(tab.queryId ?? null)
  const [currentQueryName, setCurrentQueryName] = useState(tab.queryId ? (tab.label ?? '') : '')
  const [showSaveInput,    setShowSaveInput]     = useState(false)
  const [saveInputName,    setSaveInputName]     = useState('')
  const [resultHeight,     setResultHeight]      = useState(220)
  const dragRef = useRef(null)
  const [showPostToTI, setShowPostToTI]   = useState(false)
  const [processSearch, setProcessSearch] = useState('')
  const [newProcName, setNewProcName]     = useState('')
  const [showNewProc, setShowNewProc]     = useState(false)
  const [lastPosted, setLastPosted]       = useState(null)
  const postToTIRef = useRef(null)

  const postToTI  = usePostToTI()
  const { openTab } = useStore()
  const { data: processList = [] } = useODBCProcs(server)

  const filteredProcesses = processSearch
    ? processList.filter(n => n.toLowerCase().includes(processSearch.toLowerCase()))
    : processList

  const handlePostToTI = (processName, createNew = false) => {
    postToTI.mutate({ connectionId: connId, sql, server, processName, createNew }, {
      onSuccess: (res) => {
        setLastPosted(processName)
        setShowNewProc(false)
        setNewProcName('')
        toast.success(
          res.paramsAdded.length
            ? `Applied to "${processName}" — ${res.paramsAdded.length} param(s) added`
            : `Applied to "${processName}"`
        )
      },
      onError: (e) => toast.error(e.message),
    })
  }

  const openInTI = (processName) => {
    openTab({ id: `process:${server}:${processName}`, type: 'process', label: processName, server, name: processName, content: null })
    setShowPostToTI(false)
    setLastPosted(null)
  }

  const closePostPanel = () => { setShowPostToTI(false); setLastPosted(null); setShowNewProc(false); setProcessSearch('') }

  useEffect(() => {
    if (!showPostToTI) return
    const handler = (e) => { if (postToTIRef.current && !postToTIRef.current.contains(e.target)) closePostPanel() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPostToTI])
  const [paramValues, setParamValues] = useState({})

  const detectedParams = [...new Set([...sql.matchAll(/\?(\w+)\?/g)].map(m => m[1]))]

  const { data: savedQueries = [] } = useSQLQueries(connId)
  const saveQuery   = useSaveSQLQuery()
  const deleteQuery = useDeleteSQLQuery()

  const toggleMinimap = () => {
    const next = !showMinimap
    setShowMinimap(next)
    editorRef.current?.updateOptions({ minimap: { enabled: next } })
    const s = loadSettings()
    saveSettings({ ...s, editor: { ...s.editor, minimap: { ...(s.editor.minimap ?? {}), sql: next } } })
  }

  const handleSave = () => {
    if (currentQueryId) {
      saveQuery.mutate({ id: currentQueryId, name: currentQueryName, sql, connectionId: connId }, {
        onSuccess: () => toast.success('Saved'),
        onError:   (e) => toast.error(e.message),
      })
    } else {
      setSaveInputName('')
      setShowSaveInput(true)
    }
  }

  const handleSaveAs = () => {
    setSaveInputName(currentQueryName || '')
    setShowSaveInput(true)
  }

  const handleSaveConfirm = () => {
    if (!saveInputName.trim()) return
    saveQuery.mutate({ name: saveInputName.trim(), sql, connectionId: connId }, {
      onSuccess: (res) => {
        setCurrentQueryId(res.id)
        setCurrentQueryName(saveInputName.trim())
        setShowSaveInput(false)
        toast.success('Query saved')
      },
      onError: (e) => toast.error(e.message),
    })
  }

  const startDrag = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = resultHeight
    const onMove = (ev) => setResultHeight(Math.max(80, Math.min(600, startH - (ev.clientY - startY))))
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Close saved-queries dropdown when clicking outside
  useEffect(() => {
    if (!showSavedQueries) return
    const handler = (e) => { if (savedQueriesRef.current && !savedQueriesRef.current.contains(e.target)) setShowSavedQueries(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSavedQueries])

  const { data: schema } = useSQLSchema(connId)

  const activeConn  = connections.find(c => c.id === connId) ?? null
  const canPostToTI = !!(activeConn?.dsn && server)

  useEffect(() => {
    if (monacoRef.current) {
      const base = dark ? 'vs-dark' : 'vs'
      monacoRef.current.editor.setTheme(base)
    }
  }, [dark, themeVersion])

  const runQuery = useCallback(() => {
    if (!connId) { toast.error('Select a connection first'); return }
    const editor = editorRef.current
    const selection = editor?.getSelection()
    const selectedText = (editor && selection && !selection.isEmpty())
      ? editor.getModel()?.getValueInRange(selection)
      : null
    const toRun = (selectedText?.trim() || sql).trim()
    if (!toRun) return
    setIsRunning(true)
    setResult(null)
    setQueryError(null)
    executeSQL.mutate({ connectionId: connId, sql: toRun, params: paramValues }, {
      onSuccess: (res) => { setResult(res); setDuration(res.duration); setIsRunning(false) },
      onError:   (e)  => { setQueryError(e.message); setIsRunning(false) },
    })
  }, [connId, sql, executeSQL])

  // Keep ref current so Ctrl+Enter always calls the latest version
  runQueryRef.current = runQuery

  const handleMount = (editor, monaco) => {
    editorRef.current  = editor
    monacoRef.current  = monaco
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runQueryRef.current?.())
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
  }

  const insertText = (text) => {
    const editor = editorRef.current
    if (!editor) return
    const selection = editor.getSelection()
    editor.executeEdits('schema-insert', [{ range: selection, text: ` ${text}` }])
    editor.focus()
  }

  const handleSaveConn = (form) => {
    saveConn.mutate(form, {
      onSuccess: (res) => {
        setConnId(res.id ?? form.id)
        setShowConnForm(false)
        setEditingConn(null)
        toast.success('Connection saved')
      },
      onError: (e) => toast.error(e.message),
    })
  }

  const handleDeleteConn = (id) => {
    deleteConn.mutate(id, {
      onSuccess: () => { if (connId === id) setConnId(null) },
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 bg-card">
        <Database size={13} className="text-muted-foreground shrink-0" />

        <select
          value={connId ?? ''}
          onChange={e => setConnId(e.target.value || null)}
          className="bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none flex-1 min-w-0 max-w-[200px]"
        >
          <option value="">— Select connection —</option>
          {connections.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({DRIVERS.find(d => d.id === c.driver)?.label ?? c.driver})</option>
          ))}
        </select>

        <button
          onClick={() => { setEditingConn(null); setShowConnForm(v => !v) }}
          className={cn('p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors', showConnForm && !editingConn && 'bg-muted text-foreground')}
          title="Add connection"
        >
          <Plus size={13} />
        </button>

        {activeConn && (
          <>
            <button
              onClick={() => { setEditingConn(activeConn); setShowConnForm(true) }}
              className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
              title="Edit connection"
            >
              <Settings size={13} />
            </button>
            <button
              onClick={() => { if (window.confirm(`Delete "${activeConn.name}"?`)) handleDeleteConn(activeConn.id) }}
              className="p-1.5 rounded text-muted-foreground hover:text-red-400 transition-colors"
              title="Delete connection"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}

        <div className="flex-1" />

        {/* Font zoom + minimap */}
        <div className="flex items-center rounded border border-border overflow-hidden shrink-0">
          <button onClick={() => editorRef.current?.getAction('editor.action.fontZoomOut')?.run()}
            className="px-1.5 py-1 text-[9px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors leading-none"
            title="Decrease font size (Ctrl+-)">A</button>
          <div className="w-px h-3 bg-border" />
          <button onClick={() => editorRef.current?.getAction('editor.action.fontZoomReset')?.run()}
            className="px-1.5 py-1 text-[11px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors leading-none"
            title="Reset font size (Ctrl+0)">A</button>
          <div className="w-px h-3 bg-border" />
          <button onClick={() => editorRef.current?.getAction('editor.action.fontZoomIn')?.run()}
            className="px-1.5 py-1 text-[13px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors leading-none"
            title="Increase font size (Ctrl++)">A</button>
        </div>
        <button
          onClick={toggleMinimap}
          title="Toggle minimap"
          className={cn(
            'flex items-center gap-1 px-2 py-1.5 text-xs rounded border transition-colors',
            showMinimap ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          <Map size={11} />
        </button>

        {/* Save / Save As */}
        {connId && !showSaveInput && (
          <>
            <button onClick={handleSave} disabled={saveQuery.isPending}
              className="flex items-center gap-1 px-2 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={currentQueryId ? `Save "${currentQueryName}"` : 'Save query'}>
              <Save size={11} />
              {currentQueryName && <span className="max-w-[80px] truncate">{currentQueryName}</span>}
            </button>
            {currentQueryId && (
              <button onClick={handleSaveAs} disabled={saveQuery.isPending}
                className="flex items-center gap-1 px-2 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Save as new query">
                <Save size={11} /><span>As…</span>
              </button>
            )}
          </>
        )}
        {connId && showSaveInput && (
          <div className="flex items-center gap-1">
            <input autoFocus value={saveInputName} onChange={e => setSaveInputName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveConfirm(); if (e.key === 'Escape') setShowSaveInput(false) }}
              placeholder="Query name…"
              className="bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring w-36" />
            <button onClick={handleSaveConfirm} disabled={!saveInputName.trim() || saveQuery.isPending}
              className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40">Save</button>
            <button onClick={() => setShowSaveInput(false)} className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted">✕</button>
          </div>
        )}

        {/* Saved queries dropdown */}
        {connId && (
          <div className="relative" ref={savedQueriesRef}>
            <button
              onClick={() => setShowSavedQueries(v => !v)}
              className={cn('flex items-center gap-1 px-2 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors', showSavedQueries && 'bg-muted text-foreground')}
              title="Saved queries"
            >
              <BookOpen size={11} />
              {savedQueries.length > 0 && <span className="text-[9px]">{savedQueries.length}</span>}
            </button>
            {showSavedQueries && (
              <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-card border border-border rounded shadow-lg py-1">
                {savedQueries.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground italic">No saved queries</div>
                ) : (
                  savedQueries.map(q => (
                    <div key={q.id} className="flex items-center gap-1 px-2 py-1 hover:bg-muted group">
                      <button
                        className="flex-1 text-left text-xs truncate"
                        onClick={() => {
                          setSql(q.sql)
                          setCurrentQueryId(q.id)
                          setCurrentQueryName(q.name)
                          setShowSavedQueries(false)
                        }}
                      >
                        {q.name}
                      </button>
                      <button
                        className="hidden group-hover:flex text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        onClick={() => {
                          setSaveInputName(q.name)
                          setCurrentQueryId(q.id)
                          setCurrentQueryName(q.name)
                          setSql(q.sql)
                          setShowSavedQueries(false)
                          setShowSaveInput(true)
                        }}
                        title="Rename"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        className="hidden group-hover:flex text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                        onClick={() => deleteQuery.mutate({ id: q.id, connectionId: connId })}
                        title="Delete"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Post to TI */}
        {canPostToTI && (
          <div className="relative" ref={postToTIRef}>
            <button
              onClick={() => { setShowPostToTI(v => !v); setProcessSearch('') }}
              className={cn('flex items-center gap-1.5 px-2 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors', showPostToTI && 'bg-muted text-foreground')}
              title="Post SQL to TI process datasource"
            >
              <Send size={11} />
              Post to TI
            </button>
            {showPostToTI && (
              <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-card border border-border rounded shadow-lg p-3 space-y-2">

                {/* Header info */}
                <div className="space-y-1">
                  <div className="text-[10px] text-muted-foreground">
                    DSN: <span className="font-mono text-foreground">{activeConn.dsn}</span>
                  </div>
                  {detectedParams.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      Params: <span className="font-mono text-foreground">{detectedParams.join(', ')}</span>
                    </div>
                  )}
                  {result && (
                    <div className="text-[10px] text-muted-foreground">
                      Preview: <span className="text-foreground">{result.rowCount} row{result.rowCount !== 1 ? 's' : ''}</span>
                      <span className="ml-1 font-mono">{result.columns.slice(0, 4).join(', ')}{result.columns.length > 4 ? '…' : ''}</span>
                    </div>
                  )}
                </div>

                {/* Success state */}
                {lastPosted ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs text-foreground">
                      <CheckCircle size={11} className="text-green-500 shrink-0" />
                      Applied to <span className="font-mono">{lastPosted}</span>
                    </div>
                    <button
                      onClick={() => openInTI(lastPosted)}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                    >
                      <Cog size={11} /> Open in TI Editor
                    </button>
                  </div>
                ) : (<>

                  {/* New process */}
                  {showNewProc ? (
                    <div className="flex gap-1.5">
                      <input
                        autoFocus
                        value={newProcName}
                        onChange={e => setNewProcName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && newProcName.trim()) handlePostToTI(newProcName.trim(), true) }}
                        placeholder="Process name…"
                        className="flex-1 bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        onClick={() => { if (newProcName.trim()) handlePostToTI(newProcName.trim(), true) }}
                        disabled={!newProcName.trim() || postToTI.isPending}
                        className="px-2 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
                      >
                        {postToTI.isPending ? <Loader2 size={11} className="animate-spin" /> : 'Create'}
                      </button>
                      <button onClick={() => setShowNewProc(false)} className="px-2 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors">
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowNewProc(true)}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                    >
                      <Plus size={11} /> New process…
                    </button>
                  )}

                  {/* Process search + list */}
                  <input
                    value={processSearch}
                    onChange={e => setProcessSearch(e.target.value)}
                    placeholder="Search existing process…"
                    className="w-full bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="max-h-40 overflow-y-auto space-y-0.5">
                    {filteredProcesses.length === 0 ? (
                      <div className="text-xs text-muted-foreground italic px-1 py-1">No ODBC processes found</div>
                    ) : (
                      filteredProcesses.map(name => (
                        <button
                          key={name}
                          onClick={() => handlePostToTI(name, false)}
                          disabled={postToTI.isPending}
                          className="w-full text-left text-xs font-mono px-2 py-1 rounded hover:bg-muted truncate flex items-center gap-2"
                        >
                          {postToTI.isPending && postToTI.variables?.processName === name
                            ? <Loader2 size={10} className="animate-spin shrink-0" />
                            : <Send size={10} className="shrink-0 text-muted-foreground" />}
                          {name}
                        </button>
                      ))
                    )}
                  </div>
                </>)}
              </div>
            )}
          </div>
        )}

        <button
          onClick={runQuery}
          disabled={isRunning || !connId}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-emerald-700 text-white disabled:opacity-40 hover:bg-emerald-600 transition-colors"
          title="Run (Ctrl+Enter)"
        >
          {isRunning ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          Run
        </button>
      </div>

      {/* ── Connection form ─────────────────────────────────────────────────── */}
      {showConnForm && (
        <div className="border-b border-border bg-card">
          <ConnectionForm
            initial={editingConn ?? EMPTY_CONN}
            onSave={handleSaveConn}
            onCancel={() => { setShowConnForm(false); setEditingConn(null) }}
          />
        </div>
      )}

      {/* ── TM1 Parameter bar ──────────────────────────────────────────────── */}
      {detectedParams.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border bg-muted/40 shrink-0 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">Params</span>
          {detectedParams.map(name => (
            <div key={name} className="flex items-center gap-1.5">
              <label className="text-[10px] font-mono text-muted-foreground shrink-0">{name}</label>
              <input
                value={paramValues[name] ?? ''}
                onChange={e => setParamValues(v => ({ ...v, [name]: e.target.value }))}
                placeholder="value"
                className="w-28 bg-background border border-border rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          ))}
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Schema panel */}
        <div className={cn('flex flex-col border-r border-border shrink-0 transition-all', showSchema ? 'w-52' : 'w-0 overflow-hidden')}>
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Schema</span>
            <button onClick={() => setShowSchema(false)} className="text-muted-foreground hover:text-foreground">
              <X size={10} />
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            <SchemaTree schema={schema} onInsert={insertText} />
          </div>
        </div>

        {!showSchema && (
          <button
            onClick={() => setShowSchema(true)}
            className="flex flex-col items-center justify-center w-5 border-r border-border text-[9px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors shrink-0"
            title="Show schema"
          >
            <Database size={10} />
          </button>
        )}

        {/* Editor + Results */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="flex-1 min-h-0" style={{ minHeight: '120px' }}>
            <MonacoEditor
              height="100%"
              language="sql"
              value={sql}
              theme={dark ? 'vs-dark' : 'vs'}
              onChange={v => setSql(v ?? '')}
              onMount={handleMount}
              options={{
                fontSize: 13,
                minimap: { enabled: showMinimap },
                scrollBeyondLastLine: false,
                fixedOverflowWidgets: true,
                wordWrap: 'off',
                lineNumbers: 'on',
                folding: true,
                suggestOnTriggerCharacters: true,
              }}
            />
          </div>

          {/* Drag handle */}
          <div
            onMouseDown={startDrag}
            className="h-1.5 shrink-0 border-t border-border cursor-row-resize hover:bg-primary/20 transition-colors flex items-center justify-center group"
          >
            <div className="w-8 h-0.5 rounded bg-border group-hover:bg-primary/40 transition-colors" />
          </div>

          {/* Results */}
          <div className="flex flex-col border-border overflow-hidden" style={{ height: `${resultHeight}px` }}>
            <ResultsGrid result={result} error={queryError} duration={duration} />
          </div>
        </div>
      </div>
    </div>
  )
}
