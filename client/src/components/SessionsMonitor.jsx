import { useState } from 'react'
import { X, RefreshCw, Loader2, Users, ShieldCheck, User, Trash2, Ban, Activity } from 'lucide-react'
import { useSessions, useThreads, useDisconnectSession, useCancelThread } from '@/hooks/useApi'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export default function SessionsMonitor({ server, onClose }) {
  const qc = useQueryClient()
  const [expandedUser, setExpandedUser] = useState(null)

  const { data: sessions = [], isFetching, error } = useSessions(server, { refetchInterval: 30_000 })
  const { data: threads = [] } = useThreads(server, { refetchInterval: 30_000, enabled: !!server })

  const disconnect = useDisconnectSession()
  const cancelThread = useCancelThread()

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sessions', server] })
    qc.invalidateQueries({ queryKey: ['threads', server] })
  }

  const threadBySessionId = {}
  for (const t of threads) {
    const sid = t.Session?.Name ?? t.Session ?? ''
    if (!threadBySessionId[sid]) threadBySessionId[sid] = []
    threadBySessionId[sid].push(t)
  }

  const grouped = sessions.reduce((acc, s) => {
    const userName = (s.User && typeof s.User === 'object') ? (s.User.Name ?? s.User.FriendlyName ?? null) : null
    const name = userName ?? `session:${(s.Name ?? '').slice(0, 8)}`
    if (!acc[name]) acc[name] = { name, friendlyName: s.User?.FriendlyName ?? name, type: s.User?.Type ?? '', sessions: [] }
    acc[name].sessions.push(s)
    return acc
  }, {})
  const users = Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name))

  const handleDisconnect = (id) => {
    disconnect.mutate({ server, id }, {
      onSuccess: () => { toast.success('Session disconnected'); refresh() },
      onError: (e) => toast.error(e.message),
    })
  }

  const handleCancelThread = (id) => {
    cancelThread.mutate({ server, id }, {
      onSuccess: () => { toast.success('Thread cancelled'); refresh() },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <div className="absolute bottom-6 right-0 w-[480px] bg-popover border border-border rounded-lg shadow-xl z-50 flex flex-col overflow-hidden" style={{ maxHeight: 420 }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <Users size={13} className="text-muted-foreground" />
          <span className="text-xs font-semibold">Active Sessions</span>
          {!isFetching && <span className="text-[10px] text-muted-foreground/60">({sessions.length} session{sessions.length !== 1 ? 's' : ''})</span>}
          {isFetching && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={refresh} disabled={isFetching}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">
            <RefreshCw size={11} />
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="overflow-auto flex-1">
        {error && <p className="px-4 py-6 text-xs text-red-400 text-center">{error.message}</p>}
        {!error && users.length === 0 && !isFetching && (
          <p className="px-4 py-6 text-xs text-muted-foreground italic text-center">No active sessions.</p>
        )}
        {!error && users.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/20 sticky top-0">
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">User</th>
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Application</th>
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Thread</th>
                <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isExpanded = expandedUser === u.name
                return (
                  <>
                    <tr key={u.name}
                      onClick={() => setExpandedUser(isExpanded ? null : u.name)}
                      className={cn('border-b border-border/50 cursor-pointer hover:bg-muted/30', isExpanded && 'bg-muted/20')}
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          {u.type === 'Admin' ? <ShieldCheck size={11} className="shrink-0 text-amber-500" /> : <User size={11} className="shrink-0 text-muted-foreground" />}
                          <span className="font-medium font-mono">{u.name}</span>
                          <span className="text-[10px] text-muted-foreground/50 ml-1">({u.sessions.length})</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {u.sessions.length === 1
                          ? (u.sessions[0].Application ?? '—')
                          : <span className="text-[10px] italic">Multiple</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        {(() => {
                          const active = threads.filter(t => t.User?.Name === u.name)
                          return active.length > 0
                            ? <span className="text-emerald-500 text-[10px]">{active.length} active</span>
                            : <span className="text-muted-foreground/50 text-[10px]">—</span>
                        })()}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {u.sessions.length === 1 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDisconnect(u.sessions[0].Name) }}
                            disabled={disconnect.isPending}
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-red-400 disabled:opacity-40 px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
                          >
                            <Trash2 size={10} />
                            Disconnect
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && u.sessions.map((s, i) => {
                      const sessionThreads = threadBySessionId[s.Name] ?? []
                      return (
                        <tr key={s.Name} className="border-b border-border/30 bg-muted/10">
                          <td colSpan={4} className="px-6 py-1">
                            <div className="text-[10px] text-muted-foreground space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">ID:</span>
                                <span className="font-mono">{s.Name}</span>
                                {s.Active && <span className="text-emerald-500 text-[9px] flex items-center gap-0.5"><Activity size={9} /> Active</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">App:</span>
                                <span>{s.Application ?? '—'}</span>
                              </div>
                              {sessionThreads.length > 0 && sessionThreads.map(t => (
                                <div key={t.Name} className="flex items-center gap-2 pl-2 border-l-2 border-border mt-0.5">
                                  <span className="font-medium text-[9px]">Thread:</span>
                                  <span className="font-mono">{t.Name?.slice(0, 12)}..</span>
                                  <span className={cn(
                                    'text-[9px] px-1 rounded',
                                    t.State === 'Running' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'
                                  )}>{t.State ?? '—'}</span>
                                  <span className="text-[9px] text-muted-foreground">{t.Function ?? ''}</span>
                                  <button
                                    onClick={() => handleCancelThread(t.Name)}
                                    disabled={cancelThread.isPending}
                                    className="ml-auto inline-flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-red-400 disabled:opacity-40 px-1 py-0.5 rounded hover:bg-muted transition-colors"
                                  >
                                    <Ban size={9} />
                                    Cancel
                                  </button>
                                </div>
                              ))}
                              <div className="flex gap-2 pt-0.5">
                                <button
                                  onClick={() => handleDisconnect(s.Name)}
                                  disabled={disconnect.isPending}
                                  className="inline-flex items-center gap-1 text-[9px] text-muted-foreground hover:text-red-400 disabled:opacity-40 px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
                                >
                                  <Trash2 size={9} />
                                  Disconnect session
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
