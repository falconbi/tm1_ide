import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@/store'
import { registerMDXAndVariableCompletions, registerTM1Theme } from '@/lib/tm1-functions'
import { registerTICompletions } from '@/lib/tm1-completion'
import { enableQuoteDoubleClick } from '@/lib/quote-select'
import { loadSettings, saveSettings } from '@/lib/formatters/settings.js'
import { SECTION_TO_KEY, CAPTURE_HOVER } from '@/lib/process-editor/constants'

// Monaco: the mount and its one-time completions registration, decorations and
// capture-point glyphs, the regions menu and folding, minimap, undo/redo, and
// jumping to a line. `editorRef`/`monacoRef` are created in the shell and shared
// with useProcessCheck so the two hooks need no order between them.
export default function useProcessMonaco({
  tab, server, serverVersion, dark, themeVersion,
  activeSection, setActiveSection, breakpoints, showDebug, toggleBreakpoint,
  editorRef, monacoRef,
}) {
  const { clearScrollTo } = useStore()
  const registeredRef    = useRef(false)
  const decorationIdsRef = useRef({})
  const pendingLineRef   = useRef(null)
  const regionBtnRef     = useRef(null)

  const [showMinimap, setShowMinimap] = useState(() => loadSettings().editor?.minimap?.ti ?? false)
  // each section (Prolog/Metadata/Data/Epilog) is its own editor, so each keeps its own collapsed state
  const [collapsedSections, setCollapsedSections] = useState({})
  const regionsCollapsed = !!collapsedSections[activeSection]
  const setRegionsCollapsed = v => setCollapsedSections(c => ({ ...c, [activeSection]: v }))
  const [showRegionMenu, setShowRegionMenu] = useState(false)
  const [regionRect, setRegionRect] = useState(null)
  const [regionList, setRegionList] = useState([])   // scanned when the menu opens

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

  useEffect(() => {
    if (!showRegionMenu) return
    const handler = (e) => {
      if (!e.target.closest('.region-menu-container')) setShowRegionMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showRegionMenu])

  useEffect(() => {
    if (monacoRef.current) registerTM1Theme(monacoRef.current, dark)
  }, [dark, themeVersion, monacoRef])

  // Re-apply the user's font preferences when they change in the preferences panel
  useEffect(() => {
    const editorSettings = loadSettings().editor ?? {}
    editorRef.current?.updateOptions({
      fontFamily: editorSettings.fontFamily ?? undefined,
      fontSize:   editorSettings.fontSize ?? undefined,
      lineHeight: editorSettings.lineHeight ?? undefined,
    })
  }, [themeVersion, editorRef])

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
  }, [breakpoints, activeSection, showDebug, editorRef, monacoRef])

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
  }, [activeSection, editorRef, setActiveSection])

  return {
    showMinimap, toggleMinimap,
    regionsCollapsed, toggleRegions,
    showRegionMenu, regionRect, regionList, openRegionMenu, goToRegion, regionBtnRef,
    handleMount, undo, redo, insertSnippet, jumpToError, jumpToDebugLine,
  }
}
