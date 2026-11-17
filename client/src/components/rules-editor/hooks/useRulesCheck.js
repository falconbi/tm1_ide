import { useCallback, useEffect, useRef, useState } from 'react'
import { useCheckRules } from '@/hooks/useApi'
import { validateRulesSyntax } from '@/lib/rules-validator'
import { mergeCheckErrors } from '@/lib/rules-editor/check-merge'

// The Check button and the live 800ms debounce: static findings plus TM1's
// CheckRules, the sequence guard and the Monaco markers.
export default function useRulesCheck({ tab, content, serverVersion, editorRef, monacoRef }) {
  const { mutateAsync: checkRulesAsync } = useCheckRules()
  const [checking, setChecking]     = useState(false)
  const [checkResult, setCheckResult] = useState(null) // null | 'pass' | 'fail'
  const [checkErrors, setCheckErrors] = useState([])   // { severity, line, message }[]
  const checkSeqRef                   = useRef(0)

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
        const d = await checkRulesAsync({ server: tab.server, cube: tab.cube, rules: content })
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
  }, [content, tab.server, tab.cube, checkRulesAsync, serverVersion, editorRef, monacoRef])

  // Live validation — debounced 800ms after last keystroke
  useEffect(() => {
    if (!content || !editorRef.current || !monacoRef.current) return
    setCheckResult(null)
    const timer = setTimeout(runCheck, 800)
    return () => clearTimeout(timer)
  }, [content, tab.server, tab.cube, runCheck, editorRef, monacoRef])

  return { runCheck, checking, checkResult, checkErrors, setCheckErrors }
}
