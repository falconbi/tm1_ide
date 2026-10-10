import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Activity, FolderOpen, Users, Lock, Server, LogOut } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@/store'
import { useJobs, useFilesAvailable, useServers, useConfig, useServerLogins, useActiveWorkSession, serverLogout } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import { serverCapabilities } from '@/lib/tm1-version'
import JobsMonitor from '@/components/JobsMonitor'
import FileManager from '@/components/FileManager'
import SessionsMonitor from '@/components/SessionsMonitor'
import ServerAdminPanel from '@/components/ServerAdminPanel'

export default function StatusBar() {
  const { server, serverVersion, tabs, activeTab } = useStore()
  const caps       = serverCapabilities(serverVersion)
  const tab        = tabs.find(t => t.id === activeTab)
  const dirtyCount = tabs.filter(t => t.dirty).length

  const { data: servers = [] } = useServers()
  const activeServer = servers.find(s => (typeof s === 'string' ? s : s.name) === server)
  const readOnly = server ? (typeof activeServer === 'string' ? false : !!activeServer?.readOnly) : false

  // The identity that owns change sets on this server (case-insensitive name match) —
  // show it so edits are always attributable to the person signed in to the server.
  const { data: logins = [] } = useServerLogins()
  const serverUser = logins.find(l => String(l?.name ?? '').toLowerCase() === String(server ?? '').toLowerCase())?.username ?? null
  const { data: activeSession } = useActiveWorkSession(server)
  const qc = useQueryClient()

  const [showJobs,     setShowJobs]     = useState(false)
  const [showFiles,    setShowFiles]    = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [showAdmin,    setShowAdmin]    = useState(false)

  // V11 has no Jobs endpoint — don't poll it every 10s just to get a 404.
  const jobs    = useJobs(server, { refetchInterval: 10_000, enabled: !!server && caps.jobs })
  const entries = (jobs.data?.items ?? jobs.data) ?? []
  const running = Array.isArray(entries) ? entries.filter(j => (j.Status ?? j.StatusMessage ?? '').toLowerCase() === 'running') : []
  const v12only = jobs.data?.v12only

  const { data: filesAvailable }  = useFilesAvailable(server)

  useEffect(() => {
    const handler = () => toast.info('No active change set — start one to track this change', { id: 'no-session-nudge', duration: 4000 })
    window.addEventListener('tm1-no-session', handler)
    return () => window.removeEventListener('tm1-no-session', handler)
  }, [])
  return (
    <div className="relative">
      <div className="flex items-center gap-3 px-3 py-0.5 bg-primary text-primary-foreground text-xs shrink-0 select-none">
        <AccessBadge />
        <span className="font-medium flex items-center gap-1">
          {server ?? 'No server selected'}
          {serverUser && (
            <span title={`Signed in to ${server} as ${serverUser}`} className="opacity-70 text-[10px] font-normal">· as {serverUser}</span>
          )}
          {activeSession && (
            <span title={`Open change set: ${activeSession.name}`} className="opacity-70 text-[10px] font-normal">· set: {activeSession.name}</span>
          )}
          {serverUser && (
            <button
              onClick={() => serverLogout(server).then(() => qc.invalidateQueries()).catch(() => {})}
              title={`Sign out of ${server}`}
              className="opacity-60 hover:opacity-100 hover:text-white transition-opacity p-0.5 rounded hover:bg-white/15"
            >
              <LogOut size={10} />
            </button>
          )}
          {readOnly && (
            <span title="This server is read-only — edits are blocked" className="inline-flex items-center gap-0.5 bg-white/20 text-primary-foreground px-1 py-px rounded text-[9px] font-semibold">
              <Lock size={9} /> read-only
            </span>
          )}
        </span>

        {tab && (
          <span className="opacity-60">
            │ {tab.type === 'rules' ? `Rules: ${tab.cube}` : tab.type === 'process' ? `Process: ${tab.name}` : tab.label ?? tab.type}
            {tab.dirty && <span className="ml-1.5 text-orange-300">● unsaved</span>}
          </span>
        )}

        {dirtyCount > 1 && <span className="opacity-60">│ {dirtyCount} unsaved tabs</span>}

        <span className="ml-auto" />

        {/* TM1 Server Sessions */}
        {server && (
          <button
            onClick={() => setShowSessions(v => !v)}
            title="Active sessions — see who is connected"
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
              showSessions ? 'text-primary-foreground bg-white/20' : 'text-primary-foreground/40 hover:text-primary-foreground/70 hover:bg-white/10'
            )}
          >
            <Users size={10} />
            <span>Sessions</span>
          </button>
        )}

        {/* Server Admin */}
        {server && (
          <button
            onClick={() => setShowAdmin(v => !v)}
            title="Server Admin — configuration and sessions; status and maintenance mode on V12"
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
              showAdmin ? 'text-primary-foreground bg-white/20' : 'text-primary-foreground/40 hover:text-primary-foreground/70 hover:bg-white/10'
            )}
          >
            <Server size={10} />
            <span>Admin</span>
          </button>
        )}

        {/* Jobs */}
        {server && caps.jobs && !v12only && (
          <button
            onClick={() => setShowJobs(v => !v)}
            title="Jobs Monitor"
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
              running.length > 0 ? 'text-emerald-300 hover:bg-white/10' : 'text-primary-foreground/40 hover:text-primary-foreground/70 hover:bg-white/10'
            )}
          >
            <Activity size={10} className={cn(running.length > 0 && 'animate-pulse')} />
            {running.length > 0 ? <span className="font-medium">{running.length} running</span> : <span>Jobs</span>}
          </button>
        )}

        {/* Files */}
        {server && (
          filesAvailable === false ? (
            <span title="File browsing requires Planning Analytics v12" className="flex items-center gap-1 px-1.5 py-0.5 rounded text-primary-foreground/20 cursor-not-allowed line-through">
              <FolderOpen size={10} /><span>Files</span>
            </span>
          ) : (
            <button onClick={() => setShowFiles(v => !v)} title="Files"
              className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors', showFiles ? 'bg-white/20 text-primary-foreground' : 'text-primary-foreground/40 hover:text-primary-foreground/70 hover:bg-white/10')}>
              <FolderOpen size={10} /><span>Files</span>
            </button>
          )
        )}

        <span className="opacity-40">TM1 IDE</span>
      </div>

      {showJobs     && server && <JobsMonitor     server={server} onClose={() => setShowJobs(false)}     />}
      {showFiles      && server && <FileManager      server={server} onClose={() => setShowFiles(false)}      />}
      {showSessions   && server && <SessionsMonitor  server={server} onClose={() => setShowSessions(false)}   />}
      {showAdmin      && server && <ServerAdminPanel server={server} onClose={() => setShowAdmin(false)}      />}
    </div>
  )
}

// Who can reach this IDE: "Local only" (this machine, no IDE sign-in) or
// "Network" (reachable from other machines — IDE sign-in required).
function AccessBadge() {
  const { data: cfg } = useConfig()
  if (!cfg?.access) return null
  const network = cfg.access === 'network'
  return (
    <span
      title={network
        ? 'This IDE is reachable from other machines on the network (HOST in .env) — an IDE sign-in is required'
        : 'This IDE only accepts connections from this machine — no IDE sign-in; you sign in to each server'}
      className={cn('inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-semibold',
        network ? 'bg-amber-500/30' : 'bg-white/15')}>
      {network ? 'Network' : 'Local only'}
    </span>
  )
}
