import { useState } from 'react'
import { History, HardDriveDownload, FileCode2, GitCompare, Activity, GitBranch, HelpCircle, Rocket } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { useChangeSetSummary } from '@/hooks/useApi'
import HelpPanel from '@/components/HelpPanel'
import DeployHistory from '@/components/DeployHistory'
import LensDeploy from '@/components/LensDeploy'
import GitDrift from '@/components/GitDrift'
import ModelHealth from '@/components/ModelHealth'
import GitSetup from '@/components/GitSetup'
import DeployBaselines from '@/components/DeployBaselines'
import DeployRelease from '@/components/DeployRelease'

const NAV = [
  { id: 'release',   label: 'Release',      icon: Rocket, title: 'Deploy a closed change set' },
  { id: 'history',   label: 'History',      icon: History },
  { id: 'lenses',    label: 'Lenses',       icon: FileCode2, title: 'Ship model-owned Lenses to a target' },
  { id: 'baselines', label: 'Baselines',    icon: HardDriveDownload, title: 'Bootstrap or recover a baseline' },
  { id: 'drift',     label: 'Drift',        icon: GitCompare, title: 'Compare a target with the version it was last given' },
  { id: 'health',    label: 'Model health', icon: Activity, title: 'Run the model tests and check readiness' },
  { id: 'setup',     label: 'GitHub setup', icon: GitBranch, title: 'Link a server to a GitHub repository' },
]

export default function DeployTab() {
  const { server, openDeployWizard } = useStore()
  const [view, setView] = useState('release')
  const [showHelp, setShowHelp] = useState(false)
  // Same shared definition the Release screen uses, so the badge cannot lie.
  const { ready } = useChangeSetSummary(server)

  if (!server) return <div className="p-4 text-sm text-muted-foreground">Select a server first.</div>

  const title = NAV.find(n => n.id === view)?.label ?? 'History'
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
          <button
            onClick={() => openDeployWizard({ catchUp: true })}
            className="flex items-center gap-2 px-4 py-2 text-xs text-left text-amber-600 hover:text-amber-500 hover:bg-muted/50 transition-colors"
          >
            <GitBranch size={13} /> Catch up a server…
          </button>
          {NAV.map(n => (
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
            {view === 'baselines' && <DeployBaselines key={`baselines:${server}`} defaultServer={server} />}
            {view === 'drift'     && <GitDrift key={`drift:${server}`} server={server} embedded onClose={() => {}} />}
            {view === 'health'    && <ModelHealth key={`health:${server}`} server={server} embedded onClose={() => {}} onOpenAssertions={openAssertions} />}
            {view === 'setup'     && <GitSetup key={`setup:${server}`} server={server} embedded onClose={() => {}} />}
          </div>
        </div>
      </div>
    </div>
  )
}
