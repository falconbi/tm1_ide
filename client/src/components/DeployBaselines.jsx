import { useState } from 'react'
import { HardDriveDownload, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useServers, useDeployBaseline, useDeploySeed } from '@/hooks/useApi'

export default function DeployBaselines({ defaultServer }) {
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
