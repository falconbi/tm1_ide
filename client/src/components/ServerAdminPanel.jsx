import { useState } from 'react'
import { X, RefreshCw, Loader2, ShieldAlert, ShieldCheck, Server, Settings, BarChart3, Users, UserX } from 'lucide-react'
import { useServerMetrics, useActiveConfiguration, useMaintenanceMode, useSessions, useDisconnectSession } from '@/hooks/useApi'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(n) {
  if (n == null) return '—'
  const mb = n / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`
}

function fmtDuration(iso) {
  if (!iso) return '—'
  const m = iso.match(/P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?/)
  if (!m) return iso
  const parts = []
  if (m[1]) parts.push(`${m[1]}d`)
  if (m[2]) parts.push(`${m[2]}h`)
  if (m[3]) parts.push(`${m[3]}m`)
  return parts.join(' ') || iso
}

function MetricCard({ label, value, sub }) {
  return (
    <div className="bg-muted/30 border border-border rounded p-3 space-y-0.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-lg font-semibold font-mono text-foreground leading-tight">{value ?? '—'}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

function ConfigTree({ data, depth = 0 }) {
  if (!data || typeof data !== 'object') {
    return <span className="font-mono text-foreground/80">{String(data)}</span>
  }
  return (
    <div className={cn(depth > 0 && 'ml-4 border-l border-border/40 pl-2')}>
      {Object.entries(data)
        .filter(([k]) => !k.startsWith('@'))
        .map(([k, v]) => (
          <div key={k} className="py-0.5">
            <span className="text-muted-foreground">{k}: </span>
            {typeof v === 'object' && v !== null
              ? <ConfigTree data={v} depth={depth + 1} />
              : <span className="font-mono text-foreground/80 break-all">{String(v)}</span>
            }
          </div>
        ))}
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'status',   label: 'Status',        icon: BarChart3 },
  { id: 'sessions', label: 'Sessions',      icon: Users     },
  { id: 'config',   label: 'Configuration', icon: Settings  },
]

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function ServerAdminPanel({ server, onClose }) {
  const [tab, setTab]         = useState('status')
  const qc                    = useQueryClient()
  const metrics               = useServerMetrics(server, { refetchInterval: 30_000 })
  const config                = useActiveConfiguration(server)
  const maintenance           = useMaintenanceMode()
  const sessions              = useSessions(server, { refetchInterval: tab === 'sessions' ? 10_000 : false })
  const disconnect            = useDisconnectSession()
  const [disconnecting, setDisconnecting] = useState(null)

  const m   = metrics.data ?? {}
  const cfg = config.data  ?? {}

  // Maintenance mode state lives in config
  const inMaintenance = cfg?.Administration?.MaintenanceMode === true
    || cfg?.MaintenanceMode === true
    || cfg?.Server?.MaintenanceMode === true

  const handleMaintenance = async (enable) => {
    try {
      await maintenance.mutateAsync({ server, enable })
      toast.success(enable ? 'Maintenance mode enabled' : 'Maintenance mode disabled')
      qc.invalidateQueries({ queryKey: ['config', server] })
    } catch (e) {
      toast.error(e.message)
    }
  }

  const handleDisconnect = async (id, user) => {
    try {
      await disconnect.mutateAsync({ server, id })
      toast.success(`Disconnected: ${user}`)
      setDisconnecting(null)
      qc.invalidateQueries({ queryKey: ['sessions', server] })
    } catch (e) {
      toast.error(`Disconnect failed: ${e.message}`)
    }
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['metrics', server] })
    qc.invalidateQueries({ queryKey: ['config',   server] })
    qc.invalidateQueries({ queryKey: ['sessions', server] })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="bg-background border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 740, height: 560 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Server size={13} className="text-muted-foreground" />
            <span className="text-sm font-semibold">Server Admin</span>
            <span className="text-xs text-muted-foreground font-mono">— {server}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={refresh} title="Refresh" className="p-1 rounded text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors">
              {(metrics.isFetching || config.isFetching) ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
            <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border shrink-0 px-4 gap-1 pt-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs border-b-2 transition-colors',
                tab === t.id
                  ? 'border-primary text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <t.icon size={11} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto p-5">

          {/* ── Status tab ── */}
          {tab === 'status' && (
            <div className="space-y-5">

              {/* Maintenance mode */}
              <div className={cn(
                'flex items-center justify-between p-4 rounded-lg border',
                inMaintenance
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-emerald-500/30 bg-emerald-500/5'
              )}>
                <div className="flex items-center gap-3">
                  {inMaintenance
                    ? <ShieldAlert size={18} className="text-amber-400 shrink-0" />
                    : <ShieldCheck size={18} className="text-emerald-400 shrink-0" />}
                  <div>
                    <div className="text-sm font-semibold">
                      {inMaintenance ? 'Maintenance Mode Active' : 'Server Online'}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {inMaintenance
                        ? 'Only admins can connect. Safe to deploy changes.'
                        : 'All users can connect normally.'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleMaintenance(!inMaintenance)}
                  disabled={maintenance.isPending || config.isLoading}
                  className={cn(
                    'px-4 py-2 text-xs rounded font-medium disabled:opacity-40 transition-colors',
                    inMaintenance
                      ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                      : 'bg-amber-600 text-white hover:bg-amber-500'
                  )}
                >
                  {maintenance.isPending
                    ? <Loader2 size={11} className="animate-spin mx-auto" />
                    : inMaintenance ? 'Disable Maintenance' : 'Enable Maintenance'
                  }
                </button>
              </div>

              {/* Metrics grid */}
              {metrics.isError && (
                <p className="text-xs text-amber-400">Metrics unavailable: {metrics.error?.message}</p>
              )}
              {!metrics.isError && (
                <div className="grid grid-cols-3 gap-3">
                  <MetricCard label="Memory Used"      value={fmtBytes(m.MemoryUsed ?? m.ServerRAMUsed)}    />
                  <MetricCard label="Thread Count"     value={m.ThreadCount ?? m.Threads ?? '—'}             />
                  <MetricCard label="Uptime"           value={fmtDuration(m.ServerUpTime ?? m.UpTime)}       />
                  <MetricCard label="Cells Calculated" value={m.CellsCalculated?.toLocaleString() ?? '—'}    />
                  <MetricCard label="Feeders"          value={m.FeedersCalculated?.toLocaleString() ?? '—'}  />
                  <MetricCard label="Active Sessions"  value={m.ActiveSessionCount ?? m.Sessions ?? '—'}     />
                </div>
              )}
            </div>
          )}

          {/* ── Sessions tab ── */}
          {tab === 'sessions' && (
            <div>
              {sessions.isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                  <Loader2 size={11} className="animate-spin" /> Loading sessions…
                </div>
              )}
              {sessions.isError && (
                <p className="text-xs text-red-400">{sessions.error?.message ?? 'Failed to load sessions'}</p>
              )}
              {!sessions.isLoading && !sessions.isError && (sessions.data ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground italic py-4">No active sessions found.</p>
              )}
              {(sessions.data ?? []).length > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground mb-3">
                    {sessions.data.length} active session{sessions.data.length !== 1 ? 's' : ''} — auto-refreshes every 10 seconds
                  </p>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">User</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">IP Address</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Client</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Connected</th>
                        <th className="text-left py-2 font-medium text-muted-foreground">Last Activity</th>
                        <th className="w-24 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.data.map((s, i) => {
                        const id       = s.ID ?? s.SessionID ?? i
                        const user     = s.UserName ?? s.User ?? '—'
                        const ip       = s.IPAddress ?? s.ClientIPAddress ?? '—'
                        const client   = s.ClientType ?? s.ApplicationName ?? '—'
                        const connAt   = s.ConnectedAt ?? s.LoginAt ?? s.CreatedAt
                        const lastCall = s.LastAPICall ?? s.LastActivity ?? s.LastRequest
                        return (
                          <tr key={id} className="border-b border-border/30 hover:bg-muted/20 group">
                            <td className="py-2 pr-4 font-medium">{user}</td>
                            <td className="py-2 pr-4 font-mono text-muted-foreground">{ip}</td>
                            <td className="py-2 pr-4 text-muted-foreground">{client}</td>
                            <td className="py-2 pr-4 text-muted-foreground font-mono whitespace-nowrap">
                              {connAt ? new Date(connAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                            </td>
                            <td className="py-2 text-muted-foreground font-mono whitespace-nowrap">
                              {lastCall ? new Date(lastCall).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                            </td>
                            <td className="py-2 pl-2">
                              {disconnecting === id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleDisconnect(id, user)}
                                    disabled={disconnect.isPending}
                                    className="px-1.5 py-0.5 text-[10px] rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-40"
                                  >Confirm</button>
                                  <button
                                    onClick={() => setDisconnecting(null)}
                                    className="px-1.5 py-0.5 text-[10px] rounded border border-border hover:bg-muted"
                                  >Cancel</button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setDisconnecting(id)}
                                  title={`Disconnect ${user}`}
                                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/40 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  <UserX size={10} /> Kick
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Configuration tab ── */}
          {tab === 'config' && (
            <div>
              {config.isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                  <Loader2 size={11} className="animate-spin" /> Loading configuration…
                </div>
              )}
              {config.isError && (
                <p className="text-xs text-red-400">{config.error?.message ?? 'Failed to load configuration'}</p>
              )}
              {!config.isLoading && !config.isError && (
                <div className="text-[11px] leading-relaxed">
                  <p className="text-[10px] text-muted-foreground mb-3 italic">Active configuration — read only. Changes require StaticConfiguration PATCH or server restart.</p>
                  <ConfigTree data={cfg} />
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
