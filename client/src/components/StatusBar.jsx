import { useState } from 'react'
import { Activity, Server, FolderOpen } from 'lucide-react'
import { useStore } from '@/store'
import { useJobs } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import JobsMonitor from '@/components/JobsMonitor'
import ServerAdminPanel from '@/components/ServerAdminPanel'
import FileManager from '@/components/FileManager'

export default function StatusBar() {
  const { server, tabs, activeTab } = useStore()
  const tab        = tabs.find(t => t.id === activeTab)
  const dirtyCount = tabs.filter(t => t.dirty).length
  const [showJobs,  setShowJobs]  = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showFiles, setShowFiles] = useState(false)

  // Poll jobs only when a server is connected — light 10s poll for the indicator
  const jobs    = useJobs(server, { refetchInterval: 10_000 })
  const entries = jobs.data ?? []
  const running = entries.filter(j => (j.Status ?? j.StatusMessage ?? '').toLowerCase() === 'running')

  return (
    <>
      <div className="flex items-center gap-4 px-3 py-0.5 bg-primary text-primary-foreground text-xs shrink-0 select-none">
        <span className="font-medium">{server ?? 'No server selected'}</span>

        {tab && (
          <span className="opacity-60">
            │ {tab.type === 'rules' ? `Rules: ${tab.cube}` : tab.type === 'process' ? `Process: ${tab.name}` : tab.label ?? tab.type}
            {tab.dirty && <span className="ml-1.5 text-orange-300">● unsaved</span>}
          </span>
        )}

        {dirtyCount > 1 && (
          <span className="opacity-60">│ {dirtyCount} unsaved tabs</span>
        )}

        <span className="ml-auto" />

        {/* Jobs indicator */}
        {server && (
          <button
            onClick={() => setShowJobs(true)}
            title="Jobs Monitor — view and cancel running processes"
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
              running.length > 0
                ? 'text-emerald-300 hover:bg-white/10'
                : 'text-primary-foreground/40 hover:text-primary-foreground/70 hover:bg-white/10'
            )}
          >
            <Activity size={10} className={cn(running.length > 0 && 'animate-pulse')} />
            {running.length > 0
              ? <span className="font-medium">{running.length} running</span>
              : <span>Jobs</span>
            }
          </button>
        )}

        {server && (
          <button
            onClick={() => setShowFiles(true)}
            title="File Manager — browse and upload TM1 server files"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-primary-foreground/40 hover:text-primary-foreground/70 hover:bg-white/10 transition-colors"
          >
            <FolderOpen size={10} />
            <span>Files</span>
          </button>
        )}

        {server && (
          <button
            onClick={() => setShowAdmin(true)}
            title="Server Admin — metrics, configuration, maintenance mode"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-primary-foreground/40 hover:text-primary-foreground/70 hover:bg-white/10 transition-colors"
          >
            <Server size={10} />
            <span>Admin</span>
          </button>
        )}

        <span className="opacity-40">TM1 IDE</span>
      </div>

      {showJobs  && server && <JobsMonitor      server={server} onClose={() => setShowJobs(false)}  />}
      {showAdmin && server && <ServerAdminPanel server={server} onClose={() => setShowAdmin(false)} />}
      {showFiles && server && <FileManager      server={server} onClose={() => setShowFiles(false)} />}
    </>
  )
}
