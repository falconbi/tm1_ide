import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Activity, FolderOpen, Users } from 'lucide-react'
import { useStore } from '@/store'
import { useJobs, useFilesAvailable } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import JobsMonitor from '@/components/JobsMonitor'
import FileManager from '@/components/FileManager'
import SessionsMonitor from '@/components/SessionsMonitor'

export default function StatusBar() {
  const { server, tabs, activeTab } = useStore()
  const tab        = tabs.find(t => t.id === activeTab)
  const dirtyCount = tabs.filter(t => t.dirty).length

  const [showJobs,     setShowJobs]     = useState(false)
  const [showFiles,    setShowFiles]    = useState(false)
  const [showSessions, setShowSessions] = useState(false)

  const jobs    = useJobs(server, { refetchInterval: 10_000 })
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
        <span className="font-medium">{server ?? 'No server selected'}</span>

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

        <a
          href="https://falconbi.github.io/tm1_ide/"
          target="_blank"
          rel="noreferrer"
          title="Documentation"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-amber-400/70 hover:text-amber-300 hover:bg-white/10 transition-colors"
        >
          Docs
        </a>

        <span className="opacity-40">TM1 IDE</span>
      </div>

      {showJobs     && server && <JobsMonitor     server={server} onClose={() => setShowJobs(false)}     />}
      {showFiles      && server && <FileManager      server={server} onClose={() => setShowFiles(false)}      />}
      {showSessions   && server && <SessionsMonitor  server={server} onClose={() => setShowSessions(false)}   />}
    </div>
  )
}
