import { post } from '@/lib/api'
import { useEffect, useRef, useState, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useRules, useSaveRules, useConflictCheck, useCubeDimensions } from '@/hooks/useApi'
import { registerMDXAndVariableCompletions, registerTM1Theme } from '@/lib/tm1-functions'
import ProcessEditor from '@/components/process-editor/ProcessEditor'
import SQLEditor from '@/components/SQLEditor'
import SubsetEditor from '@/components/SubsetEditor'
import DimensionEditor from '@/components/dimension-editor/DimensionEditor'
import ViewEditor from '@/components/view-editor/ViewEditor'
import ChoreEditor from '@/components/ChoreEditor'
import GuidedMDXBuilder from '@/components/GuidedMDXBuilder'
import CubeEditor from '@/components/CubeEditor'
import { toast } from 'sonner'
import { Locate } from 'lucide-react'
import { enableQuoteDoubleClick } from '@/lib/quote-select'
import { loadSettings, saveSettings } from '@/lib/formatters/settings.js'
import { formatRules } from '@/lib/formatters/rules-formatter.js'
import { getNamingMap } from '@/lib/formatters/naming.js'
import { validateRulesSyntax } from '@/lib/rules-validator'
import { registerRulesCompletions } from '@/lib/tm1-completion'
import { getFunctionRef } from '@/lib/tm1-snippets.js'
import SnippetPanel from '@/components/SnippetPanel'
import TransactionLogPanel from '@/components/TransactionLogPanel'
import ObjectHistoryPanel from '@/components/ObjectHistoryPanel'
import DiffTab from '@/components/DiffTab'
import SessionReportTab from '@/components/SessionReportTab'
import { ConflictBanner, ConflictSaveWarning } from '@/components/ConflictBanner'
import DiffViewerModal from '@/components/DiffViewerModal'
import CubeMapEditor from '@/components/cubemap-editor/CubeMapEditor'
import RuleLensPanel from '@/components/RuleLensPanel'
import CubeDataSources from '@/components/CubeDataSources'
import HelpPanel from '@/components/HelpPanel'
import { getRulesSession, saveRulesSession } from '@/lib/rules-session'
import { mergeCheckErrors } from '@/lib/rules-editor/check-merge'
import { scanRegions } from '@/lib/rules-editor/regions'
import { getRevealTarget } from '@/lib/reveal-target'
import LineagePanel from '@/components/rules-editor/lineage/LineagePanel'
import CellTracePanel from '@/components/rules-editor/trace/CellTracePanel'
import RulesToolbar from '@/components/rules-editor/RulesToolbar'
import IssuesList from '@/components/rules-editor/IssuesList'
import LensEditor from '@/components/LensEditor'
import { rulesTabId, processTabId } from '@/lib/tab-ids'

// ── Rules editor ─────────────────────────────────────────────────────────────

function RulesEditor({ tab, onCursor }) {
  const { initTabContent, updateTabContent, markTabSaved, clearScrollTo, openTab, openTabToSide, server, serverVersion, dark, themeVersion, setFormatSettingsOpen, setRevealTarget, bumpRulesVersion } = useStore()
  const { data, isLoading } = useRules(tab.server, tab.cube)
  const saveRules = useSaveRules()
  const registeredRef = useRef(false)
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const formatPopupRef = useRef(null)
  const savedUi = getRulesSession(tab.id)
  const [showLineage, setShowLineage] = useState(savedUi?.showLineage ?? false)
  const [showRuleLens, setShowRuleLens] = useState(savedUi?.showRuleLens ?? false)
  const [ruleLensGrouped, setRuleLensGrouped] = useState(savedUi?.ruleLensGrouped ?? false)
  const [lineageMode, setLineageMode] = useState(savedUi?.lineageMode ?? 'sources')
  const [showSnippets, setShowSnippets] = useState(savedUi?.showSnippets ?? false)
  const [showHelp, setShowHelp] = useState(false)
  const [showMinimap, setShowMinimap] = useState(() => loadSettings().editor?.minimap?.rules ?? false)
  const [showTrace, setShowTrace] = useState(savedUi?.showTrace ?? false)
  const [showHistory, setShowHistory] = useState(savedUi?.showHistory ?? false)
  const { data: cubeDimsData } = useCubeDimensions(showTrace ? tab.server : null, showTrace ? tab.cube : null)
  const cubeDims = cubeDimsData ?? null
  const [dismissedId, setDismissedId] = useState(null)
  const [saveConflict, setSaveConflict] = useState(null)
  const [conflictDiff, setConflictDiff] = useState(null)
  const { openConflict, checkBeforeSave } = useConflictCheck(tab.server, 'rules', tab.cube)

  const [regionsCollapsed, setRegionsCollapsed] = useState(false)
  const [showRegionMenu, setShowRegionMenu] = useState(false)
  const [regionList, setRegionList] = useState([])   // scanned when the menu opens
  const [showFormatPopup, setShowFormatPopup] = useState(false)
  const [formatStruct, setFormatStruct] = useState(() => loadSettings().rules.expressionFormatter ?? null)
  const [checking, setChecking]             = useState(false)
  const [checkResult, setCheckResult]       = useState(null) // null | 'pass' | 'fail'
  const [checkErrors, setCheckErrors]       = useState([])   // { severity, line, message }[]
  const checkSeqRef                          = useRef(0)

  // Contextual drill-ins (Lineage, Data Sources) open beside the rules you are reading.
  const openCube = useCallback((cube, openHere) => {
    const t = { id: rulesTabId(tab.server, cube), type: 'rules', label: cube, server: tab.server, cube, content: null }
    if (openHere) openTab(t); else openTabToSide(t)
  }, [tab.server, openTab, openTabToSide])

  const openProcess = useCallback((name, openHere) => {
    const t = { id: processTabId(tab.server, name), type: 'process', label: name, server: tab.server, name, content: null }
    if (openHere) openTab(t); else openTabToSide(t)
  }, [tab.server, openTab, openTabToSide])

  const openCubeMap = useCallback(() => {
    openTab({ id: `cubemap:${tab.server}`, type: 'cubemap', label: 'Cube Map', server: tab.server, focusCube: tab.cube, focusAt: Date.now() })
  }, [tab.server, tab.cube])

  // Transaction log for a rule-lens measure (other dimensions left unfiltered).
  const openTransactionLog = useCallback((elements, dims, label) => {
    openTabToSide({
      id: `txlog:${tab.server}:${tab.cube}:${Date.now()}`,
      type: 'transactionlog',
      label: `Log — ${tab.cube}${label ? ` · ${label}` : ''}`,
      server: tab.server, cube: tab.cube, cubeDims: dims, elements,
    }, { noSplit: true })
  }, [tab.server, tab.cube, openTabToSide])

  // Keep side-panel state for this tab when a lineage cube opens another rules tab.
  // Saved on change (not just unmount): a split remounts this editor immediately.
  useEffect(() => {
    saveRulesSession(tab.id, { showLineage, lineageMode, showSnippets, showHistory, showRuleLens, ruleLensGrouped, showTrace })
  }, [tab.id, showLineage, lineageMode, showSnippets, showHistory, showRuleLens, ruleLensGrouped, showTrace])

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
    // Only the newest check may write markers. A slower earlier request can
    // otherwise land after the fixed buffer passes and put the old squiggle back.
    const seq = ++checkSeqRef.current
    setChecking(true)
    try {
      const staticErrors = validateRulesSyntax(content, { version: serverVersion })
      let tm1Errors = []
      try {
        const d = await post('/api/rules/check', { server: tab.server, cube: tab.cube, rules: content })
        tm1Errors = d.errors ?? []
      } catch { /* TM1 check failed — static errors still shown */ }
      if (seq !== checkSeqRef.current) return
      const { staticToShow, errors } = mergeCheckErrors(staticErrors, tm1Errors)
      const markers = [
        ...tm1Errors.map(e => ({
          severity: monacoRef.current.MarkerSeverity.Error,
          message:  e.Message,
          startLineNumber: e.LineNumber,
          startColumn: 1,
          endLineNumber: e.LineNumber,
          endColumn: model.getLineMaxColumn(e.LineNumber),
        })),
        ...staticToShow.map(e => ({
          severity: e.severity === 'warning'
            ? monacoRef.current.MarkerSeverity.Warning
            : monacoRef.current.MarkerSeverity.Error,
          message: e.message,
          startLineNumber: e.line,
          startColumn: 1,
          endLineNumber: e.line,
          endColumn: model.getLineMaxColumn(e.line),
        })),
      ]
      monacoRef.current.editor.setModelMarkers(model, 'rules-check', markers)
      const errorCount = tm1Errors.length +
        staticToShow.filter(e => (e.severity ?? 'error') === 'error').length
      setCheckResult(errorCount === 0 ? 'pass' : 'fail')
      setCheckErrors(errors)
    } finally {
      if (seq === checkSeqRef.current) setChecking(false)
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

  // Re-apply the user's font preferences when they change in the preferences panel
  useEffect(() => {
    const editorSettings = loadSettings().editor ?? {}
    const opts = {
      fontFamily: editorSettings.fontFamily ?? undefined,
      fontSize:   editorSettings.fontSize ?? undefined,
      lineHeight: editorSettings.lineHeight ?? undefined,
    }
    console.log('[font] applying', opts, 'to', editorRef.current ? 'editor' : 'no-editor')
    editorRef.current?.updateOptions(opts)
  }, [themeVersion])

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
          post('/api/cube/rules/check-references', { server: tab.server, cube: tab.cube, rules: editor.getValue() })
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

  const undo = () => editorRef.current?.trigger('tm1ide', 'undo', null)
  const redo = () => editorRef.current?.trigger('tm1ide', 'redo', null)

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    enableQuoteDoubleClick(editor)
    // Explicit bindings: Cmd+Z / Ctrl+Z undo, Cmd+Shift+Z / Ctrl+Y redo.
    // Monaco has these by default, but binding them here keeps the shortcut
    // inside the editor even when the page or a parent pane has its own key
    // handling.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => editor.trigger('tm1ide', 'undo', null))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () => editor.trigger('tm1ide', 'redo', null))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => editor.trigger('tm1ide', 'redo', null))
    // apply the user's editor font preferences (fontFamily / fontSize / lineHeight from settings)
    const editorSettings = loadSettings().editor ?? {}
    editor.updateOptions({
      fontFamily: editorSettings.fontFamily ?? undefined,
      fontSize:   editorSettings.fontSize ?? undefined,
      lineHeight: editorSettings.lineHeight ?? undefined,
    })
    if (!registeredRef.current) {
      registerMDXAndVariableCompletions(monaco, () => server, () => serverVersion)
      registerRulesCompletions(monaco)
      registerTM1Theme(monaco, dark)
      registeredRef.current = true
    }
    editor.onDidChangeCursorPosition(e => {
      onCursor({ line: e.position.lineNumber, col: e.position.column })
    })

    // Prevent browser's Ctrl+S "Save Page" dialog and trigger save instead
    editor.onKeyDown(e => {
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
    // Typing '(' right after a function name (e.g. DB() can leave Monaco's
    // suggest widget showing stale results from the snippet-library provider
    // (tm1-snippets.js) instead of cleanly re-querying every provider — both
    // are registered on tm1rules, but only tm1-completion.js declares '(' as
    // a trigger character, and Monaco doesn't reliably discard the other
    // provider's already-rendered items on that kind of re-trigger. Force a
    // full close + fresh re-open so it can't hold onto the wrong list.
    editor.onDidType(text => {
      if (text === '(') {
        editor.trigger('tm1ide', 'hideSuggestWidget', {})
        setTimeout(() => editor.trigger('tm1ide', 'editor.action.triggerSuggest', {}), 0)
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
    const model = editor.getModel()
    const lines = []
    for (let line = 1; line <= model.getLineCount(); line++) {
      lines.push(model.getLineContent(line))
    }
    return scanRegions(lines)
  }

  const goToRegion = (line) => {
    const editor = editorRef.current
    if (!editor) return
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
    setShowRegionMenu(false)
  }

  const toggleRegionMenu = () => {
    if (!showRegionMenu) setRegionList(getRegions())
    setShowRegionMenu(v => !v)
  }

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
    saveSettings({ ...s, editor: { ...s.editor, minimap: { ...(s.editor.minimap ?? {}), rules: next } } })
  }

  if (isLoading && tab.content === null) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading rules…</div>
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ConflictBanner conflict={openConflict?.id !== dismissedId ? openConflict : null} onDismiss={() => setDismissedId(openConflict?.id)} />
      <ConflictSaveWarning
        conflict={saveConflict}
        onSaveAnyway={() => { setSaveConflict(null); doSave() }}
        onCancel={() => setSaveConflict(null)}
        onShowDiff={() => {
          setConflictDiff({
            object_type: 'rules',
            object_name: tab.cube,
            timestamp:   saveConflict.timestamp,
            action:      'CONFLICT',
            session_name: null,
            before_state: saveConflict.after_state ?? { text: data?.rules ?? '' },
            after_state:  { text: editorRef.current?.getValue() ?? '' },
          })
        }}
      />
      {conflictDiff && <DiffViewerModal entry={conflictDiff} onClose={() => setConflictDiff(null)} />}
      <div className="relative z-0 flex items-center gap-1.5 px-3 py-1 border-b border-border bg-muted/30 shrink-0">
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
      <div className="relative z-10 flex flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        <CubeDataSources server={tab.server} cube={tab.cube} onOpenCube={openCube} onOpenProcess={openProcess} onOpenMap={openCubeMap} />
        <div className="relative flex-1 min-h-0 overflow-hidden">
        <RulesToolbar
          dirty={tab.dirty}
          saving={saveRules.isPending}
          onSave={handleSave}
          onUndo={undo}
          onRedo={redo}
          checking={checking}
          checkResult={checkResult}
          onCheck={runCheck}
          showFormatPopup={showFormatPopup}
          onToggleFormatPopup={() => setShowFormatPopup(v => !v)}
          formatPopupRef={formatPopupRef}
          formatStruct={formatStruct}
          onSelectFormatStruct={setFormatStruct}
          runFormat={runFormat}
          onOpenFormatSettings={() => { setShowFormatPopup(false); setFormatSettingsOpen(true) }}
          showRegionMenu={showRegionMenu}
          onToggleRegionMenu={toggleRegionMenu}
          regionList={regionList}
          onGoToRegion={goToRegion}
          regionsCollapsed={regionsCollapsed}
          onToggleRegions={toggleRegions}
          showSnippets={showSnippets}
          onToggleSnippets={() => setShowSnippets(s => !s)}
          showTrace={showTrace}
          onToggleTrace={() => setShowTrace(s => !s)}
          showMinimap={showMinimap}
          onToggleMinimap={toggleMinimap}
          showLineage={showLineage}
          onToggleLineage={() => setShowLineage(s => !s)}
          showRuleLens={showRuleLens}
          onToggleRuleLens={() => setShowRuleLens(s => !s)}
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory(v => !v)}
          onShowHelp={() => setShowHelp(true)}
        />
        <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="rules" />
        <MonacoEditor
          height="100%"
          language="tm1rules"
          value={content}
          theme="tm1-custom"
          beforeMount={monaco => registerTM1Theme(monaco, dark)}
          onChange={v => updateTabContent(tab.id, v)}
          onMount={handleMount}
          options={{ padding: { top: 48, bottom: 12 }, fontFamily: loadSettings().editor?.fontFamily ?? undefined, fontSize: loadSettings().editor?.fontSize ?? undefined, lineHeight: loadSettings().editor?.lineHeight ?? undefined, minimap: { enabled: showMinimap }, wordWrap: 'on', scrollBeyondLastLine: false, folding: true, foldingStrategy: 'auto', glyphMargin: true, wordBasedSuggestions: 'off' }}
        />
        {showHistory && (
          <ObjectHistoryPanel
            server={tab.server}
            objectType="rules"
            objectName={tab.cube}
            onClose={() => setShowHistory(false)}
          />
        )}
        </div>{/* end relative flex-1 editor wrapper */}
        <IssuesList
          errors={checkErrors}
          onClear={() => setCheckErrors([])}
          onJump={line => {
            editorRef.current?.revealLineInCenter(line)
            editorRef.current?.setPosition({ lineNumber: line, column: 1 })
            editorRef.current?.focus()
          }}
        />
      </div>
      {showSnippets && (
        <div className="w-72 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
          <SnippetPanel snippets={getFunctionRef('rules')} language="rules" onInsert={insertSnippet} />
        </div>
      )}
      {showTrace && (
        <CellTracePanel
          tabId={tab.id}
          server={tab.server}
          cube={tab.cube}
          cubeDims={cubeDims}
          onClose={() => setShowTrace(false)}
        />
      )}
      {showLineage && (
        <LineagePanel server={tab.server} cube={tab.cube} onOpen={openCube} mode={lineageMode} setMode={setLineageMode} />
      )}
      {showRuleLens && (
        <RuleLensPanel server={tab.server} cube={tab.cube} onOpenCube={openCube} onOpenMap={openCubeMap} onClose={() => setShowRuleLens(false)} grouped={ruleLensGrouped} onToggleGrouped={setRuleLensGrouped} onOpenLog={openTransactionLog} />
      )}
      </div>
    </div>
  )
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

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
        {tab.type === 'cubeeditor'      && <CubeEditor         key={tab.id} tab={tab} />}
        {tab.type === 'diff'            && <DiffTab            key={tab.id} tab={tab} />}
        {tab.type === 'cubemap'         && <CubeMapEditor      key={tab.id} tab={tab} />}
        {tab.type === 'session-report'  && <SessionReportTab   key={tab.id} tab={tab} />}
        {tab.type === 'lens'           && <LensEditor        key={tab.id} tab={tab} />}
        {tab.type === 'transactionlog'  && (
          <div key={tab.id} className="flex h-full min-h-0 bg-sidebar">
            <TransactionLogPanel
              server={tab.server}
              cube={tab.cube}
              cubeDims={tab.cubeDims ?? []}
              tupleFilter={tab.elements?.length ? tab.elements : null}
              onClearFilter={null}
              onClose={null}
              fill
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
