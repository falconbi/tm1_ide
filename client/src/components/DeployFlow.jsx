import { useState, useEffect } from 'react'
import { Rocket, Loader2, CheckCircle2, AlertTriangle, X, FileText } from 'lucide-react'
import { request, authHeader } from '@/lib/api'
import { useStore } from '@/store'
import { classifyDeployOutcome, toneClasses } from '@/lib/deploy/deploy-outcome'
import { decideLossGate } from '@shared/deploy-loss-gate.js'
import DiffViewerModal from '@/components/DiffViewerModal'
import { cn } from '@/lib/utils'

// One deploy flow, in two phases.
//
//   PRE-DEPLOY  where you look and decide:  check PROD is idle · tests & close ·
//               build the release · review the plan and the elements it removes
//   DEPLOY      one screen: approve · check idle again · Save Data · backup · send · verify
//
// It replaces both the one-button Ship dialog and the eight-step wizard. The
// wizard stays only for "Catch up a server", which is first-time setup, not a
// deploy. Two entrances for one job is what made "which path is the product?" a
// question; this is the answer.

const POST = async (route, body) => {
  const r = await request(route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.error) throw new Error(d.error || r.statusText)
  return d
}
const GET = async (url) => {
  const r = await request(url, { headers: authHeader() })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.error) throw new Error(d.error || r.statusText)
  return d
}

const fmt = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return iso } }
const PRE_STEPS = ['Check PROD', 'Refresh from PROD', 'Tests & close', 'Build release', 'Review']

function StepHeader({ step, phase }) {
  const label = phase === 'deploy' ? 'Deploy' : `Pre-deploy ${step} of ${PRE_STEPS.length}`
  const title = phase === 'deploy' ? 'Send it' : PRE_STEPS[step - 1]
  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
      <span className={cn('px-1.5 py-0.5 rounded', phase === 'deploy' ? 'bg-emerald-700/10 text-emerald-700' : 'bg-muted text-foreground')}>{phase === 'deploy' ? 'Deploy' : 'Pre-deploy'}</span>
      <span>{label}</span>
      <span className="text-muted-foreground/60">·</span>
      <span className="text-foreground normal-case tracking-normal font-medium">{title}</span>
    </div>
  )
}

export default function DeployFlow() {
  const { ship, closeShip, server } = useStore()
  const session = ship?.session ?? null

  const [servers, setServers] = useState([])
  const [target, setTarget] = useState('')
  const [phase, setPhase] = useState('start')   // start | pre | deploy | done
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [prog, setProg] = useState('')          // one line for the running step

  const [idle, setIdle] = useState(null)
  const [idleConfirmed, setIdleConfirmed] = useState(false)
  const [refresh, setRefresh] = useState(null)      // { dimensions: [...] }
  const [refreshBusy, setRefreshBusy] = useState('')
  const [ticked, setTicked] = useState({})          // dimension → true
  const [delTicked, setDelTicked] = useState({})    // dimension → include deletes
  const [refreshed, setRefreshed] = useState(null)  // result of the apply
  const [tests, setTests] = useState(null)
  const [closed, setClosed] = useState(false)
  const [release, setRelease] = useState(null)
  const [prep, setPrep] = useState(null)
  const [loss, setLoss] = useState(null)        // computed loss for the release
  const [lossOk, setLossOk] = useState(false)
  const [typeOk, setTypeOk] = useState(false)      // "Yes, change these" for element types
  const [typeAllow, setTypeAllow] = useState({})   // refresh: dimension → allow type changes
  const [approved, setApproved] = useState(false)
  const [settings, setSettings] = useState(null)
  const [backupAt, setBackupAt] = useState('')
  const [res, setRes] = useState(null)
  const [drift, setDrift] = useState(null)
  const [diffEntry, setDiffEntry] = useState(null)

  // Fresh every time it opens for a change set.
  useEffect(() => {
    if (!ship) return
    setPhase('start'); setStep(1); setError(null); setProg('')
    setIdle(null); setIdleConfirmed(false); setTests(null); setClosed(false)
    setRelease(null); setPrep(null); setLoss(null); setLossOk(false); setTypeOk(false); setTypeAllow({})
    setRefresh(null); setRefreshed(null); setTicked({}); setDelTicked({})
    setApproved(false); setSettings(null); setBackupAt(''); setRes(null); setDrift(null)
  }, [ship?.session?.id])

  useEffect(() => {
    if (!ship) return
    request('/api/servers', { headers: authHeader() })
      .then(r => r.json())
      .then(list => setServers((list ?? []).map(s => s?.name).filter(n => n && n !== server)))
      .catch(() => {})
  }, [ship, server])

  useEffect(() => {
    if (!target) { setSettings(null); return }
    let live = true
    GET(`/api/deploy/settings?server=${encodeURIComponent(target)}`)
      .then(d => { if (live) setSettings({ backupProcess: d.backupProcess ?? null }) })
      .catch(() => { if (live) setSettings({ backupProcess: null }) })
    return () => { live = false }
  }, [target])

  const checkIdle = async () => {
    setBusy('idle'); setError(null); setIdleConfirmed(false)
    try { setIdle(await GET(`/api/deploy/idle?server=${encodeURIComponent(target)}`)) }
    catch (e) { setError(e.message); setIdle(null) }
    finally { setBusy('') }
  }

  const start = async () => {
    if (!target) return
    setPhase('pre'); setStep(1)
    await checkIdle()
  }

  // Refresh runs BEFORE tests and close: it writes to DEV and records each object
  // in the open change set, which a closed set cannot do.
  const loadRefresh = async () => {
    setRefreshBusy('plan'); setError(null)
    try {
      const d = await GET(`/api/deploy/refresh/plan?source=${encodeURIComponent(server)}&target=${encodeURIComponent(target)}`)
      setRefresh(d)
      const all = {}
      for (const it of d.dimensions ?? []) all[it.dimension] = true
      setTicked(all)
    } catch (e) { setError(e.message); setRefresh({ dimensions: [], error: e.message }) }
    finally { setRefreshBusy('') }
  }

  const doRefresh = async () => {
    setRefreshBusy('apply'); setError(null)
    try {
      const accept = (refresh?.dimensions ?? [])
        .filter(d => ticked[d.dimension])
        .map(d => ({ dimension: d.dimension, includeDeletes: !!delTicked[d.dimension], allowTypeChanges: !!typeAllow[d.dimension] }))
      const r = await POST('/api/deploy/refresh/apply', { source: server, target, session: session.id, accept })
      setRefreshed(r)
      await loadRefresh()
    } catch (e) { setError(e.message) }
    finally { setRefreshBusy('') }
  }

  const resumeChangeSet = async () => {
    setBusy('resume'); setError(null)
    try {
      await POST('/api/sessions/resume', { id: session.id })
      window.location.reload()
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }

  const doTestsAndClose = async () => {
    setBusy('close'); setError(null); setProg('Running the model tests…')
    try {
      const d = await POST('/api/sessions/close', { id: session.id })
      // close_tests is stored as a JSON string on the session.
      let t = d.close_tests ?? null
      if (typeof t === 'string') { try { t = JSON.parse(t) } catch { t = null } }
      setTests(t); setClosed(true)
      setProg('Filing DEV in Git…')
      await POST('/api/deploy/git/push', { source: server, message: `Deploy ${session?.name ?? 'change set'}`, session: session.id })
      setStep(4)
    } catch (e) { setError(e.message) }
    finally { setBusy(''); setProg('') }
  }

  const doBuild = async () => {
    setBusy('release'); setError(null); setProg('Building a release of just this change…')
    try {
      const rel = await POST('/api/deploy/git/release', { source: server, target, session: session.id })
      if (!rel?.releaseCommit) throw new Error('The release could not be built.')
      setRelease(rel)
      setProg('Reading the target…')
      // The loss gate reads via POST; a failure here is shown at Review, never fatal.
      const p = await POST('/api/deploy/git/loss', { target, commit: rel.releaseCommit }).catch(() => null)
      setLoss(p)
      setPrep(await POST('/api/deploy/git/prepare', { source: server, target, session: session.id, branch: `release-${target}` }).catch(e => ({ error: e.message })))
      setStep(4)
    } catch (e) { setError(e.message) }
    finally { setBusy(''); setProg('') }
  }

  const doDeploy = async () => {
    setBusy('deploy'); setError(null); setRes(null); setDrift(null)
    try {
      setProg('Checking PROD is still idle…')
      const again = await GET(`/api/deploy/idle?server=${encodeURIComponent(target)}`)
      setIdle(again)
      if ((again.running ?? []).length) throw new Error(`${again.running.map(r => r.name).join(', ')} is running on ${target} — deploy when it finishes.`)

      setProg('Recording your approval…')
      await POST('/api/deploy/git/approve', {
        source: server, target, commit: release.releaseCommit, note: 'Deployed from the two-phase flow',
        lossAck: loss?.loss?.elements > 0 ? { loss: loss.loss, elements: loss.elementLoss } : undefined,
        typeAck: (prep?.typeChanges ?? []).length ? { elements: prep.typeChanges } : undefined,
      })

      setProg(`Saving ${target}'s data…`)
      setProg('Saving data, then the backup…')
      const d = await POST('/api/deploy/git/execute', { source: server, target, session: session.id, backupAt: backupAt || undefined })
      setRes(d)
      if (d.executed) {
        setProg('Verifying…')
        setDrift(await POST('/api/git/drift', { server: target }).catch(() => null))
      }
      setPhase('done')
    } catch (e) { setError(e.message) }
    finally { setBusy(''); setProg('') }
  }

  if (!ship) return null

  const outcome = res ? classifyDeployOutcome(res) : null
  const doneOk = res?.executed && res?.controlOk !== false && (drift?.entries ?? []).length === 0
  const blockIdle = (idle?.running ?? []).length > 0
  // Our own deployment connection is always signed in; it is reported, not confirmed.
  const needIdleConfirm = idle?.needsConfirm !== false && (idle?.sessions ?? []).length > 0 && !idleConfirmed
  const lossNeedsConfirm = decideLossGate({ loss: loss?.loss }) === 'confirm' && !lossOk
  const canDeploy = approved && settings && (settings.backupProcess || backupAt) && !busy

  return (
    <div className="fixed inset-0 bg-black/50 z-[120] flex items-center justify-center" onClick={busy ? undefined : closeShip}>
      <div className="w-[620px] max-w-[calc(100vw-32px)] max-h-[88vh] bg-background border border-border rounded-lg shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          <Rocket size={14} className="text-emerald-600" />
          <span className="text-sm font-semibold">Deploy <span className="font-mono text-xs">{session?.name}</span></span>
          <div className="flex-1" />
          {!busy && <button onClick={closeShip} className="p-1 text-muted-foreground hover:text-foreground"><X size={14} /></button>}
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {phase === 'start' && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground w-16">Send to</label>
                <select value={target} onChange={e => setTarget(e.target.value)} className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                  {!target && <option value="">Select the target…</option>}
                  {servers.map(s => <option key={s} value={s} className="bg-background">{s}</option>)}
                </select>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Pre-deploy checks the target, runs the tests, builds a release of just this change and shows you the plan.
                Deploy then sends it. Nothing reaches {target || 'the target'} until you approve it on the Deploy screen.
              </p>
              <button onClick={start} disabled={!target} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">Start pre-deploy</button>
            </>
          )}

          {phase === 'pre' && (
            <>
              <StepHeader step={step} phase="pre" />

              {step === 1 && (
                <div className="space-y-2">
                  {busy === 'idle' && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Reading {target}…</p>}
                  {idle && (
                    <div className={cn('border rounded-md p-3 space-y-1.5', blockIdle ? 'border-red-600/40 bg-red-500/5' : 'border-emerald-600/30 bg-emerald-600/5')}>
                      <p className={cn('text-xs font-semibold flex items-center gap-1.5', blockIdle ? 'text-red-600' : 'text-emerald-700')}>
                        {blockIdle ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                        {blockIdle ? `${blockIdle ? idle.running.length : 0} process${idle.running.length === 1 ? '' : 'es'} running` : `${target} is idle`}
                      </p>
                      {blockIdle && idle.running.map((r, i) => (
                        <p key={i} className="text-[11px] text-red-600">{r.name} — running ({r.state}){r.elapsed ? ` for ${r.elapsed.replace('P0DT', '').toLowerCase()}` : ''}. Deploy when it finishes.</p>
                      ))}
                      <p className="text-[11px] text-muted-foreground">
                        Chores due in the next {idle.windowMinutes} min: {idle.choresDue?.length ? idle.choresDue.map(c => `${c.name} at ${fmt(c.at)}`).join(', ') : 'none'}.
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {idle.sessionsReadable
                          ? (idle.sessions.length
                              ? `${idle.sessions.length} signed in: ${idle.sessions.join(', ')}${idle.needsConfirm ? '' : ' (this deployment\'s own connection)'}`
                              : 'Nobody signed in.')
                          : 'Sign-ins could not be read — check manually.'}
                      </p>
                      {idle.sessionsReadable && idle.ownAccount && (
                        <p className="text-[10px] text-muted-foreground/80">
                          Matched by account name: someone else signed in as <span className="font-mono">{idle.ownAccount}</span> is not listed separately.
                        </p>
                      )}
                      {(idle.errors ?? []).length > 0 && <p className="text-[11px] text-amber-600">Could not read: {idle.errors.join('; ')}</p>}
                    </div>
                  )}
                  {idle?.choresDue?.length > 0 && !blockIdle && (
                    <p className="text-[11px] text-amber-600">A chore is due during the deploy window — it may start mid-deploy.</p>
                  )}
                  {needIdleConfirm && (
                    <label className="flex items-start gap-2 text-[11px]">
                      <input type="checkbox" checked={idleConfirmed} onChange={e => setIdleConfirmed(e.target.checked)} className="mt-0.5" />
                      <span>I know {idle.sessions.length} {idle.sessions.length === 1 ? 'person is' : 'people are'} signed in to {target} ({idle.sessions.join(', ')}).</span>
                    </label>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => { setStep(2); loadRefresh() }} disabled={!idle || blockIdle || needIdleConfirm} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">Continue</button>
                    <button onClick={checkIdle} disabled={busy === 'idle'} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Check again</button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Bring what PROD changed into {server}, recorded in this change set. It must happen
                    before the tests and close: a closed change set cannot record it.
                  </p>
                  {session?.closed_at ? (
                    <div className="border border-amber-600/40 bg-amber-500/5 rounded-md p-3 space-y-2">
                      <p className="text-xs font-semibold text-amber-700">This change set is closed</p>
                      <p className="text-[11px]">Reopen <span className="font-semibold">{session.name}</span> to bring PROD's changes into {server} — then run the tests and close it again.</p>
                      <button onClick={resumeChangeSet} disabled={busy === 'resume'} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">
                        {busy === 'resume' ? 'Reopening…' : 'Reopen the change set'}
                      </button>
                    </div>
                  ) : (
                    <>
                      {refreshBusy === 'plan' && <p className="text-[11px] text-muted-foreground">Comparing {target} with {server}…</p>}
                      {refresh && !refreshBusy && (
                        (refresh.dimensions ?? []).length === 0 ? (
                          <p className="text-[11px] text-emerald-700">Nothing to refresh — {server} already has what {target} has.</p>
                        ) : (
                          <div className="border border-border rounded-md overflow-hidden">
                            <div className="grid grid-cols-[1fr_90px_120px] text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30 px-3 py-1 border-b border-border gap-2">
                              <span>Dimension</span><span>Bring across</span><span>Deletes</span>
                            </div>
                            {(refresh.dimensions ?? []).map((d, i) => (
                              <div key={i} className="grid grid-cols-[1fr_90px_120px] px-3 py-1 text-[11px] border-b border-border/40 last:border-0 gap-2 items-center">
                                <label className="flex items-center gap-2">
                                  <input type="checkbox" checked={!!ticked[d.dimension]} onChange={e => setTicked(t => ({ ...t, [d.dimension]: e.target.checked }))} />
                                  <span>{d.dimension}</span>
                                </label>
                                <span className="text-muted-foreground">
                                  {[d.addElements.length ? `+${d.addElements.length} el` : '', d.addEdges.length || d.moves.length ? `+${d.addEdges.length + d.moves.length} edge` : ''].filter(Boolean).join(' · ') || '—'}
                                </span>
                                <label className="flex items-center gap-1.5 text-muted-foreground">
                                  {d.removeElements.length ? (
                                    <>
                                      <input type="checkbox" checked={!!delTicked[d.dimension]} onChange={e => setDelTicked(v => ({ ...v, [d.dimension]: e.target.checked }))} />
                                      <span>remove {d.removeElements.length}</span>
                                    </>
                                  ) : <span>—</span>}
                                </label>
                              </div>
                            ))}
                            {(refresh.dimensions ?? []).some(d => (d.typeRisk ?? []).length) && (
                              <div className="px-3 py-2 border-t border-border/40 space-y-1">
                                <p className="text-[11px] text-red-600">Bringing these across changes element types — their values on {server} are cleared:</p>
                                {(refresh.dimensions ?? []).filter(d => (d.typeRisk ?? []).length).map((d, i) => (
                                  <label key={i} className="flex items-center gap-2 text-[11px]">
                                    <input type="checkbox" checked={!!typeAllow[d.dimension]} onChange={e => setTypeAllow(t => ({ ...t, [d.dimension]: e.target.checked }))} />
                                    <span>{d.dimension}: {d.typeRisk.map(t => t.element).join(', ')} → consolidation</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      )}
                      {refreshed && (
                        <div className="border border-emerald-600/30 bg-emerald-600/5 rounded-md p-3 space-y-1">
                          <p className="text-[11px] text-emerald-700">Refreshed: {(refreshed.applied ?? []).map(a => a.dimension).join(', ') || 'nothing'}</p>
                          {(refreshed.skipped ?? []).map((k, i) => (
                            <p key={i} className="text-[10px] text-amber-600">{k.dimension}: {k.what} — {k.why}</p>
                          ))}
                        </div>
                      )}
                      {error && <p className="text-[11px] text-red-600">{error}</p>}
                    </>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    {!session?.closed_at && (
                      <button onClick={doRefresh} disabled={refreshBusy || !(refresh?.dimensions ?? []).some(d => ticked[d.dimension])} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">
                        {refreshBusy === 'apply' ? 'Refreshing…' : 'Refresh into ' + server}
                      </button>
                    )}
                    <button onClick={() => setStep(3)} disabled={session?.closed_at} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Continue</button>
                    <button onClick={() => setStep(1)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Back</button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">The model's tests run first; a block-severity failure stops here. Then DEV is filed in Git so a release can be built from it.</p>
                  {tests && <p className="text-[11px]">Tests: <span className={tests.blocking ? 'text-red-600' : 'text-emerald-700'}>{tests.passed}/{tests.total} passed</span>{tests.blocking ? ` · ${tests.blocking} blocking` : ''}</p>}
                  {error && <p className="text-[11px] text-red-600">{error}</p>}
                  {busy && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> {prog}</p>}
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={doTestsAndClose} disabled={!!busy || closed} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">
                      {closed ? 'Closed' : 'Run tests and close'}
                    </button>
                    {closed && <button onClick={() => setStep(4)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Continue</button>}
                    <button onClick={() => setStep(2)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Back</button>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">A release is the target's last deployed state plus only this change set's objects. Everything else stays on {server}.</p>
                  {release && (
                    <div className="border border-border rounded-md p-3 space-y-1">
                      <p className="text-[11px]">Release <span className="font-mono">{String(release.releaseCommit).slice(0, 10)}</span> · included <span className="font-semibold">{release.included?.length ?? 0}</span></p>
                      {(release.included ?? []).map((o, i) => (
                        <p key={i} className="text-[11px] text-muted-foreground">{o.action} · {o.type} <span className="font-mono text-foreground">{o.name}</span></p>
                      ))}
                      {(release.included ?? []).length === 0 && <p className="text-[11px] text-muted-foreground">Nothing to ship.</p>}
                    </div>
                  )}
                  {error && <p className="text-[11px] text-red-600">{error}</p>}
                  {busy && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> {prog}</p>}
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={doBuild} disabled={!!busy || !!release} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">Build release</button>
                    {release && <button onClick={() => setStep(5)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Continue to Review</button>}
                    <button onClick={() => setStep(3)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Back</button>
                  </div>
                </div>
              )}

              {step === 5 && (
                <div className="space-y-2">
                  {prep?.error && <p className="text-[11px] text-red-600">{prep.error}</p>}
                  <p className="text-xs">On <span className="font-semibold">{target}</span>: <span className="font-semibold">{prep?.plan?.total ?? 0}</span> plan operation{(prep?.plan?.total ?? 0) === 1 ? '' : 's'}{prep?.plan?.targetCommit ? `, moving to ${String(prep.plan.targetCommit).slice(0, 10)}` : ''}.</p>
                  {(release?.included ?? []).map((o, i) => (
                    <div key={i} className="flex items-baseline gap-2 text-[11px] px-2 py-1 rounded bg-muted/30">
                      <span className="text-muted-foreground">{o.action.toLowerCase()}</span>
                      <span className="text-muted-foreground/60">{o.type}</span>
                      <span className="font-mono">{o.name}</span>
                    </div>
                  ))}
                  {(prep?.typeChanges ?? []).length > 0 && (
                    <div className="border border-red-600/40 bg-red-500/5 rounded-md p-3 space-y-1">
                      <p className="text-xs font-semibold text-red-600">
                        This deploy changes the type of {prep.typeChanges.length} element{prep.typeChanges.length === 1 ? '' : 's'} — their stored values will be cleared
                      </p>
                      {prep.typeChanges.slice(0, 8).map((t, i) => (
                        <p key={i} className="text-[11px]">{t.dimension} · <span className="font-mono">{t.element}</span>: {t.from} → {t.to}</p>
                      ))}
                      {prep.typeChanges.length > 8 && <p className="text-[11px] text-muted-foreground">…and {prep.typeChanges.length - 8} more</p>}
                      {!typeOk
                        ? <button onClick={() => setTypeOk(true)} className="mt-1 px-2.5 py-1 text-[11px] rounded bg-red-700 text-white hover:bg-red-600">Yes, change these</button>
                        : <p className="text-[11px] text-emerald-700">Confirmed — recorded with your approval.</p>}
                    </div>
                  )}
                  {prep?.loss?.elements > 0 && (
                    <div className="border border-amber-600/40 bg-amber-500/5 rounded-md p-3 space-y-1">
                      <p className="text-xs font-semibold text-amber-700">This deploy removes {prep.loss.elements} element{prep.loss.elements === 1 ? '' : 's'} in {prep.loss.dimensions} dimension{prep.loss.dimensions === 1 ? '' : 's'}</p>
                      {prep.elementLoss.map((l, i) => (
                        <p key={i} className="text-[11px]">{l.dimension}/{l.hierarchy}: <span className="font-semibold">{l.count}</span> <span className="text-muted-foreground">— {l.sample?.join(', ')}</span></p>
                      ))}
                      {lossNeedsConfirm && (
                        <button onClick={() => setLossOk(true)} className="mt-1 px-2.5 py-1 text-[11px] rounded bg-amber-700 text-white hover:bg-amber-600">Yes, remove these</button>
                      )}
                      {lossOk && <p className="text-[11px] text-emerald-700">Confirmed.</p>}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => setPhase('deploy')} disabled={!prep || !!prep.error || lossNeedsConfirm || ((prep?.typeChanges ?? []).length > 0 && !typeOk)} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">Continue to Deploy</button>
                    <button onClick={() => setStep(4)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Back</button>
                  </div>
                </div>
              )}
            </>
          )}

          {phase === 'deploy' && !res && (
            <>
              <StepHeader phase="deploy" />
              <p className="text-xs">Ships <span className="font-semibold">{release?.included?.length ?? 0}</span> object{(release?.included?.length ?? 0) === 1 ? '' : 's'} · release <span className="font-mono">{String(release?.releaseCommit ?? '').slice(0, 10)}</span>. There is no rollback.</p>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} className="mt-0.5" />
                <span>I approve sending <span className="font-semibold">{session?.name}</span> to <span className="font-semibold">{target}</span>.</span>
              </label>
              {settings?.backupProcess && <p className="text-[11px] text-muted-foreground">Backup process <span className="font-mono text-foreground">{settings.backupProcess}</span> runs first; if it fails, nothing is sent.</p>}
              {settings && !settings.backupProcess && (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">When was <span className="text-foreground">{target}</span> last backed up?</label>
                  <input type="datetime-local" value={backupAt} onChange={e => setBackupAt(e.target.value)} className="w-full bg-muted border border-border rounded px-2 py-1 text-xs" />
                </div>
              )}
              {prog && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> {prog}</p>}
              {error && <p className="text-[11px] text-red-600 border border-red-600/40 rounded px-2 py-1">{error}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={doDeploy} disabled={!canDeploy} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">
                  {busy === 'deploy' ? 'Deploying…' : `Deploy to ${target}`}
                </button>
                <button onClick={() => setPhase('pre')} disabled={!!busy} className="text-xs text-muted-foreground hover:text-foreground">Back</button>
              </div>
            </>
          )}

          {phase === 'done' && res && (
            <>
              <div className={cn('border rounded-md p-3 space-y-1', toneClasses(outcome?.tone))}>
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  {doneOk ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                  {doneOk ? `Done — ${target} is up to date` : outcome?.title ?? 'Sent, with a problem'}
                </p>
                <p className="text-xs">{outcome?.prod}</p>
                {outcome?.action && <p className="text-xs"><span className="font-medium">Next:</span> {outcome.action}</p>}
                <p className="text-[11px] opacity-90">
                  {res.verification ? `Checks ${res.verification.passed}/${res.verification.total} · ` : ''}
                  {res.saveData?.at ? `data saved ${fmt(res.saveData.at)} · ` : ''}
                  {res.backup?.kind === 'process' ? `backup ${res.backup.process} ran ${fmt(res.backup.at)}` : res.backup?.at ? `last backup ${fmt(res.backup.at)}` : ''}
                  {drift ? (drift.entries?.length ? ` · ${drift.entries.length} drift` : ' · no drift') : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={closeShip} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600">Done</button>
                <button onClick={() => { setPhase('pre'); setRes(null); setDrift(null) }} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">Back</button>
                <button
                  onClick={() => useStore.getState().openDeployReport({ target, commit: res.targetCommit ?? release?.releaseCommit })}
                  className="ml-auto text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground flex items-center gap-1"
                ><FileText size={9} /> Details</button>
              </div>
            </>
          )}
        </div>
      </div>
      {diffEntry && <DiffViewerModal entry={diffEntry} onClose={() => setDiffEntry(null)} />}
    </div>
  )
}
