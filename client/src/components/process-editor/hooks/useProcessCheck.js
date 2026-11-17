import { useState } from 'react'
import { toast } from 'sonner'
import { validateTICode } from '@/lib/ti-validator'
import { sectionsFromEdits } from '@/lib/process-editor/sections'
import { SECTION_LABEL } from '@/lib/process-editor/constants'

// Check button: static TI validation, its toast, the Issues panel results and
// the Monaco markers for the active section. The editor refs are created in the
// shell and shared with useProcessMonaco so this hook does not depend on order.
export default function useProcessCheck({ serverVersion, data, edits, activeSection, editorRef, monacoRef }) {
  const [checkResults, setCheckResults] = useState(null)
  const [showCheck, setShowCheck]       = useState(false)

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

  return { checkResults, setCheckResults, showCheck, setShowCheck, handleCheck }
}
