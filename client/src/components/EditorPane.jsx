import { useEffect, useRef, useState, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useRules, useSaveRules, useLineage, useLineageConsumers, useTraceCellCalc, useConflictCheck } from '@/hooks/useApi'
import { registerTM1Completions, registerTM1Theme } from '@/lib/tm1-functions'
import ProcessEditor from '@/components/ProcessEditor'
import SQLEditor from '@/components/SQLEditor'
import HierarchyGridTest from '@/components/HierarchyGridTest'
import SubsetEditor from '@/components/SubsetEditor'
import DimensionEditor from '@/components/DimensionEditor'
import ViewEditor from '@/components/ViewEditor'
import ChoreEditor from '@/components/ChoreEditor'
import GuidedMDXBuilder from '@/components/GuidedMDXBuilder'
import CubeEditor from '@/components/CubeEditor'
import { toast } from 'sonner'
import { GitBranch, ChevronRight, ChevronDown, Loader2, ChevronsUpDown, ChevronsDownUp, ListTree, AlignLeft, Settings, Locate, Braces, Save, Map, Microscope, X, Plus, Trash2, History, ShieldCheck, Rss } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadSettings, saveSettings } from '@/lib/formatters/settings.js'
import { formatRules } from '@/lib/formatters/rules-formatter.js'
import { getNamingMap } from '@/lib/formatters/naming.js'
import { validateRulesSyntax } from '@/lib/rules-validator'
import { registerRulesCompletions } from '@/lib/tm1-completion'
import { getSnippets } from '@/lib/tm1-snippets.js'
import SnippetPanel from '@/components/SnippetPanel'
import TransactionLogPanel from '@/components/TransactionLogPanel'
import ObjectHistoryPanel from '@/components/ObjectHistoryPanel'
import DiffTab from '@/components/DiffTab'
import DeployPanel from '@/components/DeployPanel'
import DeployHistory from '@/components/DeployHistory'
import SessionReportTab from '@/components/SessionReportTab'
import { ConflictBanner, ConflictSaveWarning } from '@/components/ConflictBanner'

// ── Lineage panel ─────────────────────────────────────────────────────────────

function TreeNode({ cube, tree, depth, onOpen, visited = new Set() }) {
  const [open, setOpen] = useState(depth < 2)
  const node = tree[cube]
  if (!node) return null
  const sources = node.sources ?? []
  const cycle = visited.has(cube)
  const nextVisited = new Set(visited).add(cube)

  return (
    <div className={cn('text-xs', depth > 0 && 'ml-4 border-l border-border pl-2')}>
      <div className="flex items-center gap-1 py-0.5 group">
        {sources.length > 0 && !cycle ? (
          <button onClick={() => setOpen(o => !o)} className="shrink-0 text-muted-foreground">
            {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : <span className="w-3 shrink-0" />}
        <button
          onClick={() => onOpen(cube)}
          className="font-mono hover:text-primary truncate text-left"
          title={cube}
        >
          {cube}
        </button>
        {cycle && <span className="text-muted-foreground/50 text-[10px]">(cycle)</span>}
        {node.error && <span className="text-red-400 text-[10px]">(error)</span>}
        {!node.hasRules && !cycle && <span className="text-muted-foreground/50 text-[10px]">no rules</span>}
      </div>
      {open && !cycle && sources.map(s => (
        <TreeNode key={s} cube={s} tree={tree} depth={depth + 1} onOpen={onOpen} visited={nextVisited} />
      ))}
    </div>
  )
}

function LineagePanel({ server, cube, onOpen }) {
  const [mode, setMode] = useState('sources')
  const { data: srcData, isFetching: srcFetching }   = useLineage(server, cube, mode === 'sources')
  const { data: conData, isFetching: conFetching }   = useLineageConsumers(server, cube, mode === 'consumers')

  const fetching = mode === 'sources' ? srcFetching : conFetching

  return (
    <div className="w-64 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lineage</span>
        {fetching && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
      </div>

      <div className="flex px-2 py-1.5 gap-1 border-b border-border shrink-0">
        {['sources', 'consumers'].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn('flex-1 py-0.5 text-xs rounded capitalize',
              mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-2 py-2">
        {mode === 'sources' && srcData && (
          <TreeNode cube={srcData.root} tree={srcData.tree} depth={0} onOpen={onOpen} />
        )}
        {mode === 'consumers' && conData && (
          conData.consumers.length === 0
            ? <p className="text-xs text-muted-foreground px-1">No cubes reference this cube.</p>
            : conData.consumers.map(c => (
                <button key={c} onClick={() => onOpen(c)}
                  className="flex items-center w-full px-1 py-0.5 text-xs font-mono hover:text-primary text-left truncate">
                  {c}
                </button>
              ))
        )}
        {!srcData && !conData && !fetching && (
          <p className="text-xs text-muted-foreground px-1">Loading…</p>
        )}
      </div>
    </div>
  )
}

// ── Cell Trace Panel ──────────────────────────────────────────────────────────

function TraceNode({ node, depth = 0, onShowHistory }) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.Components?.length > 0
  const isRule  = node.Type === 'Rule'
  const isFeed  = node.Type === 'Feeders'
  const isConst = node.Type === 'Constant'
  const isLeaf  = !hasChildren && node.Tuple?.length > 0

  const typeColor = isRule  ? 'text-emerald-400'
                 : isFeed  ? 'text-amber-400'
                 : isConst ? 'text-blue-400'
                 : 'text-muted-foreground'

  const tuple    = (node.Tuple ?? []).map(m => m.Name ?? m.UniqueName ?? '').join(', ')
  const cubeName = node.Cube?.Name ?? ''

  return (
    <div className={cn('text-xs', depth > 0 && 'ml-4 border-l border-border pl-2 mt-0.5')}>
      <div className="flex items-start gap-1.5 py-0.5 group">
        {hasChildren ? (
          <button onClick={() => setOpen(o => !o)} className="shrink-0 mt-0.5 text-muted-foreground">
            {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : <span className="w-3 shrink-0" />}
        <div className="flex-1 min-w-0">
          <span className={cn('font-semibold', typeColor)}>{node.Type ?? '?'}</span>
          {cubeName && <span className="ml-1.5 text-muted-foreground">← {cubeName}</span>}
          {tuple    && <span className="ml-1.5 text-foreground/60 truncate block font-mono">[{tuple}]</span>}
          {node.Statements?.length > 0 && (
            <div className="mt-0.5 space-y-px">
              {node.Statements.map((s, i) => (
                <div key={i} className="font-mono text-[10px] text-foreground/70 bg-muted/30 px-1.5 py-px rounded truncate" title={s}>{s}</div>
              ))}
            </div>
          )}
          <span className="font-mono text-foreground font-bold">{node.Value ?? ''}</span>
        </div>
        {isLeaf && onShowHistory && (
          <button
            onClick={() => onShowHistory(node.Cube?.Name, node.Tuple)}
            title="Show transaction history for this cell"
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-muted-foreground hover:text-blue-400"
          >
            <History size={10} />
          </button>
        )}
      </div>
      {open && hasChildren && node.Components.map((c, i) => (
        <TraceNode key={i} node={c} depth={depth + 1} onShowHistory={onShowHistory} />
      ))}
    </div>
  )
}

function CellTracePanel({ server, cube, cubeDims, onClose }) {
  const [rows, setRows] = useState(() => (cubeDims ?? []).map(d => ({ dim: d, element: '' })))
  const trace = useTraceCellCalc()
  const { openTab } = useStore()

  const setElement = (i, val) => setRows(r => r.map((row, j) => j === i ? { ...row, element: val } : row))

  const run = () => {
    const pairs = rows.map(r => ({ dim: r.dim, element: r.element.trim() }))
    if (pairs.some(p => !p.element)) return
    trace.mutate({ server, cube, dimElemPairs: pairs })
  }

  const handleShowHistory = (srcCube, tuple) => {
    const tgtCube = srcCube || cube
    const elements = tuple?.map(m => m.Name ?? m.UniqueName ?? '') ?? []
    openTab({
      id:       `txlog:${server}:${tgtCube}:${elements.join(':')}:${Date.now()}`,
      type:     'transactionlog',
      label:    `Log — ${tgtCube}`,
      server,
      cube:     tgtCube,
      elements,
    })
  }

  return (
    <div className="w-80 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <Microscope size={11} className="text-emerald-400" />
          Trace Cell
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
      </div>

      {/* Tuple inputs */}
      <div className="px-3 py-2 space-y-1.5 border-b border-border shrink-0">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Tuple — {cube}</div>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground w-24 truncate shrink-0" title={row.dim}>{row.dim}</span>
            <input
              value={row.element}
              onChange={e => setElement(i, e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run()}
              placeholder="element…"
              className="flex-1 min-w-0 bg-muted border border-border rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:border-primary"
            />
          </div>
        ))}
        <button
          onClick={run}
          disabled={trace.isPending || rows.some(r => !r.element.trim())}
          className="w-full mt-1 flex items-center justify-center gap-1.5 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors"
        >
          {trace.isPending ? <Loader2 size={11} className="animate-spin" /> : <Microscope size={11} />}
          Trace
        </button>
      </div>

      {/* Result */}
      <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
        {trace.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={11} className="animate-spin" /> Tracing…
          </div>
        )}
        {trace.isError && (
          <p className="text-xs text-red-400">{trace.error?.message ?? 'Trace failed'}</p>
        )}
        {trace.data && !trace.isPending && (
          <TraceNode node={trace.data} depth={0} onShowHistory={handleShowHistory} />
        )}
        {!trace.data && !trace.isPending && !trace.isError && (
          <p className="text-xs text-muted-foreground italic">Enter a tuple and click Trace to see how this cell is calculated.</p>
        )}
      </div>
    </div>
  )
}

// ── Rules editor ─────────────────────────────────────────────────────────────

function RulesEditor({ tab, onCursor }) {
  const { initTabContent, updateTabContent, markTabSaved, clearScrollTo, openTab, server, dark, themeVersion, setFormatSettingsOpen, setRevealTarget, bumpRulesVersion } = useStore()
  const { data, isLoading } = useRules(tab.server, tab.cube)
  const saveRules = useSaveRules()
  const registeredRef = useRef(false)
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const formatPopupRef = useRef(null)
  const [showLineage, setShowLineage] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [showMinimap, setShowMinimap] = useState(() => loadSettings().editor?.minimap?.rules ?? false)
  const [showTrace, setShowTrace] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [cubeDims, setCubeDims] = useState(null)
  const [dismissedId, setDismissedId] = useState(null)
  const [saveConflict, setSaveConflict] = useState(null)
  const { openConflict, checkBeforeSave } = useConflictCheck(tab.server, 'rules', tab.cube)

  useEffect(() => {
    if (!showTrace || cubeDims !== null) return
    fetch(`/api/cube/dimensions?server=${encodeURIComponent(tab.server)}&cube=${encodeURIComponent(tab.cube)}`)
      .then(r => r.json()).then(d => setCubeDims(Array.isArray(d) ? d : []))
      .catch(() => setCubeDims([]))
  }, [showTrace])
  const [regionsCollapsed, setRegionsCollapsed] = useState(false)
  const [showRegionMenu, setShowRegionMenu] = useState(false)
  const [showFormatPopup, setShowFormatPopup] = useState(false)
  const [formatStruct, setFormatStruct] = useState(() => loadSettings().rules.expressionFormatter ?? null)
  const [checking, setChecking]             = useState(false)
  const [checkResult, setCheckResult]       = useState(null) // null | 'pass' | 'fail'
  const [checkingFeeders, setCheckingFeeders] = useState(false)

  const openCube = useCallback((cube) => {
    openTab({ id: `rules:${tab.server}:${cube}`, type: 'rules', label: cube, server: tab.server, cube, content: null })
  }, [tab.server])

  const content = tab.content ?? data?.rules ?? ''

  useEffect(() => {
    if (data?.rules != null && !tab.dirty) {
      initTabContent(tab.id, data.rules)
    }
  }, [data])

  // Validation: static analysis + TM1 CheckRules API
  const runCheck = useCallback(async () => {
    const model = editorRef.current?.getModel()
    if (!model || !monacoRef.current) return
    setChecking(true)
    try {
      const staticErrors = validateRulesSyntax(content)
      let tm1Errors = []
      try {
        const r = await fetch('/api/rules/check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ide-token': localStorage.getItem('tm1-token') ?? '',
          },
          body: JSON.stringify({ server: tab.server, cube: tab.cube, rules: content }),
        })
        const d = await r.json()
        tm1Errors = d.errors ?? []
      } catch { /* TM1 check failed — static errors still shown */ }
      const markers = [
        ...tm1Errors.map(e => ({
          severity: monacoRef.current.MarkerSeverity.Error,
          message:  e.Message,
          startLineNumber: e.LineNumber,
          startColumn: 1,
          endLineNumber: e.LineNumber,
          endColumn: model.getLineMaxColumn(e.LineNumber),
        })),
        ...staticErrors.map(e => ({
          severity: monacoRef.current.MarkerSeverity.Error,
          message: e.message,
          startLineNumber: e.line,
          startColumn: 1,
          endLineNumber: e.line,
          endColumn: model.getLineMaxColumn(e.line),
        })),
      ]
      monacoRef.current.editor.setModelMarkers(model, 'rules-check', markers)
      setCheckResult(markers.length === 0 ? 'pass' : 'fail')
    } finally {
      setChecking(false)
    }
  }, [content, tab.server, tab.cube])

  // Live validation — debounced 800ms after last keystroke
  useEffect(() => {
    if (!content || !editorRef.current || !monacoRef.current) return
    setCheckResult(null)
    const timer = setTimeout(runCheck, 800)
    return () => clearTimeout(timer)
  }, [content, tab.server, tab.cube, runCheck])

  useEffect(() => {
    if (tab.scrollToLine && editorRef.current) {
      editorRef.current.revealLineInCenter(tab.scrollToLine)
      editorRef.current.setPosition({ lineNumber: tab.scrollToLine, column: 1 })
      clearScrollTo(tab.id)
    }
  }, [tab.scrollToLine])

  // Close region menu on click outside
  useEffect(() => {
    if (!showRegionMenu) return
    const handler = (e) => {
      if (!e.target.closest('.region-menu-container')) setShowRegionMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showRegionMenu])

  // Close format popup on click outside
  useEffect(() => {
    if (!showFormatPopup) return
    const handler = (e) => {
      if (formatPopupRef.current && !formatPopupRef.current.contains(e.target)) setShowFormatPopup(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showFormatPopup])

  const runFormat = () => {
    const s = loadSettings()
    saveSettings({ ...s, rules: { ...s.rules, expressionFormatter: formatStruct } })
    const editor = editorRef.current
    if (!editor) { setShowFormatPopup(false); return }
    const selection = editor.getSelection()
    if (selection && !selection.isEmpty()) {
      const model = editor.getModel()
      const selectedText = model.getValueInRange(selection)
      const { map: namingMap } = getNamingMap()
      const formatted = formatRules(selectedText, s.rules, namingMap)
      editor.executeEdits('format-selection', [{ range: selection, text: formatted }])
      editor.setSelection(selection)
    } else {
      editor.getAction('editor.action.formatDocument').run()
    }
    setShowFormatPopup(false)
  }

  useEffect(() => {
    if (monacoRef.current) registerTM1Theme(monacoRef.current, dark)
  }, [dark, themeVersion])

  const doSave = () => {
    const editor = editorRef.current
    if (!editor) return
    const id = toast.loading('Saving rules…')
    saveRules.mutate(
      { server: tab.server, cube: tab.cube, rules: editor.getValue() },
      {
        onSuccess: () => {
          markTabSaved(tab.id)
          bumpRulesVersion(tab.server, tab.cube)
          toast.success('Rules saved', { id })
          // Non-blocking reference integrity check — warnings shown after save
          const token = localStorage.getItem('tm1-token') ?? ''
          fetch('/api/cube/rules/check-references', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-ide-token': token },
            body: JSON.stringify({ server: tab.server, cube: tab.cube, rules: editor.getValue() }),
          })
            .then(r => r.json())
            .then(d => {
              if (d.warnings?.length) {
                d.warnings.forEach(w => toast.warning(w.message, { duration: 8000 }))
              }
            })
            .catch(() => {})
        },
        onError:   (err) => toast.error(err.message, { id }),
      },
    )
  }

  const handleSave = async () => {
    const conflict = await checkBeforeSave()
    if (conflict) { setSaveConflict(conflict); return }
    doSave()
  }

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    if (!registeredRef.current) {
      registerTM1Completions(monaco, () => server)
      registerRulesCompletions(monaco, () => tab.server ?? server)
      registerTM1Theme(monaco, dark)
      registeredRef.current = true
    }
    editor.onDidChangeCursorPosition(e => {
      onCursor({ line: e.position.lineNumber, col: e.position.column })
    })

    // Prevent browser's Ctrl+S "Save Page" dialog and trigger save instead
    const keyDownDisposable = editor.onKeyDown(e => {
      if (e.keyCode === monaco.KeyCode.KeyS && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.browserEvent.preventDefault()
        e.browserEvent.stopPropagation()
        handleSave()
      }
      if (e.keyCode === monaco.KeyCode.KeyF && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.browserEvent.preventDefault()
        e.browserEvent.stopPropagation()
        editor.getAction('editor.action.formatDocument').run()
      }
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
    if (tab.scrollToLine) {
      editor.revealLineInCenter(tab.scrollToLine)
      editor.setPosition({ lineNumber: tab.scrollToLine, column: 1 })
      clearScrollTo(tab.id)
    }
  }

  const toggleRegions = () => {
    const editor = editorRef.current
    if (!editor) return
    if (regionsCollapsed) {
      editor.trigger('fold', 'editor.unfoldAll')
      setRegionsCollapsed(false)
    } else {
      editor.trigger('fold', 'editor.foldAll')
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
      const match = text.match(/^#Region\s+(.*)$/i)
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

  const insertSnippet = (code) => {
    const editor = editorRef.current
    if (!editor) return
    const sel = editor.getSelection()
    editor.executeEdits('snippet', [{ range: sel, text: code }])
    editor.focus()
  }

  const toggleMinimap = () => {
    const next = !showMinimap
    setShowMinimap(next)
    editorRef.current?.updateOptions({ minimap: { enabled: next } })
    const s = loadSettings()
    saveSettings({ ...s, editor: { ...s.editor, minimap: { ...(s.editor.minimap ?? {}), rules: next } } })
  }

  if (isLoading && tab.content === null) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading rules…</div>
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ConflictBanner conflict={openConflict?.id !== dismissedId ? openConflict : null} onDismiss={() => setDismissedId(openConflict?.id)} />
      <ConflictSaveWarning conflict={saveConflict} onSaveAnyway={() => { setSaveConflict(null); doSave() }} onCancel={() => setSaveConflict(null)} />
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border bg-muted/30 shrink-0">
        <span className="text-xs font-mono font-semibold text-foreground">{tab.cube}</span>
        <button
          onClick={() => setRevealTarget({ type: 'rules', server: tab.server, cube: tab.cube })}
          className="flex items-center text-amber-400 hover:text-amber-300 transition-colors"
          title="Show in tree"
        >
          <Locate size={11} />
        </button>
        <span className="text-xs text-muted-foreground">Rules</span>
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-hidden relative">
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
          <button
            onClick={() => setShowHistory(v => !v)}
            title="Object history"
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border bg-background/80 transition-colors',
              showHistory ? 'border-primary text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <History size={11} />
          </button>
          <button
            onClick={handleSave}
            disabled={!tab.dirty || saveRules.isPending}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
              tab.dirty
                ? 'bg-primary text-primary-foreground border-primary hover:opacity-90'
                : 'bg-background/80 border-border text-muted-foreground opacity-40'
            )}
            title="Save (Ctrl+S)"
          >
            {saveRules.isPending ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            Save
          </button>
          <button
            onClick={runCheck}
            disabled={checking}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-all disabled:opacity-40',
              checkResult === 'pass' && 'border-emerald-500 text-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.4)]',
              checkResult === 'fail' && 'border-red-500 text-red-400 shadow-[0_0_8px_2px_rgba(239,68,68,0.4)]',
              !checkResult && 'bg-background/80 border-border text-muted-foreground hover:text-foreground',
            )}
            title="Run CheckRules + static analysis now"
          >
            {checking ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
            Check
          </button>
          <button
            onClick={async () => {
              setCheckingFeeders(true)
              try {
                const token = localStorage.getItem('tm1-token') ?? ''
                const r = await fetch('/api/cube/check-feeders-for-rules', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-ide-token': token },
                  body: JSON.stringify({ server: tab.server, cube: tab.cube }),
                })
                const d = await r.json()
                d.error ? toast.error(`Feeder check failed: ${d.error}`) : toast.success('Feeder check complete — open a view to see highlighted zero cells')
              } catch { toast.error('Feeder check failed') }
              finally { setCheckingFeeders(false) }
            }}
            disabled={checkingFeeders}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs border bg-background/80 border-border text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            title="CheckFeedersForRules — recalculates feeder propagation for this cube. Open a view after to see zero rule cells highlighted amber."
          >
            {checkingFeeders ? <Loader2 size={11} className="animate-spin" /> : <Rss size={11} />}
            Feeders
          </button>
          <div ref={formatPopupRef} className="relative format-popup-container">
            <button
              onClick={() => setShowFormatPopup(v => !v)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs border bg-background/80 transition-colors',
                showFormatPopup ? 'border-primary text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
              )}
              title="Format Document (Ctrl+Shift+F)"
            >
              <AlignLeft size={11} />
              Format
            </button>
            {showFormatPopup && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Structure</div>
                <div className="flex flex-col gap-1 mb-3">
                  {[
                    { id: null,             label: 'No Change',      desc: 'Keep existing line breaks' },
                    { id: 'tm1-verbose',    label: 'TM1 Verbose',    desc: 'Each string arg on its own line' },
                    { id: 'tm1-structured', label: 'TM1 Structured', desc: 'Group consecutive string args' },
                  ].map(opt => (
                    <button
                      key={opt.id ?? 'none'}
                      onClick={() => setFormatStruct(opt.id)}
                      className={cn(
                        'flex flex-col items-start px-2 py-1.5 rounded border text-left transition-colors',
                        formatStruct === opt.id
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                      )}
                    >
                      <span className="text-xs font-medium">{opt.label}</span>
                      <span className="text-[10px] opacity-70">{opt.desc}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={runFormat}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    <AlignLeft size={11} /> Format
                  </button>
                  <button
                    onClick={() => { setShowFormatPopup(false); setFormatSettingsOpen(true) }}
                    className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Format Settings"
                  >
                    <Settings size={11} />
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="relative region-menu-container">
            <button
              onClick={() => setShowRegionMenu(v => !v)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
                showRegionMenu ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
              )}
              title="Go to region"
            >
              <ListTree size={11} />
              Regions
            </button>
            {showRegionMenu && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded shadow-lg z-50 max-h-64 overflow-auto text-xs">
                {getRegions().length === 0 ? (
                  <div className="px-3 py-1.5 text-muted-foreground italic">No regions found</div>
                ) : (
                  getRegions().map(r => (
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
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
              regionsCollapsed ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
            )}
            title={regionsCollapsed ? 'Expand all regions' : 'Collapse all regions'}
          >
            {regionsCollapsed ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
            {regionsCollapsed ? 'Expand' : 'Collapse'}
          </button>
          <button
            onClick={() => setShowSnippets(s => !s)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
              showSnippets ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
            )}
            title="Toggle snippets panel"
          >
            <Braces size={11} />
            Snippets
          </button>
          <button
            onClick={() => setShowTrace(s => !s)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
              showTrace ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
            )}
            title="Trace cell calculation"
          >
            <Microscope size={11} />
            Trace
          </button>
          <div className="flex items-center rounded border border-border overflow-hidden bg-background/80 shrink-0">
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
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
              showMinimap ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
            )}
            title="Toggle minimap"
          >
            <Map size={11} />
            Minimap
          </button>
          <button
            onClick={() => setShowLineage(s => !s)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
              showLineage ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
            )}
            title="Toggle lineage trace"
          >
            <GitBranch size={11} />
            Lineage
          </button>
        </div>
        <MonacoEditor
          height="100%"
          language="tm1rules"
          value={content}
          theme="tm1-custom"
          beforeMount={monaco => registerTM1Theme(monaco, dark)}
          onChange={v => updateTabContent(tab.id, v)}
          onMount={handleMount}
          options={{ fontSize: 13, minimap: { enabled: showMinimap }, wordWrap: 'on', scrollBeyondLastLine: false, fixedOverflowWidgets: true, folding: true, foldingStrategy: 'auto', glyphMargin: true }}
        />
        {showHistory && (
          <ObjectHistoryPanel
            server={tab.server}
            objectType="rules"
            objectName={tab.cube}
            onClose={() => setShowHistory(false)}
          />
        )}
      </div>
      {showSnippets && (
        <div className="w-72 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
          <SnippetPanel snippets={getSnippets('rules')} language="rules" onInsert={insertSnippet} />
        </div>
      )}
      {showTrace && (
        <CellTracePanel
          server={tab.server}
          cube={tab.cube}
          cubeDims={cubeDims}
          onClose={() => setShowTrace(false)}
        />
      )}
      {showLineage && (
        <LineagePanel server={tab.server} cube={tab.cube} onOpen={openCube} />
      )}
      </div>
    </div>
  )
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * @param {import('@/store').Tab} tab
 * @returns {import('@/store').RevealTarget|null}
 */
function getRevealTarget(tab) {
  if (!tab) return null
  if (tab.type === 'rules')     return { type: 'rules',     server: tab.server, cube: tab.cube }
  if (tab.type === 'process')   return { type: 'process',   server: tab.server, name: tab.name }
  if (tab.type === 'subset')    return { type: 'subset',    server: tab.server, dimension: tab.dimension, subsetName: tab.subsetName }
  if (tab.type === 'dimension') return { type: 'dimension', server: tab.server, dimension: tab.dimension }
  if (tab.type === 'cubeview' || tab.type === 'view') {
    if (tab.viewName) return { type: 'view', server: tab.server, cube: tab.cube, viewName: tab.viewName }
    return { type: 'cube', server: tab.server, cube: tab.cube }
  }
  return null
}

export default function EditorPane({ groupId }) {
  const { tabs, groups, setRevealTarget, setActiveGroup } = useStore()
  const group = groups.find(g => g.id === groupId)
  const tab = tabs.find(t => t.id === group?.activeTabId)
  const [cursor, setCursorLocal] = useState({ line: 1, col: 1 })

  const handleCursor = (pos) => setCursorLocal(pos)

  if (!tab) {
    return (
      <div className="flex-1 flex flex-col min-h-0" onClick={() => setActiveGroup(groupId)}>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm select-none">
          Open an object from the explorer to start editing.
        </div>
        <div className="h-5" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" onClick={() => setActiveGroup(groupId)}>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab.type === 'rules'      && <RulesEditor    key={tab.id} tab={tab} onCursor={handleCursor} />}
        {tab.type === 'process'    && <ProcessEditor  key={tab.id} tab={tab} />}
        {tab.type === 'subset'     && <SubsetEditor   key={tab.id} tab={tab} />}
        {tab.type === 'dimension'  && <DimensionEditor key={tab.id} tab={tab} />}
        {(tab.type === 'view' || tab.type === 'cubeview') && <ViewEditor key={tab.id} tab={tab} />}
        {tab.type === 'chore'      && <ChoreEditor    key={tab.id} tab={tab} />}
        {tab.type === 'guidedmdxview'   && <GuidedMDXBuilder  key={tab.id} tab={tab} />}
        {tab.type === 'sql'             && <SQLEditor          key={tab.id} tab={tab} />}
        {tab.type === 'hierarchytest'   && <HierarchyGridTest  key={tab.id} />}
        {tab.type === 'cubeeditor'      && <CubeEditor         key={tab.id} tab={tab} />}
        {tab.type === 'diff'            && <DiffTab            key={tab.id} tab={tab} />}
        {tab.type === 'deploy'          && <DeployPanel        key={tab.id} tab={tab} />}
        {tab.type === 'deploy-history'  && <DeployHistory      key={tab.id} />}
        {tab.type === 'session-report'  && <SessionReportTab   key={tab.id} tab={tab} />}
        {tab.type === 'transactionlog'  && (
          <div key={tab.id} className="flex h-full min-h-0 bg-sidebar">
            <TransactionLogPanel
              server={tab.server}
              cube={tab.cube}
              cubeDims={tab.cubeDims ?? []}
              tupleFilter={tab.elements?.length ? tab.elements : null}
              onClearFilter={null}
              onClose={null}
            />
          </div>
        )}
      </div>
      <div className="flex items-center px-3 py-0.5 bg-muted border-t border-border text-xs text-muted-foreground shrink-0">
        <span>Ln {cursor.line}, Col {cursor.col}</span>
        <span className="ml-4">
          {tab.type === 'rules' ? 'TM1 Rules' : tab.type === 'subset' ? 'Subset' : tab.type === 'dimension' ? 'Dimension' : tab.type === 'view' || tab.type === 'cubeview' ? 'View' : tab.type === 'chore' ? 'Chore' : tab.type === 'cubeeditor' ? 'Cube' : 'TM1 TI'}
        </span>
        {getRevealTarget(tab) && (
          <button
            onClick={() => setRevealTarget(getRevealTarget(tab))}
            className="ml-auto flex items-center gap-1 text-amber-400 hover:text-amber-300 transition-colors"
            title="Show in tree"
          >
            <Locate size={11} /> Show in tree
          </button>
        )}
      </div>
    </div>
  )
}
