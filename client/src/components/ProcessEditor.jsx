import { useState, useRef, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useProcess, useSaveProcess, useRunProcess, useCreateProcess, useDebugProcess, useConflictCheck, useCheckReferences, errorLogContentQuery } from '@/hooks/useApi'
import { registerMDXAndVariableCompletions, registerTM1Theme } from '@/lib/tm1-functions'
import { registerTICompletions } from '@/lib/tm1-completion'
import { cn } from '@/lib/utils'
import { processTabId } from '@/lib/tab-ids'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, Search, AlertTriangle, Locate, HelpCircle } from 'lucide-react'
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
import { SECTION_LABEL, SECTION_TO_KEY, CAPTURE_HOVER, toTypeStr } from '@/lib/process-editor/constants'
import { sectionsFromEdits, runParamArray } from '@/lib/process-editor/sections'
import { debugIssues, unknownWatches } from '@/lib/process-editor/debug-result'
import ParamsPanel from '@/components/process-editor/panels/ParamsPanel'
import DatasourcePanel from '@/components/process-editor/panels/DatasourcePanel'
import DatasourcePreview from '@/components/process-editor/panels/DatasourcePreview'
import CollapsibleSection from '@/components/process-editor/panels/CollapsibleSection'
import VariablesPanel from '@/components/process-editor/panels/VariablesPanel'
import RunDialog from '@/components/process-editor/dialogs/RunDialog'
import SaveAsDialog from '@/components/process-editor/dialogs/SaveAsDialog'
import DebugPanel from '@/components/process-editor/DebugPanel'
import ProcessToolbar from '@/components/process-editor/ProcessToolbar'
import RunOutputPanel from '@/components/process-editor/RunOutputPanel'


export default function ProcessEditor({ tab }) {
  const { server, serverVersion, dark, themeVersion, initTabContent, markTabSaved, clearScrollTo, openTab, patchTab, setRevealTarget } = useStore()
  const queryClient = useQueryClient()
  const { data, isLoading } = useProcess(tab.server, tab.name)
  const saveProcess   = useSaveProcess()
  const runProcess    = useRunProcess()
  const createProcess = useCreateProcess()
  const checkReferences = useCheckReferences()
  const registeredRef    = useRef(false)
  const decorationIdsRef = useRef({})
  const debugProcess     = useDebugProcess()

  const [showDebug, setShowDebug]       = useState(false)
  const [breakpoints, setBreakpoints]   = useState({})
  const [watches, setWatches]           = useState([])
  const [captureWhen, setCaptureWhen]   = useState('')
  const [debugEvents, setDebugEvents]   = useState([])
  const [isDebugging, setIsDebugging]   = useState(false)
  const [showDebugRun, setShowDebugRun] = useState(false)
  const [checkResults, setCheckResults] = useState(null)
  const [showCheck, setShowCheck]       = useState(false)
  const [showHelp, setShowHelp]         = useState(false)

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
    const sections = sectionsFromEdits(edits, data)
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
      registerMDXAndVariableCompletions(monaco, () => server, () => serverVersion)
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
        options: { glyphMarginClassName: 'debug-bp-glyph', glyphMarginHoverMessage: CAPTURE_HOVER },
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
      const d = await queryClient.fetchQuery({ ...errorLogContentQuery(tab.server, errorLogFilename), staleTime: 0 })
      setErrorLogContent(d.content ?? '')
    } catch (e) {
      setErrorLogContent(`Failed to load error log: ${e.message}`)
    } finally {
      setErrorLogLoading(false)
    }
  }

  const handleCreateNew = () => {
    const name = draftName.trim()
    if (!name) return
    const body = sectionsFromEdits(edits)
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
    const body = sectionsFromEdits(edits, data)
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
          const sections = sectionsFromEdits(edits, data)
          checkReferences.mutate(
            { server: tab.server, sections },
            {
              onSuccess: d => { d.warnings?.forEach(w => toast.warning(w.message, { duration: 8000 })) },
              onError: () => {},
            },
          )
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
    const body = sectionsFromEdits(edits, data)
    if (paramEdits !== null) body.Parameters = paramEdits.map(p => ({ Name: p.Name, Type: toTypeStr(p.Type), Value: String(p.Value ?? ''), Prompt: p.Prompt ?? '' }))
    if (dsEdits !== null) body.DataSource = dsEdits
    const id = toast.loading(`Creating "${newName}"…`)
    createProcess.mutate({ server: tab.server, name: newName }, {
      onSuccess: () => saveProcess.mutate({ server: tab.server, name: newName, body }, {
        onSuccess: () => {
          toast.success(`Saved as "${newName}"`, { id })
          setShowSaveAs(false)
          openTab({ id: processTabId(tab.server, newName), type: 'process', label: newName, server: tab.server, name: newName, content: null })
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
      options: { glyphMarginClassName: 'debug-bp-glyph', glyphMarginHoverMessage: CAPTURE_HOVER },
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
    const sections = sectionsFromEdits(edits, data)
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
    const unknown = unknownWatches(watches, availableVars)
    if (unknown.length) {
        toast.warning(`Unknown watch variable${unknown.length > 1 ? 's' : ''}: ${unknown.map(w => w.name).join(', ')}. Add the variable to the process or remove the watch.`)
        return
    }
    setShowDebugRun(false)
    setRunOutput(null)
    setIsDebugging(true)
    setDebugEvents([])
    const sections = sectionsFromEdits(edits, data)
    // Build param array from RunDialog values
    const paramArray = runParamArray(data?.Parameters, params)
    debugProcess.mutate({
      server: tab.server,
      name: tab.name,
      params: paramArray,
      sections,
      watches,
      breakpoints,
      captureWhen,
    }, {
      onSuccess: res => {
        setDebugEvents(parseDebugLog(res.log))
        setCheckResults(debugIssues(res))
        if (res.warnings?.length) {
          toast.warning(`${res.warnings.length} unknown function${res.warnings.length > 1 ? 's' : ''} commented out — see Issues panel`)
        }
        setIsDebugging(false)
        if (!res.error && captureWhen.trim() && !parseDebugLog(res.log).length) {
            toast.info(`No capture points matched: ${captureWhen}`)
        }
        if (res.error) {
            if (res.error.includes('invalid string expression')) {
                toast.warning(`Process errored: ${res.error} — this may be a TM1 variable name length bug. Try shortening variable names to ≤ 8 characters.`)
            } else {
                toast.warning(`Process errored: ${res.error}`)
            }
        }
        else if (res.badVars?.length) toast.warning(`Variable names may cause TM1 API issues: ${res.badVars.join(', ')} — consider shortening`)
        else if (res.noCapture) toast.info('Capture run complete — no watches or capture points set')
        else toast.success('Capture run complete')
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
          title="Capture Run"
          params={paramEdits ?? data?.Parameters}
          onRun={handleDebugRun}
          onClose={() => setShowDebugRun(false)}
          isPending={isDebugging}
        />
      )}

      <ProcessToolbar
        tab={tab}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        edits={edits}
        showHistory={showHistory}
        onToggleHistory={() => setShowHistory(v => !v)}
        onUndo={undo}
        onRedo={redo}
        draftName={draftName}
        onDraftNameChange={setDraftName}
        onCreateNew={handleCreateNew}
        creating={createProcess.isPending || saveProcess.isPending}
        onSave={handleSave}
        saveDisabled={!Object.keys(edits).length && paramEdits === null && dsEdits === null}
        saving={saveProcess.isPending}
        showSaveMenu={showSaveMenu}
        saveMenuRect={saveMenuRect}
        onToggleSaveMenu={rect => { setSaveMenuRect(rect); setShowSaveMenu(v => !v) }}
        onCloseSaveMenu={() => setShowSaveMenu(false)}
        onSaveAs={() => { setShowSaveAs(true); setShowSaveMenu(false) }}
        hasData={!!data}
        onToggleCheck={() => {
          setShowDebug(false)
          setShowSnippets(false)
          if (showCheck) {
            setShowCheck(false)
          } else {
            handleCheck()
          }
        }}
        showCheck={showCheck}
        onToggleDebug={() => { setShowDebug(d => !d); setShowSnippets(false) }}
        showDebug={showDebug}
        onToggleSnippets={() => { setShowSnippets(s => !s); setShowDebug(false) }}
        showSnippets={showSnippets}
        onRun={() => setShowRun(true)}
        showRegionMenu={showRegionMenu}
        regionRect={regionRect}
        regionList={regionList}
        onOpenRegionMenu={openRegionMenu}
        onGoToRegion={goToRegion}
        regionBtnRef={regionBtnRef}
        regionsCollapsed={regionsCollapsed}
        onToggleRegions={toggleRegions}
        onToggleMinimap={toggleMinimap}
        showMinimap={showMinimap}
      />

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
          <DatasourcePanel
            ds={dsEdits ?? data.DataSource ?? { Type: 'None' }}
            server={tab.server}
            onChange={v => { setDsEdits(v); markDirty() }}
          />
        </CollapsibleSection>
      )}

      {data && ['ODBC', 'ASCII', 'TM1CubeView', 'TM1DimensionSubset'].includes((dsEdits ?? data.DataSource)?.Type) && (
        <CollapsibleSection label="Datasource Preview" hint={(dsEdits ?? data.DataSource)?.dataSourceNameForServer ?? ''}>
          <DatasourcePreview ds={dsEdits ?? data.DataSource} server={tab.server} params={paramEdits ?? data.Parameters} />
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
          <ParamsPanel
            params={paramEdits ?? data.Parameters ?? []}
            onChange={v => { setParamEdits(v); markDirty() }}
          />
        </CollapsibleSection>
      )}

      {runOutput && (
        <RunOutputPanel
          runOutput={runOutput}
          onJumpToError={jumpToError}
          errorLogFilename={errorLogFilename}
          errorLogOpen={errorLogOpen}
          onErrorLogClick={errorLogOpen ? () => setErrorLogOpen(false) : loadErrorLog}
          logOpen={logOpen}
          onToggleLog={() => setLogOpen(o => !o)}
          logContent={logContent}
          errorLogLoading={errorLogLoading}
          errorLogContent={errorLogContent}
          onClose={() => { setRunOutput(null); setLogContent(null); setErrorLogFilename(null); setErrorLogContent(null); setErrorLogOpen(false) }}
        />
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
              captureWhen={captureWhen}
              onCaptureWhenChange={setCaptureWhen}
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
