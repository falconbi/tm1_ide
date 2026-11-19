import { useRef, useState } from 'react'
import { loadSettings, saveSettings } from '@/lib/formatters/settings.js'
import { formatRules } from '@/lib/formatters/rules-formatter.js'
import { getNamingMap } from '@/lib/formatters/naming.js'

// The Format popup and its expression-structure setting. The popup's
// click-outside listener lives in useRulesMonaco with the other editor overlay
// listeners, so the original effect order is kept.
export default function useRulesFormat({ editorRef }) {
  const formatPopupRef = useRef(null)
  const [showFormatPopup, setShowFormatPopup] = useState(false)
  const [formatStruct, setFormatStruct] = useState(() => {
    const saved = loadSettings().rules.expressionFormatter
    return saved === 'tm1-verbose' || saved === 'tm1-structured' ? saved : 'tm1-structured'
  })

  const runFormat = () => {
    const s = loadSettings()
    const rulesSettings = { ...s.rules, expressionFormatter: formatStruct }
    saveSettings({ ...s, rules: rulesSettings })
    const editor = editorRef.current
    if (!editor) { setShowFormatPopup(false); return }
    const selection = editor.getSelection()
    if (selection && !selection.isEmpty()) {
      const model = editor.getModel()
      const selectedText = model.getValueInRange(selection)
      const { map: namingMap } = getNamingMap()
      const formatted = formatRules(selectedText, rulesSettings, namingMap)
      editor.executeEdits('format-selection', [{ range: selection, text: formatted }])
      editor.setSelection(selection)
    } else {
      editor.getAction('editor.action.formatDocument').run()
    }
    setShowFormatPopup(false)
  }

  return {
    formatPopupRef, showFormatPopup, setShowFormatPopup,
    formatStruct, setFormatStruct, runFormat,
  }
}
