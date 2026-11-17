import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useRunProcess, errorLogContentQuery } from '@/hooks/useApi'

// Run dialog, run result, __RUN_LOG output and the TM1 error log.
export default function useProcessRun({ tab }) {
  const queryClient = useQueryClient()
  const runProcess = useRunProcess()

  const [showRun, setShowRun] = useState(false)
  const [runOutput, setRunOutput] = useState(null)
  const [logContent, setLogContent] = useState(null)
  const [logOpen, setLogOpen] = useState(true)
  const [errorLogFilename, setErrorLogFilename] = useState(null)
  const [errorLogContent, setErrorLogContent] = useState(null)
  const [errorLogOpen, setErrorLogOpen] = useState(false)
  const [errorLogLoading, setErrorLogLoading] = useState(false)

  // The debug run clears the last run result before it starts.
  const clearRunOutput = () => setRunOutput(null)

  const resetRunOutput = () => {
    setRunOutput(null)
    setLogContent(null)
    setErrorLogFilename(null)
    setErrorLogContent(null)
    setErrorLogOpen(false)
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

  return {
    showRun, setShowRun, runProcess, running: runProcess.isPending,
    handleRun, runOutput, logContent, logOpen, setLogOpen,
    errorLogFilename, errorLogContent, errorLogOpen, setErrorLogOpen,
    errorLogLoading, loadErrorLog, clearRunOutput, resetRunOutput,
  }
}
