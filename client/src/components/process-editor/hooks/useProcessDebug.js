import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useDebugProcess } from '@/hooks/useApi'
import { parseDebugLog } from '@/lib/ti-debugger'
import { sectionsFromEdits, runParamArray } from '@/lib/process-editor/sections'
import { debugIssues, unknownWatches } from '@/lib/process-editor/debug-result'

// Watches, capture points, capture-when, the debug run and its captured events.
// The current section bodies come from useProcessEdits (edits + the saved data),
// never a second copy of that state.
export default function useProcessDebug({ tab, data, edits, paramEdits, availableVars, setCheckResults, clearRunOutput }) {
  const debugProcess = useDebugProcess()

  const [showDebug, setShowDebug]       = useState(false)
  const [breakpoints, setBreakpoints]   = useState({})
  const [watches, setWatches]           = useState([])
  const [captureWhen, setCaptureWhen]   = useState('')
  const [debugEvents, setDebugEvents]   = useState([])
  const [isDebugging, setIsDebugging]   = useState(false)
  const [showDebugRun, setShowDebugRun] = useState(false)

  const toggleBreakpoint = useCallback((sectionKey, lineNum) => {
    setBreakpoints(prev => {
      const next = { ...prev }
      const set = new Set(next[sectionKey] ?? [])
      set.has(lineNum) ? set.delete(lineNum) : set.add(lineNum)
      next[sectionKey] = set
      return next
    })
  }, [])

  const handleDebugRun = (params) => {
    // Instrumenting an unknown name makes TI abort before any breakpoint can
    // report. Catch it here with the actual variable list instead.
    const unknown = unknownWatches(watches, availableVars)
    if (unknown.length) {
        toast.warning(`Unknown watch variable${unknown.length > 1 ? 's' : ''}: ${unknown.map(w => w.name).join(', ')}. Add the variable to the process or remove the watch.`)
        return
    }
    setShowDebugRun(false)
    clearRunOutput()
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

  // The Debug panel's Run button: ask for parameters when the process has any.
  const startDebugRun = () => {
    const params = paramEdits ?? data?.Parameters ?? []
    if (params.length) setShowDebugRun(true)
    else handleDebugRun({})
  }

  return {
    showDebug, setShowDebug, breakpoints, watches, setWatches,
    captureWhen, setCaptureWhen, debugEvents, isDebugging,
    showDebugRun, setShowDebugRun, toggleBreakpoint, handleDebugRun, startDebugRun,
  }
}
