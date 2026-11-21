import { useState, useEffect } from 'react'
import { Rocket, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'
import { request, authHeader } from '@/lib/api'
import { useStore } from '@/store'
import { useChangeSetSummary } from '@/hooks/useApi'
import { useQueryClient } from '@tanstack/react-query'
import { classifyDeployOutcome } from '@/lib/deploy/deploy-outcome'

// One action: ship this change set to a target.
//
// Everything the stepped wizard made the user walk — commit, build release,
// record approval, deploy, verify — happens here in order, with one line of
// plain text saying what is happening. The machinery is still recorded (History,
// deploy record, approval) and still documented; it is just not a decision the
// user has to make five times.

const POST = async (route, body) => {
  const r = await request(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.error) throw new Error(d.error || `${route} failed (${r.status})`)
  return d
}

export default function ShipDialog() {
  const { ship, closeShip, openDeployWizard, server } = useStore()
  const qc = useQueryClient()
  const { sessions } = useChangeSetSummary(server)

  const sessionId = ship?.session?.id
  const session = (sessions ?? []).find(s => s.id === sessionId) ?? ship?.session ?? null

  const [target, setTarget]   = useState('')
  const [servers, setServers] = useState([])
  const [approved, setApproved] = useState(false)
  const [step, setStep]       = useState('')     // what is happening, in plain words
  const [phase, setPhase]     = useState('idle') // idle | running | done | failed
  const [result, setResult]   = useState(null)   // deploy outcome + drift
  const [error, setError]     = useState(null)
  const [reachedProd, setReachedProd] = useState(false)

  useEffect(() => {
    if (!ship) return
    request('/api/servers', { headers: authHeader() })
      .then(r => r.json())
      .then(list => {
        const names = (list ?? []).map(s => s?.name).filter(n => n && n !== server)
        setServers(names)
        setTarget(t => t || names.find(n => /prod/i.test(n)) || (names.length === 1 ? names[0] : ''))
      })
      .catch(() => {})
  }, [ship, server])

  if (!ship) return null

  const finish = () => {
    qc.invalidateQueries({ queryKey: ['work-sessions'] })
    qc.invalidateQueries({ queryKey: ['work-session-active'] })
  }

  const shipIt = async () => {
    setPhase('running'); setError(null); setResult(null); setReachedProd(false)
    const id = session?.id
    try {
      if (!session?.closed_at) {
        setStep('Running the model tests…')
        await POST('/api/sessions/close', { id })
        finish()
      }
      if (!session?.commit_ref) {
        setStep('Filing the model in Git…')
        await POST('/api/deploy/git/push', { source: server, message: `Ship ${session?.name ?? 'change set'}`, session: id })
      }
      setStep('Building a release of just this change…')
      const rel = await POST('/api/deploy/git/release', { source: server, target, session: id })
      if (!rel?.releaseCommit) throw new Error('The release could not be built.')

      setStep('Recording your approval…')
      await POST('/api/deploy/git/approve', { source: server, target, commit: rel.releaseCommit, note: 'Shipped from the one-step ship' })

      setStep(`Sending to ${target}…`)
      setReachedProd(true)
      const res = await POST('/api/deploy/git/execute', { source: server, target, session: id })
      setResult({ ...res, releaseCommit: rel.releaseCommit, ships: rel.included?.length ?? 0 })

      if (res.executed) {
        setStep('Checking the target matches what it was given…')
        const drift = await POST('/api/git/drift', { server: target }).catch(() => null)
        setResult(r => ({ ...r, drift }))
      }
      setPhase('done')
      finish()
    } catch (e) {
      setError(e.message)
      setPhase('failed')
      finish()
    } finally {
      setStep('')
    }
  }

  const outcome = result ? classifyDeployOutcome(result) : null
  const driftClean = result?.drift ? (result.drift.entries ?? []).length === 0 : null
  const checksOk = result ? result.controlOk !== false : true
  const good = phase === 'done' && outcome?.kind === 'ok' && checksOk && driftClean !== false

  return (
    <div className="fixed inset-0 bg-black/50 z-[120] flex items-center justify-center" onClick={phase === 'running' ? undefined : closeShip}>
      <div className="w-[560px] max-w-[calc(100vw-32px)] bg-background border border-border rounded-lg shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <Rocket size={14} className="text-emerald-600" />
          <span className="text-sm font-semibold">Ship {session?.name ?? 'change set'}</span>
          <div className="flex-1" />
          {phase !== 'running' && <button onClick={closeShip} className="text-xs text-muted-foreground hover:text-foreground">Close</button>}
        </div>

        <div className="p-4 space-y-3">
          {/* ---------- before shipping ---------- */}
          {phase === 'idle' && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground w-16">Send to</label>
                <select value={target} onChange={e => setTarget(e.target.value)} className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                  {!target && <option value="">Select a server…</option>}
                  {servers.map(s => <option key={s} value={s} className="bg-background">{s}</option>)}
                </select>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {session?.entry_count ?? 0} change{(session?.entry_count ?? 0) === 1 ? '' : 's'} will go to {target || 'the target'}.
                The model's tests run first and must pass. Nothing else from {server} is included.
              </p>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} className="mt-0.5" />
                <span>I approve sending <span className="font-semibold">{session?.name}</span> to <span className="font-semibold">{target || 'the target'}</span>.</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={shipIt}
                  disabled={!target || !approved}
                  className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 transition-colors disabled:opacity-40"
                >
                  Ship to {target || 'target'}
                </button>
                {/* No second entrance. The detailed view is reachable from the
                    result ("Details"), not offered up front — one product, not two. */}
              </div>
            </>
          )}

          {/* ---------- while shipping ---------- */}
          {phase === 'running' && (
            <div className="flex items-center gap-2 text-xs py-6 justify-center">
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
              <span>{step || 'Working…'}</span>
            </div>
          )}

          {/* ---------- result ---------- */}
          {phase === 'done' && (
            <div className="space-y-3">
              {good ? (
                <div className="border border-emerald-600/30 rounded-md p-3 space-y-1 bg-emerald-600/5">
                  <p className="text-sm font-semibold flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={14} /> Done — {target} is up to date</p>
                  <p className="text-xs text-muted-foreground">
                    {result.ships} change{result.ships === 1 ? '' : 's'} shipped.
                    {result.verification ? ` Safety checks ${result.verification.passed}/${result.verification.total} passed.` : ''}
                    {driftClean ? ' The target matches what it was given.' : ''}
                  </p>
                </div>
              ) : (
                <div className="border border-amber-600/40 rounded-md p-3 space-y-1 bg-amber-500/5">
                  <p className="text-sm font-semibold flex items-center gap-1.5 text-amber-600"><AlertTriangle size={14} /> Sent, with a problem</p>
                  <p className="text-xs">{outcome?.title}</p>
                  <p className="text-xs text-muted-foreground">{outcome?.prod}</p>
                  {outcome?.action && <p className="text-xs"><span className="font-medium">Next:</span> {outcome.action}</p>}
                  {driftClean === false && <p className="text-xs text-amber-600">{target} does not match what it was given — further deploys are paused until that is resolved.</p>}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={closeShip} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 transition-colors">Done</button>
                <button onClick={() => { setPhase('idle'); setApproved(false); setResult(null) }} className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors">Try again</button>
                <button
                  onClick={() => { closeShip(); openDeployWizard({ session }) }}
                  className="ml-auto text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground flex items-center gap-1"
                >
                  Details <ExternalLink size={9} />
                </button>
              </div>
            </div>
          )}

          {/* ---------- failed before/during sending ---------- */}
          {phase === 'failed' && (
            <div className="space-y-3">
              <div className="border border-red-600/40 rounded-md p-3 space-y-1 bg-red-500/5">
                <p className="text-sm font-semibold flex items-center gap-1.5 text-red-600"><AlertTriangle size={14} /> Failed</p>
                <p className="text-xs">{error}</p>
                <p className="text-xs text-muted-foreground">
                  {reachedProd
                    ? `${target} may be part-changed. Check Drift before sending anything else.`
                    : `Nothing reached ${target}. It is untouched.`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setPhase('idle'); setError(null) }} className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors">Try again</button>
                <button onClick={() => { closeShip(); openDeployWizard({ session }) }} className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground flex items-center gap-1">
                  Details <ExternalLink size={9} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
