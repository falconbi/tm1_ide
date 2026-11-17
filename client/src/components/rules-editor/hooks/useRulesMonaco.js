import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/store'
import { registerMDXAndVariableCompletions, registerTM1Theme } from '@/lib/tm1-functions'
import { registerRulesCompletions } from '@/lib/tm1-completion'
import { enableQuoteDoubleClick } from '@/lib/quote-select'
import { loadSettings, saveSettings } from '@/lib/formatters/settings.js'
import { scanRegions } from '@/lib/rules-editor/regions'

// Monaco: the mount and its one-time completions registration, cursor
// reporting and Ctrl+S, regions and folding, minimap, undo/redo, snippet
// insert, and revealing a line requested by another panel. `editorRef` and
// `monacoRef` are created in the shell and shared with useRulesCheck.
export default function useRulesMonaco({
  tab, server, serverVersion, dark, themeVersion, onCursor, onSave,
  editorRef, monacoRef, formatPopupRef, showFormatPopup, setShowFormatPopup,
}) {
  const { clearScrollTo } = useStore()
  const registeredRef = useRef(false)
  const [showMinimap, setShowMinimap] = useState(() => loadSettings().editor?.minimap?.rules ?? false)
  const [regionsCollapsed, setRegionsCollapsed] = useState(false)
  const [showRegionMenu, setShowRegionMenu] = useState(false)
  const [regionList, setRegionList] = useState([])   // scanned when the menu opens

  useEffect(() => {
    if (tab.scrollToLine && editorRef.current) {
      editorRef.current.revealLineInCenter(tab.scrollToLine)
      editorRef.current.setPosition({ lineNumber: tab.scrollToLine, column: 1 })
      clearScrollTo(tab.id)
    }
  }, [tab.scrollToLine, clearScrollTo, editorRef, tab.id])

  // Close region menu on click outside
  useEffect(() => {
    if (!showRegionMenu) return
    const handler = (e) => {
      if (!e.target.closest('.region-menu-container')) setShowRegionMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showRegionMenu])

  // Close format popup on click outside — kept here with the region listener so
  // the effects run in their original order relative to the theme and font ones.
  useEffect(() => {
    if (!showFormatPopup) return
    const handler = (e) => {
      if (formatPopupRef.current && !formatPopupRef.current.contains(e.target)) setShowFormatPopup(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showFormatPopup, formatPopupRef, setShowFormatPopup])

  useEffect(() => {
    if (monacoRef.current) registerTM1Theme(monacoRef.current, dark)
  }, [dark, themeVersion, monacoRef])

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
  }, [themeVersion, editorRef])

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
        onSave()
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

  return {
    showMinimap, handleMount, undo, redo,
    regionsCollapsed, toggleRegions, showRegionMenu, regionList, goToRegion, toggleRegionMenu,
    insertSnippet, toggleMinimap,
  }
}
