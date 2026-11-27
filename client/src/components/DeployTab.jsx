import { useState, useEffect } from 'react'
import { History, FileCode2, GitCompare, Activity, GitBranch, HelpCircle, Rocket, RefreshCw, ServerCog } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { useChangeSetSummary, useServerLogins } from '@/hooks/useApi'
import HelpPanel from '@/components/HelpPanel'
import DeployHistory from '@/components/DeployHistory'
import LensDeploy from '@/components/LensDeploy'
import GitDrift from '@/components/GitDrift'
import ModelHealth from '@/components/ModelHealth'
import GitSetup from '@/components/GitSetup'
import DeployRelease from '@/components/DeployRelease'
import DeploySync from '@/components/DeploySync'
import DeployAdmin from '@/components/DeployAdmin'

const NAV = [
  { id: 'release',   label: 'Ready to deploy', icon: Rocket, title: 'Change sets that can be released and deployed' },
  { id: 'history',   label: 'History',      icon: History },
  { id: 'lenses',    label: 'Lenses',       icon: FileCode2, title: 'Ship model-owned Lenses to a target' },
  { id: 'drift',     label: 'Drift',        icon: GitCompare, title: 'Compare a target with the version it was last given' },
  { id: 'health',    label: 'Model health', icon: Activity, title: 'Run the model tests and check readiness' },
  { id: 'sync',      label: 'Sync DEV',      icon: RefreshCw, title: 'Bring PROD\'s own changes onto DEV, separately from a deploy' },
  { id: 'setup',     label: 'GitHub setup', icon: GitBranch, title: 'Link a server to a GitHub repository' },
  { id: 'admin',     label: 'Admin',         icon: ServerCog, title: 'Re-clone TEST, start again, or prepare DEV for restore' },
]

export default function DeployTab() {
  const { server } = useStore()
  const [view, setView] = useState(() => useStore.getState().deployView ?? 'release')
  const [showHelp, setShowHelp] = useState(false)
  const deployView = useStore(s => s.deployView)
  // A screen can send the person here on a named view (Part Q / pre-deploy check).
  useEffect(() => {
    if (!deployView) return
    setView(deployView)
    useStore.getState().setDeployView(null)
  }, [deployView])
  // Same shared definition the Release screen uses, so the badge cannot lie.
  const { ready } = useChangeSetSummary(server)
  // The three resets are server-admin actions; hide the tab from everyone else.
  // Sync DEV is admin-only server-side too (it writes to DEV and needs admin on both).
  const { data: logins = [] } = useServerLogins()
  const isAdmin = logins.some(l => String(l?.name ?? '').toLowerCase() === String(server ?? '').toLowerCase() && l?.isAdmin)
  const nav = isAdmin ? NAV : NAV.filter(n => n.id !== 'admin' && n.id !== 'sync')

  if (!server) return <div className="p-4 text-sm text-muted-foreground">Select a server first.</div>

  const title = nav.find(n => n.id === view)?.label ?? 'History'
  const openAssertions = () => window.dispatchEvent(new CustomEvent('tm1-open-assertions'))

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 bg-card">
        <span className="font-semibold text-sm tracking-tight">Deploy</span>
        <span className="text-xs text-muted-foreground">— {title}</span>
        <span className="text-xs text-muted-foreground/60">{server}</span>
        <button
          onClick={() => setShowHelp(true)}
          className="ml-auto p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Help — Deploy"
        >
          <HelpCircle size={13} />
        </button>
      </div>
      <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="deploy" />

      <div className="flex flex-1 min-h-0">
        <div className="w-44 shrink-0 border-r border-border/50 flex flex-col py-3 gap-0.5 overflow-y-auto">
          {nav.map(n => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              title={n.title}
              className={cn('flex items-center gap-2 px-4 py-2 text-xs text-left transition-colors',
                view === n.id ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}
            >
              <n.icon size={13} /> {n.label}
              {n.id === 'release' && ready.length > 0 && (
                <span className="ml-auto text-[9px] px-1 py-0.5 rounded bg-emerald-700/20 text-emerald-600 font-medium">{ready.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0 overflow-hidden flex justify-center">
          <div className="w-full max-w-4xl min-w-0 flex flex-col">
            {view === 'release'   && <DeployRelease key={`release:${server}`} server={server} />}
            {view === 'history'   && <DeployHistory key={`history:${server}`} />}
            {view === 'lenses'    && <LensDeploy key={`lenses:${server}`} source={server} />}
            {view === 'drift'     && <GitDrift key={`drift:${server}`} server={server} embedded onClose={() => {}} />}
            {view === 'health'    && <ModelHealth key={`health:${server}`} server={server} embedded onClose={() => {}} onOpenAssertions={openAssertions} />}
            {view === 'sync' && isAdmin && <DeploySync key={`sync:${server}`} source={server} />}
            {view === 'sync' && !isAdmin && (
              <p className="p-6 text-xs text-muted-foreground">
                Sync DEV from PROD is an admin action — it writes to {server} and needs admin on {server} and the target.
                Ask an admin to run it.
              </p>
            )}
            {view === 'setup'     && <GitSetup key={`setup:${server}`} server={server} embedded onClose={() => {}} />}
            {view === 'admin' && isAdmin && <DeployAdmin key={`admin:${server}`} server={server} />}
          </div>
        </div>
      </div>
    </div>
  )
}
