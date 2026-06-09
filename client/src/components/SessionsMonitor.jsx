import { X, RefreshCw, Loader2, Users, ShieldCheck, User } from 'lucide-react'
import { useSessions } from '@/hooks/useApi'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

export default function SessionsMonitor({ server, onClose }) {
  const qc = useQueryClient()
  const { data = [], isFetching, error } = useSessions(server, { refetchInterval: 30_000 })

  // Group by user name
  const grouped = data.reduce((acc, s) => {
    const name = s.User?.Name ?? 'Unknown'
    if (!acc[name]) acc[name] = { name, friendlyName: s.User?.FriendlyName ?? name, type: s.User?.Type ?? '', count: 0, active: false }
    acc[name].count++
    if (s.Active) acc[name].active = true
    return acc
  }, {})
  const users = Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="absolute bottom-6 right-0 w-[360px] bg-popover border border-border rounded-lg shadow-xl z-50 flex flex-col overflow-hidden" style={{ maxHeight: 320 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <Users size={13} className="text-muted-foreground" />
          <span className="text-xs font-semibold">Active Sessions</span>
          {!isFetching && <span className="text-[10px] text-muted-foreground/60">({users.length} user{users.length !== 1 ? 's' : ''})</span>}
          {isFetching && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => qc.invalidateQueries({ queryKey: ['sessions', server] })}
            disabled={isFetching}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">
            <RefreshCw size={11} />
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="overflow-auto flex-1">
        {error && <p className="px-4 py-6 text-xs text-red-400 text-center">{error.message}</p>}
        {!error && users.length === 0 && !isFetching && (
          <p className="px-4 py-6 text-xs text-muted-foreground italic text-center">No active sessions.</p>
        )}
        {!error && users.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">User</th>
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.name} className={cn('border-b border-border/50 hover:bg-muted/30', i % 2 !== 0 && 'bg-muted/10')}>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      {u.type === 'Admin' ? <ShieldCheck size={11} className="shrink-0 text-amber-500" /> : <User size={11} className="shrink-0 text-muted-foreground" />}
                      <span className="font-medium font-mono">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{u.type || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
