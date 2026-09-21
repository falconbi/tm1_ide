import { useEffect, useState } from 'react'
import { X, Rocket, History, FolderArchive, HardDriveDownload, Loader2, CheckCircle2, HelpCircle } from 'lucide-react'
import HelpPanel from '@/components/HelpPanel'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useServers, useDeployBaseline, useDeploySeed } from '@/hooks/useApi'
import DeployPanel from '@/components/DeployPanel'
import DeployHistory from '@/components/DeployHistory'
import ImportPackagePanel from '@/components/ImportPackagePanel'
import DiffTab from '@/components/DiffTab'

// A full-screen takeover for everything deploy-related — not a tab. While
// this is open, the entire normal IDE (sidebar, tab bar, every open editor)
// is hidden; closing it restores the IDE exactly as it was, since tab/group
// state in the store is untouched by this.

const NAV = [
  { id: 'wizard',    label: 'New Deploy', icon: Rocket },
  { id: 'history',   label: 'History',    icon: History },
  { id: 'import',    label: 'Import',     icon: FolderArchive },
  { id: 'baselines', label: 'Baselines',  icon: HardDriveDownload, title: 'Bootstrap or recover a baseline — deploys keep this current automatically, not a normal step' },
]

function BaselinesView({ defaultServer }) {
  const { data: servers }   = useServers()
  const [target, setTarget] = useState(defaultServer ?? '')
  const { data: baseline }  = useDeployBaseline(target)
  const seedMut             = useDeploySeed()
  const serverList = (servers?.value ?? servers ?? []).map(s => s.name ?? s).filter(Boolean)

  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="max-w-lg mx-auto flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold mb-1">Bootstrap or recover a baseline</h2>
          <p className="text-xs text-muted-foreground">
            Every clean deploy already re-seeds both ends automatically, stamped to the exact
            change-log position it shipped — you shouldn't need this in the normal build → deploy
            loop. It's here for two situations only: a server that's never had a baseline yet
            (nothing to diff or drift-check against), or one that's gotten out of step — e.g.
            someone edited the target outside the pipeline — where you need to force it back
            in sync by hand.
          </p>
        </div>
        <select
          value={target}
          onChange={e => setTarget(e.target.value)}
          className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Select server…</option>
          {serverList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {target && (
          baseline?.exists ? (
            <div className="text-xs bg-muted/40 rounded px-3 py-2 flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
              <span className="text-muted-foreground">
                Already seeded — last from <span className="text-foreground">{baseline.seeded_at?.slice(0, 10)}</span> via{' '}
                <span className="font-mono text-foreground">{baseline.server}</span>
                {baseline.counts && (
                  <span className="text-muted-foreground/60"> · {baseline.counts.cubes}c {baseline.counts.dimensions}d {baseline.counts.processes}p</span>
                )}
                . Deploys keep this current on their own — only force a reseed if you know it's out of sync.
              </span>
            </div>
          ) : (
            <div className="text-xs text-amber-400 bg-amber-500/10 rounded px-3 py-2">
              No baseline yet for "{target}" — seed one to bootstrap the pipeline for this server.
            </div>
          )
        )}
        <button
          disabled={!target || seedMut.isPending}
          onClick={async () => {
            try {
              const r = await seedMut.mutateAsync({ server: target })
              toast.success(`Baseline seeded from ${target} — ${r.counts.cubes} cubes, ${r.counts.dimensions} dims, ${r.counts.processes} processes`)
            } catch (e) { toast.error(e.message ?? 'Seed failed') }
          }}
          className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          {seedMut.isPending
            ? <><Loader2 size={13} className="animate-spin" /> Seeding…</>
            : baseline?.exists
              ? <><HardDriveDownload size={13} /> Force reseed</>
              : <><HardDriveDownload size={13} /> Seed now (bootstrap)</>}
        </button>
      </div>
    </div>
  )
}

export default function DeployCenter() {
  const { deployCenter, closeDeployCenter, server: currentServer } = useStore()
  const [view, setView] = useState(deployCenter?.view ?? 'wizard')
  // Diff views opened from inside the takeover (Package Contents row click,
  // Target State snapshot diff) can't go through the normal tab system — that's
  // hidden behind this overlay. Shown as a second overlay, above this one.
  const [diffTab, setDiffTab] = useState(null)
  const [showHelp, setShowHelp] = useState(false)

  // A fresh openDeployCenter() call is a new object each time — use that to
  // reset which rail view is showing, per how this particular open was triggered.
  useEffect(() => {
    if (deployCenter) setView(deployCenter.view ?? 'wizard')
  }, [deployCenter])

  if (!deployCenter) return null

  const title = view !== 'wizard'
    ? NAV.find(n => n.id === view)?.label
    : deployCenter.importDir  ? 'Import Package'
    : deployCenter.session    ? deployCenter.session.name
    : 'Release'

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
        <Rocket size={15} className="text-emerald-500" />
        <span className="font-semibold text-sm tracking-tight">Deploy</span>
        <span className="text-xs text-muted-foreground">— {title}</span>
        {deployCenter.server && <span className="text-xs text-muted-foreground/60 ml-1">{deployCenter.server}</span>}
        <button
          onClick={() => setShowHelp(true)}
          className="ml-auto p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Help — Deploy Pipeline"
        >
          <HelpCircle size={13} />
        </button>
        <button
          onClick={closeDeployCenter}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Close — back to the IDE"
        >
          <X size={13} /> Close
        </button>
      </div>
      <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="deploy" />

      <div className="flex flex-1 min-h-0">
        {/* Rail */}
        <div className="w-44 shrink-0 border-r border-border/50 flex flex-col py-3 gap-0.5">
          {NAV.map(n => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              title={n.title}
              className={cn('flex items-center gap-2 px-4 py-2 text-xs text-left transition-colors',
                view === n.id ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}
            >
              <n.icon size={13} /> {n.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-hidden flex justify-center">
          <div className="w-full max-w-4xl min-w-0 flex flex-col">
            {view === 'wizard'    && <DeployPanel tab={deployCenter} onOpenDiff={setDiffTab} />}
            {view === 'history'   && <DeployHistory onOpenDiff={setDiffTab} />}
            {view === 'import'    && <ImportPackagePanel />}
            {view === 'baselines' && <BaselinesView defaultServer={deployCenter.server ?? currentServer} />}
          </div>
        </div>
      </div>

      {diffTab && (
        <div className="fixed inset-0 z-[110] flex flex-col bg-background text-foreground">
          <div className="flex items-center justify-between px-5 py-2 border-b border-border shrink-0">
            <span className="text-xs font-semibold">{diffTab.label ?? 'Diff'}</span>
            <button
              onClick={() => setDiffTab(null)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Close diff"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <DiffTab tab={diffTab} />
          </div>
        </div>
      )}
    </div>
  )
}
