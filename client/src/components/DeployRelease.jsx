import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Rocket, Inbox, RefreshCw } from 'lucide-react'
import { useChangeSetSummary, useServers } from '@/hooks/useApi'
import { useStore } from '@/store'
import { readyForTarget, whereDeployed } from '@/lib/deploy/change-sets'
import { request, authHeader } from '@/lib/api'

// The deploy itself belongs in the Deploy tab. Before this, the only way in was
// the header's Change Sets panel, and the Deploy tab listed eight things about
// deploying and not the one that deploys.
//
// Ready to deploy = closed, committed, not already deployed, not retired, and it
// actually touched something. Anything else is noise in a release queue.


export default function DeployRelease({ server }) {
  const openShip = useStore(s => s.openShip)
  const { sessions, inProgress: open } = useChangeSetSummary(server)
  const { data: serversData } = useServers()
  const targets = (serversData?.value ?? serversData ?? []).map(s => s?.name ?? s).filter(n => n && n !== server)
  const [target, setTarget] = useState('')
  // No default target. Defaulting to the first other server opened a sign-in
  // prompt for an unrelated server just by visiting Deploy; the choice is explicit.
  const chosen = target
  // Part L — the TEST cycle is derived from the server, not an admin list. Shown
  // only when the chosen target is linked as TEST.
  const cycleQuery = useQuery({
    queryKey: ['test-cycle', chosen],
    enabled: !!chosen,
    staleTime: 10_000,
    queryFn: async () => {
      const r = await request(`/api/deploy/test-cycle?server=${encodeURIComponent(chosen)}`, { headers: authHeader() })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      return d
    },
  })
  const cycle = cycleQuery.data && cycleQuery.data.label === 'TEST' ? cycleQuery.data : null
  // "Ready for PROD" is per target (Part A.3): a set already on TEST is still
  // ready for PROD. Selecting the target changes the list.
  const ready = chosen ? readyForTarget(sessions, chosen) : []

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold mb-1">Ready to deploy</h2>
          <p className="text-xs text-muted-foreground">
            Change sets on {server} that can be deployed. One action, two phases.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <li><span className="text-foreground font-medium">Pre-deploy</span> — Check PROD · Tests &amp; close · Build release · Review</li>
            <li><span className="text-foreground font-medium">Deploy</span> — approve · idle check · Save Data · backup · send · verify</li>
          </ul>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-muted-foreground">Ready for</span>
            <select value={chosen} onChange={e => setTarget(e.target.value)} className="bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">Select the target…</option>
              {targets.map(t => <option key={t} value={t} className="bg-background">{t}</option>)}
              {targets.length === 0 && <option value="">(no other servers)</option>}
            </select>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/80">
            Only this change set goes; nothing else from {server}. Review stops for element
            loss and element type changes before anything is sent.
          </p>
        </div>

        {cycle && (
          <div className={cycle.open ? 'border border-emerald-600/30 bg-emerald-600/5 rounded-lg p-3 space-y-1' : 'border border-amber-600/40 bg-amber-500/5 rounded-lg p-3 space-y-1'}>
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <RefreshCw size={12} /> {chosen} {cycle.open ? 'cycle is open' : 'cycle is closed'}
            </p>
            {cycle.startedAt && <p className="text-[11px] text-muted-foreground">Started {new Date(cycle.startedAt).toLocaleString()}{cycle.recloneAt ? ' (from a re-clone)' : ' (first TEST deploy)'}.</p>}
            {cycle.sets?.length
              ? <p className="text-[11px] text-muted-foreground">{cycle.sets.map(s => s.name).join(' · ')}</p>
              : <p className="text-[11px] text-muted-foreground">No change set has been deployed to {chosen} in this cycle yet.</p>}
            {!cycle.open && (
              <p className="text-[11px] text-amber-700">
                A change set in this cycle reached {cycle.closedBy?.target ?? 'PROD'}. Re-clone TEST from PROD before deploying a new change set here.
              </p>
            )}
          </div>
        )}

        {open.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">In progress</p>
            {open.map(s => (
              <div key={s.id} className="border border-border rounded-lg p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.entry_count} change{s.entry_count !== 1 ? 's' : ''}
                    {s.user ? ` · ${s.user}` : ''} · still open — test, close, then release
                  </p>
                </div>
                <button
                  onClick={() => openShip(s, chosen || null)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-foreground hover:bg-muted transition-colors shrink-0"
                >
                  Continue…
                </button>
              </div>
            ))}
          </div>
        )}

        {ready.length === 0 && (
          <div className="border border-border rounded-lg p-6 flex flex-col items-center gap-2 text-center">
            <Inbox size={18} className="text-muted-foreground/60" />
            {chosen ? (
              <>
                <p className="text-xs text-muted-foreground">Nothing ready to release to {chosen}.</p>
                <p className="text-[11px] text-muted-foreground/70 max-w-md">
                  A change set appears here once it is closed and has a commit. Open one in
                  Change Sets (header), make the change, then close it — tests run on close.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Choose the target above.</p>
                <p className="text-[11px] text-muted-foreground/70 max-w-md">
                  Change sets are listed per target: a set already on TEST can still be
                  waiting for PROD.
                </p>
              </>
            )}
          </div>
        )}

        {ready.map(s => {
          let tests = null
          try { tests = s.close_tests ? JSON.parse(s.close_tests) : null } catch { /* malformed → show as none */ }
          return (
            <div key={s.id} className="border border-border rounded-lg p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{s.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {s.entry_count} change{s.entry_count !== 1 ? 's' : ''}
                  {s.user ? ` · ${s.user}` : ''}
                  {tests ? ` · tests ${tests.passed}/${tests.total}` : ' · no tests recorded'}
                  {s.commit_ref ? <span className="font-mono text-muted-foreground/70"> · {String(s.commit_ref).slice(0, 8)}</span> : null}
                  {whereDeployed(s) ? <span className="block text-muted-foreground/80">{whereDeployed(s)} — waiting for {chosen || 'a target'}</span> : null}
                </p>
              </div>
              <button
                onClick={() => openShip(s, chosen || null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-emerald-700 text-white hover:bg-emerald-600 transition-colors shrink-0"
              >
                <Rocket size={12} /> Deploy…
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
