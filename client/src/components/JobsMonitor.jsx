import { useQueryClient } from '@tanstack/react-query'
import { X, RefreshCw, XCircle, Loader2, Activity } from 'lucide-react'
import { useJobs, useCancelJob } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

function fmt(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const STATUS_COLOR = {
  Running:   'text-emerald-400',
  Completed: 'text-muted-foreground',
  Cancelled: 'text-amber-400',
  Aborted:   'text-red-400',
}

export default function JobsMonitor({ server, onClose }) {
  const jobs      = useJobs(server, { refetchInterval: 4000 })
  const cancel    = useCancelJob()
  const qc        = useQueryClient()

  const entries   = jobs.data ?? []
  const running   = entries.filter(j => j.Status === 'Running' || j.StatusMessage === 'Running')

  const handleCancel = async (id, name) => {
    try {
      await cancel.mutateAsync({ server, id })
      toast.success(`Cancelled: ${name}`)
      qc.invalidateQueries({ queryKey: ['jobs', server] })
    } catch (e) {
      toast.error(`Cancel failed: ${e.message}`)
    }
  }

  const isRunning = (j) =>
    (j.Status ?? j.StatusMessage ?? '').toLowerCase() === 'running'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="bg-background border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 680, maxHeight: 480 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Activity size={13} className={cn(running.length > 0 ? 'text-emerald-400 animate-pulse' : 'text-muted-foreground')} />
            <span className="text-sm font-semibold">Jobs Monitor</span>
            {running.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
                {running.length} running
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['jobs', server] })}
              title="Refresh"
              className="p-1 rounded text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            >
              {jobs.isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
            <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto">
          {jobs.isError && (
            <p className="px-4 py-6 text-xs text-red-400">{jobs.error?.message ?? 'Failed to load jobs'}</p>
          )}
          {!jobs.isError && entries.length === 0 && !jobs.isFetching && (
            <p className="px-4 py-6 text-xs text-muted-foreground italic text-center">No jobs found — server is idle.</p>
          )}
          {entries.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="sticky top-0 bg-background border-b border-border">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-2 py-2 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-2 py-2 font-medium text-muted-foreground">User</th>
                  <th className="text-left px-2 py-2 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-2 py-2 font-medium text-muted-foreground">Started</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map((j, i) => {
                  const status    = j.Status ?? j.StatusMessage ?? '—'
                  const running   = isRunning(j)
                  const objType   = j.ObjectType ?? '—'
                  const objName   = j.ObjectName ?? j.ProcessName ?? '—'
                  const user      = j.ExecutorName ?? j.CreatorName ?? '—'
                  const started   = j.StartTimeStamp ?? j.CreatedTimeStamp
                  return (
                    <tr key={j.ID ?? i} className={cn('border-b border-border/30 hover:bg-muted/20', running && 'bg-emerald-500/5')}>
                      <td className="px-4 py-2 text-muted-foreground font-mono">{objType}</td>
                      <td className="px-2 py-2 font-medium max-w-[180px] truncate" title={objName}>{objName}</td>
                      <td className="px-2 py-2 text-muted-foreground font-mono">{user}</td>
                      <td className={cn('px-2 py-2 font-medium', STATUS_COLOR[status] ?? 'text-foreground')}>
                        <span className="flex items-center gap-1">
                          {running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />}
                          {status}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground font-mono whitespace-nowrap">{fmt(started)}</td>
                      <td className="px-4 py-2">
                        {running && (
                          <button
                            onClick={() => handleCancel(j.ID, objName)}
                            disabled={cancel.isPending}
                            title="Cancel this job"
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                          >
                            <XCircle size={10} /> Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border shrink-0 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{entries.length} job{entries.length !== 1 ? 's' : ''}</span>
          <span className="italic">Auto-refreshes every 4 seconds</span>
        </div>
      </div>
    </div>
  )
}
