import { Rocket, Inbox } from 'lucide-react'
import { useChangeSetSummary } from '@/hooks/useApi'
import { useStore } from '@/store'

// The deploy itself belongs in the Deploy tab. Before this, the only way in was
// the header's Change Sets panel (or knowing "Catch up a server" existed) — the
// Deploy tab listed eight things about deploying and not the one that deploys.
//
// Ready to ship = closed, committed, not already deployed, not retired, and it
// actually touched something. Anything else is noise in a release queue.


export default function DeployRelease({ server }) {
  const openDeployWizard = useStore(s => s.openDeployWizard)
  const { ready, inProgress: open } = useChangeSetSummary(server)

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold mb-1">Ready to ship</h2>
          <p className="text-xs text-muted-foreground">
            Change sets on {server} that can be released. Each one walks
            Test → Close → Commit → Build release → Review → Approve → Deploy → Verify,
            starting at the first step it still needs. Nothing reaches the target
            until you approve and deploy.
          </p>
        </div>

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
                  onClick={() => openDeployWizard({ session: s })}
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
            <p className="text-xs text-muted-foreground">Nothing ready to release.</p>
            <p className="text-[11px] text-muted-foreground/70 max-w-md">
              A change set appears here once it is closed and has a commit. Open one in
              Change Sets (header), make the change, then close it — tests run on close.
            </p>
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
                </p>
              </div>
              <button
                onClick={() => openDeployWizard({ session: s })}
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
