import { useRef, useState } from 'react'
import { loadSettings, saveSettings } from '@/lib/formatters/settings.js'
import { formatRules } from '@/lib/formatters/rules-formatter.js'
import { getNamingMap } from '@/lib/formatters/naming.js'

// The Format popup and its expression-structure setting. The popup's
// click-outside listener lives in useRulesMonaco with the other editor overlay
// listeners, so the original effect order is kept.
export default function useRulesFormat({ editorRef }) {
  const formatPopupRef = useRef(null)
  const undoFormatRef = useRef(null)
  const undoListenerRef = useRef(null)
  const [canUndoFormat, setCanUndoFormat] = useState(false)
  const [showFormatPopup, setShowFormatPopup] = useState(false)
  const [formatStruct, setFormatStruct] = useState(() => {
    const saved = loadSettings().rules.expressionFormatter
    return saved === 'tm1-verbose' || saved === 'tm1-structured' ? saved : 'tm1-structured'
  })

  const runFormat = async () => {
    const s = loadSettings()
    const rulesSettings = { ...s.rules, expressionFormatter: formatStruct }
    saveSettings({ ...s, rules: rulesSettings })
    const editor = editorRef.current
    if (!editor) { setShowFormatPopup(false); return }
    const model = editor.getModel()
    const before = model.getValue()
    const selection = editor.getSelection()
    if (selection && !selection.isEmpty()) {
      const selectedText = model.getValueInRange(selection)
      const { map: namingMap } = getNamingMap()
      const formatted = formatRules(selectedText, rulesSettings, namingMap)
      editor.executeEdits('format-selection', [{ range: selection, text: formatted }])
      editor.setSelection(selection)
    } else {
      await editor.getAction('editor.action.formatDocument').run()
    }
    const after = model.getValue()
    if (after !== before) {
      undoFormatRef.current = { before, after, selection }
      setCanUndoFormat(true)
      // Any later typing means Undo format would destroy unrelated work: drop it.
      undoListenerRef.current?.dispose()
      undoListenerRef.current = editor.onDidChangeModelContent(() => {
        if (editor.getValue() !== after) {
          undoFormatRef.current = null
          setCanUndoFormat(false)
          undoListenerRef.current?.dispose()
          undoListenerRef.current = null
        }
      })
    }
    setShowFormatPopup(false)
  }

  const undoFormat = () => {
    const editor = editorRef.current
    const snap = undoFormatRef.current
    if (!editor || !snap) return
    const model = editor.getModel()
    if (model.getValue() !== snap.after) { setCanUndoFormat(false); undoFormatRef.current = null; return }
    editor.pushUndoStop()
    editor.executeEdits('undo-format', [{ range: model.getFullModelRange(), text: snap.before }])
    if (snap.selection) editor.setSelection(snap.selection)
    editor.pushUndoStop()
    undoFormatRef.current = null
    setCanUndoFormat(false)
    undoListenerRef.current?.dispose()
    undoListenerRef.current = null
  }

  return {
    formatPopupRef, showFormatPopup, setShowFormatPopup,
    formatStruct, setFormatStruct, runFormat,
    canUndoFormat, undoFormat,
  }
}
