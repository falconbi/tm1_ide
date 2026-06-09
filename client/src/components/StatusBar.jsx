import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Activity, FolderOpen, Users, Clock, Circle, X } from 'lucide-react'
import { useStore } from '@/store'
import { useJobs, useFilesAvailable, useActiveWorkSession, useStartWorkSession, useCloseWorkSession } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import JobsMonitor from '@/components/JobsMonitor'
import FileManager from '@/components/FileManager'
import SessionsMonitor from '@/components/SessionsMonitor'
import ChangeLogPanel from '@/components/ChangeLogPanel'

function StartSessionModal({ server, onClose, onStart }) {
  const [name, setName] = useState('')
  const start = useStartWorkSession()

  const handleStart = async () => {
    if (!name.trim()) return
    await start.mutateAsync({ name: name.trim(), server, user: 'jdlove' })
    onStart?.()
    onClose()
  }

  return (
    <div className="absolute bottom-8 right-0 w-72 bg-popover border border-border rounded-lg shadow-xl z-50 p-3">
      <div className="text-xs font-semibold mb-2">Start Work Session</div>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleStart(); if (e.key === 'Escape') onClose() }}
        placeholder="e.g. budget-v1, apportionment-fix…"
        className="w-full bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring mb-2"
      />
      <div className="flex gap-1.5 justify-end">
        <button onClick={onClose} className="px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted">Cancel</button>
        <button onClick={handleStart} disabled={!name.trim() || start.isPending}
          className="px-2.5 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">
          Start
        </button>
      </div>
    </div>
  )
}

export default function StatusBar() {
  const { server, tabs, activeTab } = useStore()
  const tab        = tabs.find(t => t.id === activeTab)
  const dirtyCount = tabs.filter(t => t.dirty).length

  const [showJobs,       setShowJobs]       = useState(false)
  const [showFiles,      setShowFiles]      = useState(false)
  const [showSessions,   setShowSessions]   = useState(false)
  const [showLog,        setShowLog]        = useState(false)
  const [showStartModal, setShowStartModal] = useState(false)

  const jobs    = useJobs(server, { refetchInterval: 10_000 })
  const entries = (jobs.data?.items ?? jobs.data) ?? []
  const running = Array.isArray(entries) ? entries.filter(j => (j.Status ?? j.StatusMessage ?? '').toLowerCase() === 'running') : []
  const v12only = jobs.data?.v12only

  const { data: filesAvailable }  = useFilesAvailable(server)

  useEffect(() => {
    const handler = () => toast.info('No active session — start one to track this change', { id: 'no-session-nudge', duration: 4000 })
    window.addEventListener('tm1-no-session', handler)
    return () => window.removeEventListener('tm1-no-session', handler)
  }, [])
  const { data: activeSession }   = useActiveWorkSession(server)
  const closeSession = useCloseWorkSession()

  const handleCloseSession = async () => {
    if (!activeSession) return
    await closeSession.mutateAsync({ id: activeSession.id })
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-3 px-3 py-0.5 bg-primary text-primary-foreground text-xs shrink-0 select-none">
        <span className="font-medium">{server ?? 'No server selected'}</span>

        {tab && (
          <span className="opacity-60">
            │ {tab.type === 'rules' ? `Rules: ${tab.cube}` : tab.type === 'process' ? `Process: ${tab.name}` : tab.label ?? tab.type}
            {tab.dirty && <span className="ml-1.5 text-orange-300">● unsaved</span>}
          </span>
        )}

        {dirtyCount > 1 && <span className="opacity-60">│ {dirtyCount} unsaved tabs</span>}

        <span className="ml-auto" />

        {/* Work session indicator */}
        {server && (
          activeSession ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setShowLog(v => !v); setShowStartModal(false) }}
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
                  showLog ? 'bg-white/20 text-primary-foreground' : 'text-emerald-300 hover:bg-white/10'
                )}
                title="View change log"
              >
                <Circle size={7} className="fill-emerald-400 text-emerald-400 animate-pulse" />
                <Clock size={9} />
                <span className="font-medium max-w-[120px] truncate">{activeSession.name}</span>
              </button>
              <button
                onClick={handleCloseSession}
                title="Close session"
                className="p-0.5 rounded hover:bg-white/10 text-primary-foreground/50 hover:text-primary-foreground transition-colors"
              >
                <X size={9} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setShowStartModal(v => !v); setShowLog(false) }}
              title="Start a work session to log changes"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-primary-foreground/40 hover:text-primary-foreground/70 hover:bg-white/10 transition-colors"
            >
              <Clock size={9} />
              <span>No session</span>
            </button>
          )
        )}

        {/* Sessions */}
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

        {/* Jobs */}
        {server && !v12only && (
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

      {showStartModal && server && <StartSessionModal server={server} onClose={() => setShowStartModal(false)} onStart={() => setShowLog(true)} />}
      {showLog        && server && <ChangeLogPanel   server={server} onClose={() => setShowLog(false)}        />}
      {showJobs       && server && <JobsMonitor      server={server} onClose={() => setShowJobs(false)}       />}
      {showFiles      && server && <FileManager      server={server} onClose={() => setShowFiles(false)}      />}
      {showSessions   && server && <SessionsMonitor  server={server} onClose={() => setShowSessions(false)}   />}
    </div>
  )
}
