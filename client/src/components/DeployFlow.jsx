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
// One key per view/subset, matching the server's: type, name, and its parent.
const coverKey = (c) => `${c.type}:${c.name}:${c.dimension ?? c.cube}`

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
  // dimension → { deletes: { element: 'delete'|'keep' }, moves: { child: 'take'|'keep' } }
  // No default: an undecided delete or move blocks the refresh.
  const [decisions, setDecisions] = useState({})
  const [choreTicked, setChoreTicked] = useState({})   // chore → copy the target's schedule
  // 'subset:name:dim' / 'view:name:cube' → 'take' | 'keep'. A view or subset on both
  // sides with different content has NO default — a choice is required.
  const [coverChoice, setCoverChoice] = useState({})
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

  // No reset effect: App keys this component on the change set, so opening it for
  // another set mounts a fresh one. A reset effect re-rendered every field twice.

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
        .map(d => ({ dimension: d.dimension, allowTypeChanges: !!typeAllow[d.dimension], deletes: decisions[d.dimension]?.deletes ?? {}, moves: decisions[d.dimension]?.moves ?? {}, attributeTypes: decisions[d.dimension]?.attributes ?? {} }))
      const chores = (refresh?.chores ?? []).filter(c => choreTicked[c.name]).map(c => ({ name: c.name, takeSchedule: true }))
      const covers = [...(refresh?.subsets ?? []), ...(refresh?.views ?? [])]
        .map(c => ({
          type: c.type, name: c.name, dimension: c.dimension, cube: c.cube, hierarchy: c.hierarchy,
          // An object only PROD has arrives by default; a conflict must be chosen.
          choice: coverChoice[coverKey(c)] ?? c.choice ?? null,
        }))
      const hierarchies = (refresh?.hierarchies ?? []).map(h => ({
        dimension: h.dimension, name: h.name,
        choice: coverChoice[`hierarchy:${h.name}:${h.dimension}`] ?? h.choice ?? null,
      }))
      const r = await POST('/api/deploy/refresh/apply', { source: server, target, session: session.id, accept, chores, covers, hierarchies })
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
      // Already matches the target: recorded as done, nothing to approve.
      if (rel?.noChange) { setRelease({ noChange: true, reason: rel.reason }); setStep(4); return }
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

  // Deletes and moves the target made must each be decided, with no default.
  const undecided = (refresh?.dimensions ?? [])
    .filter(d => ticked[d.dimension])
    .flatMap(d => [
      ...(d.removeElements ?? []).filter(el => !['delete','keep'].includes(decisions[d.dimension]?.deletes?.[el])).map(el => ({ dim: d.dimension, kind: 'delete', element: el })),
      ...(d.moves ?? []).filter(m => !['take','keep'].includes(decisions[d.dimension]?.moves?.[m.child])).map(m => ({ dim: d.dimension, kind: 'move', element: m.child })),
      ...(d.attributes?.typeChanges ?? []).filter(t => !['take','keep'].includes(decisions[d.dimension]?.attributes?.[t.name])).map(t => ({ dim: d.dimension, kind: 'attribute', element: t.name })),
    ])
  // A view or subset on both sides with different content is a conflict, not a gap:
  // no default, exactly like a delete or a move.
  const undecidedCovers = [...(refresh?.subsets ?? []), ...(refresh?.views ?? []), ...(refresh?.hierarchies ?? [])]
    .filter(c => !c.adding && !['take','keep'].includes(coverChoice[c.type === 'hierarchy' ? `hierarchy:${c.name}:${c.dimension}` : coverKey(c)] ?? c.choice))
    .map(c => ({ dim: c.dimension ?? c.cube, kind: c.type, element: c.name }))
  const setDecision = (dim, kind, element, choice) => setDecisions(prev => {
    const cur = prev[dim] ?? { deletes: {}, moves: {} }
    const next = kind === 'delete' ? { ...cur, deletes: { ...cur.deletes, [element]: choice } }
      : kind === 'move' ? { ...cur, moves: { ...cur.moves, [element]: choice } }
      : { ...cur, attributes: { ...(cur.attributes ?? {}), [element]: choice } }
    return { ...prev, [dim]: next }
  })

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
                        (refresh.dimensions ?? []).length === 0 && (refresh.subsets ?? []).length === 0 && (refresh.views ?? []).length === 0 && (refresh.hierarchies ?? []).length === 0 && (refresh.chores ?? []).length === 0 ? (
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
                                <span className="text-muted-foreground">
                                  {d.removeElements.length ? `${d.removeElements.length} to decide` : '—'}
                                </span>
                              </div>
                            ))}
                            {(refresh.chores ?? []).length > 0 && (
                              <div className="px-3 py-2 border-t border-border/40 space-y-1">
                                <p className="text-[11px] font-semibold text-foreground">Chore schedules on {target} that differ from {server}</p>
                                {(refresh.chores ?? []).map(c => (
                                  <label key={c.name} className="flex items-start gap-2 text-[11px]">
                                    <input type="checkbox" checked={!!choreTicked[c.name]} onChange={e => setChoreTicked(t => ({ ...t, [c.name]: e.target.checked }))} className="mt-0.5" />
                                    <span>{c.name} <span className="text-muted-foreground">— {c.fields.length ? `differs: ${c.fields.join(', ')}` : 'schedule matches'}</span>
                                    {c.devActive && <span className="text-amber-600"> · DEV has it ON (the refresh leaves it off)</span>}</span>
                                  </label>
                                ))}
                                <p className="text-[10px] text-muted-foreground">Ticked chores take {target}'s schedule; DEV is always left off. The on/off flag itself is the deploy's job — the target's own flag is restored around the pull.</p>
                              </div>
                            )}

                            {(refresh.hierarchies ?? []).length > 0 && (
                              <div className="px-3 py-2 border-t border-border/40 space-y-2">
                                <p className="text-[11px] font-semibold text-foreground">Alternate hierarchies that differ on {target}</p>
                                {(refresh.hierarchies ?? []).map(h => {
                                  const key = `hierarchy:${h.name}:${h.dimension}`
                                  const choice = coverChoice[key] ?? h.choice
                                  return (
                                    <div key={key} className="flex items-center gap-2 text-[11px] flex-wrap">
                                      <span className="text-foreground">Hierarchy {h.name}</span>
                                      <span className="text-muted-foreground/60">({h.dimension}) · {(h.parts ?? []).join(', ')}{h.elements != null ? ` · ${h.elements} members, ${h.edges} edges` : ''}</span>
                                      {h.adding ? (
                                        <span className="text-emerald-700">missing on {server} — created</span>
                                      ) : (
                                        <>
                                          <button onClick={() => setCoverChoice(p => ({ ...p, [key]: 'take' }))} className={choice === 'take' ? 'px-2 py-0.5 rounded bg-emerald-700 text-white' : 'px-2 py-0.5 rounded border border-border hover:bg-muted'}>Take {target}'s</button>
                                          <button onClick={() => setCoverChoice(p => ({ ...p, [key]: 'keep' }))} className={choice === 'keep' ? 'px-2 py-0.5 rounded bg-amber-700 text-white' : 'px-2 py-0.5 rounded border border-border hover:bg-muted'}>Keep {server}'s</button>
                                        </>
                                      )}
                                      {h.onlyDev > 0 && <span className="text-amber-600">{h.onlyDev} element(s) only on {server} — kept</span>}
                                    </div>
                                  )
                                })}
                                <p className="text-[10px] text-muted-foreground">A hierarchy only {target} has is created here with its members and edges. One on both sides with a different shape has no default. Elements are never deleted: they are dimension-wide, so removing one takes its values too.</p>
                              </div>
                            )}
                            {((refresh.subsets ?? []).length > 0 || (refresh.views ?? []).length > 0) && (
                              <div className="px-3 py-2 border-t border-border/40 space-y-2">
                                <p className="text-[11px] font-semibold text-foreground">Views and subsets that differ on {target}</p>
                                {[...(refresh.subsets ?? []), ...(refresh.views ?? [])].map(c => (
                                  <div key={coverKey(c)} className="flex items-center gap-2 text-[11px] flex-wrap">
                                    <span className="text-foreground">{c.type === 'subset' ? 'Subset' : 'View'} {c.name}</span>
                                    <span className="text-muted-foreground/60">({c.dimension ?? c.cube}{c.hierarchy && c.hierarchy !== c.dimension ? `/${c.hierarchy}` : ''}) · {c.mode}{c.n != null ? ` · ${c.n} members` : ''} · {(c.parts ?? []).join(', ')}</span>
                                    {c.adding ? (
                                      <span className="text-emerald-700">missing on {server} — brought across</span>
                                    ) : (
                                      <>
                                        <button onClick={() => setCoverChoice(p => ({ ...p, [coverKey(c)]: 'take' }))} className={(coverChoice[coverKey(c)] ?? c.choice) === 'take' ? 'px-2 py-0.5 rounded bg-emerald-700 text-white' : 'px-2 py-0.5 rounded border border-border hover:bg-muted'}>Take {target}'s</button>
                                        <button onClick={() => setCoverChoice(p => ({ ...p, [coverKey(c)]: 'keep' }))} className={(coverChoice[coverKey(c)] ?? c.choice) === 'keep' ? 'px-2 py-0.5 rounded bg-amber-700 text-white' : 'px-2 py-0.5 rounded border border-border hover:bg-muted'}>Keep {server}'s</button>
                                      </>
                                    )}
                                    {(c.unreadable ?? []).length > 0 && <span className="text-red-600">can't read {c.unreadable.join(', ')} on {target} — taking it is refused, not guessed</span>}
                                    {(c.usesSubsets ?? []).length > 0 && <span className="text-muted-foreground/60">uses: {c.usesSubsets.join(', ')}</span>}
                                  </div>
                                ))}
                                <p className="text-[10px] text-muted-foreground">A view or subset on both sides with different content has no default: taking the target's writes it here; keeping {server}'s means the next deploy carries it to {target}. Subsets are applied before views.</p>
                              </div>
                            )}

                            {(refresh.dimensions ?? []).some(d => (d.attributes?.add ?? []).length || (d.attributes?.typeChanges ?? []).length) && (
                              <div className="px-3 py-2 border-t border-border/40 space-y-1">
                                <p className="text-[11px] font-semibold text-foreground">Attributes PROD has that {server} does not</p>
                                {(refresh.dimensions ?? []).filter(d => (d.attributes?.add ?? []).length || (d.attributes?.typeChanges ?? []).length).map(d => (
                                  <div key={d.dimension} className="text-[11px]">
                                    <span className="text-muted-foreground">{d.dimension}: </span>
                                    {(d.attributes.add ?? []).map(a => (
                                      <span key={a.name} className="mr-2">{a.name} <span className="text-muted-foreground/60">({a.type})</span></span>
                                    ))}
                                    {(d.attributes.typeChanges ?? []).map(t => (
                                      <span key={t.name} className="mr-2 text-amber-600">{t.name}: {t.from} → {t.to} <span className="text-muted-foreground/60">(type differs — decided separately)</span></span>
                                    ))}
                                  </div>
                                ))}
                                <p className="text-[10px] text-muted-foreground">Attribute definitions are created, and values are copied only for the attributes an admin confirmed {target}'s load maintains.</p>
                              </div>
                            )}

                            {(refresh.dimensions ?? []).some(d => (d.removeElements ?? []).length || (d.moves ?? []).length || (d.attributes?.typeChanges ?? []).length) && (
                              <div className="px-3 py-2 border-t border-border/40 space-y-2">
                                <p className="text-[11px] font-semibold text-foreground">PROD deleted or moved these — decide each one</p>
                                {(refresh.dimensions ?? []).filter(d => (d.removeElements ?? []).length || (d.moves ?? []).length || (d.attributes?.typeChanges ?? []).length).map(d => (
                                  <div key={d.dimension} className="space-y-1">
                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{d.dimension}</p>
                                    {(d.removeElements ?? []).map(el => (
                                      <div key={`del-${el}`} className="flex items-center gap-2 text-[11px] flex-wrap">
                                        <span className="text-foreground">Delete {el}</span>
                                        <button onClick={() => setDecision(d.dimension, 'delete', el, 'delete')} className={decisions[d.dimension]?.deletes?.[el] === 'delete' ? 'px-2 py-0.5 rounded bg-red-700 text-white' : 'px-2 py-0.5 rounded border border-border hover:bg-muted'}>Delete on DEV too</button>
                                        <span className="text-muted-foreground/60">its DEV values are cleared</span>
                                        <button onClick={() => setDecision(d.dimension, 'delete', el, 'keep')} className={decisions[d.dimension]?.deletes?.[el] === 'keep' ? 'px-2 py-0.5 rounded bg-amber-700 text-white' : 'px-2 py-0.5 rounded border border-border hover:bg-muted'}>Keep — restore on PROD</button>
                                        <span className="text-muted-foreground/60">next deploy puts it back on PROD, no data</span>
                                      </div>
                                    ))}
                                    {(d.attributes?.typeChanges ?? []).map(t => (
                                      <div key={`attr-${t.name}`} className="flex items-center gap-2 text-[11px] flex-wrap">
                                        <span className="text-foreground">Attribute {t.name}</span>
                                        <span className="text-muted-foreground/60">{server} {t.from} · PROD {t.to} — taking PROD's clears its values</span>
                                        <button onClick={() => setDecision(d.dimension, 'attribute', t.name, 'take')} className={decisions[d.dimension]?.attributes?.[t.name] === 'take' ? 'px-2 py-0.5 rounded bg-amber-700 text-white' : 'px-2 py-0.5 rounded border border-border hover:bg-muted'}>Take PROD's type</button>
                                        <button onClick={() => setDecision(d.dimension, 'attribute', t.name, 'keep')} className={decisions[d.dimension]?.attributes?.[t.name] === 'keep' ? 'px-2 py-0.5 rounded bg-emerald-700 text-white' : 'px-2 py-0.5 rounded border border-border hover:bg-muted'}>Keep DEV's</button>
                                      </div>
                                    ))}
                                    {(d.moves ?? []).map(m => (
                                      <div key={`mv-${m.child}`} className="flex items-center gap-2 text-[11px] flex-wrap">
                                        <span className="text-foreground">Move {m.child}</span>
                                        <span className="text-muted-foreground/60">DEV under {m.fromParent ?? '(none)'} · PROD under {m.toParent}</span>
                                        <button onClick={() => setDecision(d.dimension, 'move', m.child, 'take')} className={decisions[d.dimension]?.moves?.[m.child] === 'take' ? 'px-2 py-0.5 rounded bg-emerald-700 text-white' : 'px-2 py-0.5 rounded border border-border hover:bg-muted'}>Take PROD's</button>
                                        <button onClick={() => setDecision(d.dimension, 'move', m.child, 'keep')} className={decisions[d.dimension]?.moves?.[m.child] === 'keep' ? 'px-2 py-0.5 rounded bg-amber-700 text-white' : 'px-2 py-0.5 rounded border border-border hover:bg-muted'}>Keep DEV's</button>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                                {undecided.length + undecidedCovers.length > 0 && (
                                  <p className="text-[11px] text-red-600">Still to decide: {[...undecided, ...undecidedCovers].map(u => `${u.kind} ${u.element} (${u.dim})`).join(', ')}</p>
                                )}
                              </div>
                            )}
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
                          {(refreshed.errors ?? []).map((k, i) => (
                            <p key={`e-${i}`} className="text-[10px] text-red-600">FAILED {k.dimension}: {k.why}</p>
                          ))}
                        </div>
                      )}
                      {error && <p className="text-[11px] text-red-600">{error}</p>}
                    </>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    {!session?.closed_at && (
                      <button onClick={doRefresh} disabled={refreshBusy || (!(refresh?.dimensions ?? []).some(d => ticked[d.dimension]) && (refresh?.subsets ?? []).length === 0 && (refresh?.views ?? []).length === 0 && (refresh?.hierarchies ?? []).length === 0) || undecided.length + undecidedCovers.length > 0} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">
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
                  {release?.noChange && (
                    <div className="border border-border rounded-md p-3 space-y-1">
                      <p className="text-xs font-semibold">Nothing to deploy</p>
                      <p className="text-[11px] text-muted-foreground">{release.reason}</p>
                      <p className="text-[11px] text-muted-foreground">Recorded as done with this reason; it no longer blocks other change sets.</p>
                    </div>
                  )}
                  {release && !release.noChange && (
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
                    {release && !release.noChange && <button onClick={() => setStep(5)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Continue to Review</button>}
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
