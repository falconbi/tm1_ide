import { useState, useEffect, useRef } from 'react'
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
// It replaces both the one-button Ship dialog and the eight-step wizard. Two
// entrances for one job is what made "which path is the product?" a question;
// this is the answer. Catch-up was removed with the wizard: a server is brought
// level by ordinary releases, built from its own copy.

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
const fmtDate = (iso) => {
  if (!iso) return 'its last deploy'
  try {
    return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return 'its last deploy' }
}
// Pre-deploy is a CHECK (Part D: it writes nothing to PROD or DEV), so there is no
// "refresh/copy" step here. Copying PROD's own changes onto DEV is Sync DEV (Part E),
// a separate action that records into its own never-deployed set.
const OPEN_STEPS = ['Check PROD', 'Tests & close', 'Build release', 'Review']
// A set that is already closed has nothing to test or close: the flow is a
// target check, a release, and a review. The numbers follow the real path.
const CLOSED_STEPS = ['Check PROD', 'Build release', 'Review']
// What the deploy does to an object, in a word a person reads. 'M' means the
// target already has it; a dimension is REPLACED (the pull recreates it).
const actionWord = (o) => o.action === 'D' ? 'deleted' : o.action === 'A' ? 'added' : (o.type === 'dimension' ? 'replaced' : 'changed')
const kindLabel = (k) => k === 'rule-process' ? 'Rule/process' : `${String(k ?? '').charAt(0).toUpperCase()}${String(k ?? '').slice(1)}`
// An attribute file and its dimension are one object to a reader: show one bullet,
// not two. An attribute change on its own keeps its own row.
const foldAttributeRows = (rows = []) => (rows ?? []).filter(r =>
  r.kind !== 'attribute' || !(rows ?? []).some(o => o !== r && o.object === r.object && o.kind !== 'attribute')
)
// "PROD has this, DEV does not" — the gap a developer wants, not just the drift.
const devMissingText = (m) => {
  if (!m) return null
  const list = (xs, max = 8) => `${xs.slice(0, max).join(', ')}${xs.length > max ? `, +${xs.length - max} more` : ''}`
  if (m.kind === 'subset') {
    if (m.missing) return { gap: true, text: 'This subset is not in DEV.' }
    if ((m.members ?? []).length) return { gap: true, text: `These members are not in DEV: ${list(m.members)}.` }
    return null
  }
  const bits = [...(m.elements ?? []), ...(m.edges ?? []).map(k => String(k).split('::').join(' → '))]
  if (!bits.length) return null
  return { gap: true, text: `These elements are not in DEV: ${list(bits)}.` }
}
// "Replace Dimensions('WFP Employee')" → "replace dimension WFP Employee".
const planOpWords = (op) => {
  const m = String(op ?? '').match(/^(\w+)\s+(\w+)\('([^']+)'\)/)
  if (!m) return String(op ?? '')
  return `${m[1].toLowerCase()} ${m[2].toLowerCase().replace(/s$/, '')} ${m[3]}`
}
// "+1 element: X · -2 edges: P → C" in words a person reads.
const friendlySummary = (s) => String(s ?? '').split(' · ').map(part =>
  part
    .replace(/^\+(\d+) element(s?):/i, '$1 new element$2:')
    .replace(/^-(\d+) element(s?):/i, '$1 element$2 removed:')
    .replace(/^\+(\d+) edge(s?):/i, '$1 new link$2:')
    .replace(/^-(\d+) edge(s?):/i, '$1 link$2 removed:')
).join(' · ')

function StepHeader({ step, phase, steps = OPEN_STEPS }) {
  const label = phase === 'deploy' ? 'Deploy' : `Pre-deploy ${step} of ${steps.length}`
  const title = phase === 'deploy' ? 'Deploy it' : steps[step - 1]
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
  // Fix the step model when the flow opens: a closed set skips Tests & close for
  // the whole run, so the numbers and the header never change under the person.
  const closedAtOpen = !!session?.closed_at
  const STEPS = closedAtOpen ? CLOSED_STEPS : OPEN_STEPS
  const STEP = closedAtOpen ? { check: 1, build: 2, review: 3 } : { check: 1, tests: 2, build: 3, review: 4 }

  const [servers, setServers] = useState([])
  const [target, setTarget] = useState(ship?.target ?? '')
  const [phase, setPhase] = useState('start')   // start | pre | deploy | done
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [prog, setProg] = useState('')          // one line for the running step

  const [idle, setIdle] = useState(null)
  const [idleConfirmed, setIdleConfirmed] = useState(false)
  const [preCheck, setPreCheck] = useState(null)
  const [preBusy, setPreBusy] = useState(false)
  const [carryBusy, setCarryBusy] = useState(false)
  const [carryResult, setCarryResult] = useState(null)
  // A chore due inside the deploy window: the person must say "deploy anyway".
  const [choreAck, setChoreAck] = useState(false)
  const [tests, setTests] = useState(null)
  const [closeInfo, setCloseInfo] = useState(null)
  const [closeBlocking, setCloseBlocking] = useState(null)
  const [closeCheck, setCloseCheck] = useState(null)
  const [takeValues, setTakeValues] = useState({})
  const [closed, setClosed] = useState(false)
  const [release, setRelease] = useState(null)
  // 'left on DEV' rows the person chose to include in the release (key → true)
  const [includeLeft, setIncludeLeft] = useState({})
  const [prep, setPrep] = useState(null)
  const [loss, setLoss] = useState(null)        // computed loss for the release
  const [lossOk, setLossOk] = useState(false)
  const [typeOk, setTypeOk] = useState(false)      // "Yes, change these" for element types
  const [approved, setApproved] = useState(false)
  const [settings, setSettings] = useState(null)
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

  // Part F.4 — read-only close check: values since the last close, type changes,
  // and any deleted object a DEV process still uses.
  useEffect(() => {
    if (closedAtOpen || step !== 2 || closed || !session?.id || session?.closed_at) return
    let live = true
    GET(`/api/sessions/${encodeURIComponent(session.id)}/close-check`)
      .then(d => { if (live) setCloseCheck(d) })
      .catch(() => { if (live) setCloseCheck(null) })
    return () => { live = false }
  }, [step, closed, session?.id, session?.closed_at])

  // Part D — the pre-deploy check runs first and Continue waits for it. It is
  // read-only: the target writes its own live snapshot, the IDE writes attrs.
  const loadPreCheck = async () => {
    setPreBusy(true); setPreCheck(null); setError(null)
    try {
      const d = await POST('/api/deploy/pre-check', { target, source: server, session: session?.id ?? null })
      setPreCheck(d)
    } catch (e) { setPreCheck({ error: e.message }) }
    finally { setPreBusy(false) }
  }

  const checkIdle = async () => {
    setBusy('idle'); setError(null); setChoreAck(false); setIdleConfirmed(false)
    try {
      const d = await GET(`/api/deploy/idle?server=${encodeURIComponent(target)}`)
      setIdle(d)
      if (!(d.running ?? []).length) await loadPreCheck()
    }
    catch (e) { setError(e.message); setIdle(null) }
    finally { setBusy('') }
  }

  // D.4.2 — copy PROD's own rule/process text onto DEV in a carry-back set.
  const doCarryBack = async () => {
    setCarryBusy('carry'); setError(null)
    try {
      const objects = (preCheck?.carryBack ?? []).map(r => ({
        type: /\.rules$/i.test(String(r.file)) ? 'rules' : 'process',
        name: r.object,
      }))
      const d = await POST('/api/deploy/carry-back', { source: server, target, objects })
      setCarryResult(d)
      await loadPreCheck()
    } catch (e) { setError(e.message) }
    finally { setCarryBusy('') }
  }

  const start = async () => {
    if (!target) return
    setPhase('pre'); setStep(1)
    await checkIdle()
  }

  // Open the assertion editor (App owns the overlay). The change set stays open,
  // so after fixing the test the developer reopens Deploy for it and runs the
  // close again.
  const openTests = () => {
    closeShip()
    window.dispatchEvent(new CustomEvent('tm1-open-assertions'))
  }

  const doTestsAndClose = async () => {
    setBusy('close'); setError(null); setCloseBlocking(null); setProg('Running the model tests…')
    try {
      const acceptValues = (closeCheck?.attributeValues ?? [])
        .filter(v => v.canTake && takeValues[`${v.dimension}::${v.element}::${v.attribute}`])
        .map(v => ({ dimension: v.dimension, element: v.element, attribute: v.attribute }))
      // A 409 lists the blocking tests, and the person needs their names to fix
      // them (or to change severity). lib/api attaches the server's body to the
      // thrown error as `data`, so the list survives the failure.
      let d
      try {
        d = await POST('/api/sessions/close', { id: session.id, acceptValues })
      } catch (e) {
        if (Array.isArray(e.data?.blocking) && e.data.blocking.length) setCloseBlocking(e.data.blocking)
        throw e
      }
      // close_tests is stored as a JSON string on the session.
      let t = d.close_tests ?? null
      if (typeof t === 'string') { try { t = JSON.parse(t) } catch { t = null } }
      setTests(t); setCloseInfo(d); setClosed(true)
      // Stay on this step: the results and the "Continue to Build release" button
      // are the visible outcome. Auto-advancing hid the tests entirely.
    } catch (e) {
      // "is closed" is not a failure: the set was already closed, by an earlier
      // close or by another window. Treat it as closed and move on, rather than
      // showing a red error on a set that is perfectly fine.
      if (/is closed/i.test(e.message ?? '')) {
        setClosed(true)
        setError(null)
        setProg('')
      } else {
        setError(e.message)
      }
    }
    finally { setBusy(''); setProg('') }
  }

  // Build the release, optionally including objects that are already changed on DEV
  // but that no change set owns (a dimension cut made outside a change set, say).
  // Without this the release ships only what the change set owns and Review reports
  // a loss of 0 — which reads like "nothing to change".
  const buildWith = async (addObjects = []) => {
    setBusy('release'); setError(null)
    setProg(addObjects.length ? 'Rebuilding with the objects you included…' : 'Building a release of just this change…')
    try {
      const rel = await POST('/api/deploy/git/release', { source: server, target, session: session.id, addObjects })
      // Already matches the target: recorded as done, nothing to approve.
      if (rel?.noChange) { setRelease({ noChange: true, reason: rel.reason }); setStep(STEP.build); return }
      if (!rel?.releaseCommit) throw new Error('The release could not be built.')
      setRelease(rel)
      setIncludeLeft({})
      setProg('Reading the target…')
      // The loss gate reads via POST; a failure here is shown at Review, never fatal.
      const p = await POST('/api/deploy/git/loss', { target, commit: rel.releaseCommit }).catch(() => null)
      setLoss(p)
      setPrep(await POST('/api/deploy/git/prepare', { source: server, target, session: session.id, branch: `release-${target}` }).catch(e => ({ error: e.message })))
      setStep(STEP.build)
    } catch (e) { setError(e.message) }
    finally { setBusy(''); setProg('') }
  }
  const doBuild = () => buildWith([])
  const leftRows = release?.leftOnDev ?? []
  const rebuildWithIncludes = () => buildWith(leftRows
    .filter(r => includeLeft[r.key])
    .map(r => ({ type: r.type, name: r.name, parent: r.parent })))

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
      const d = await POST('/api/deploy/git/execute', { source: server, target, session: session.id })
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

  // A set that was already closed before this flow (the normal "Ready to deploy"
  // entry) has its commit and its close tests. Re-closing it would re-run the tests
  // and push DEV again for nothing, so the Tests & close step only confirms.
  const sessionTests = (() => {
    try { return session?.close_tests ? JSON.parse(session.close_tests) : null } catch { return null }
  })()
  const shownTests = tests ?? sessionTests
  const alreadyClosed = !!session?.closed_at || closed

  const outcome = res ? classifyDeployOutcome(res) : null
  const doneOk = res?.executed && res?.controlOk !== false && (drift?.entries ?? []).length === 0
  const blockIdle = (idle?.running ?? []).length > 0
  // Our own deployment connection is always signed in; it is reported, not confirmed.
  const needIdleConfirm = idle?.needsConfirm !== false && (idle?.sessions ?? []).length > 0 && !idleConfirmed
  const lossNeedsConfirm = decideLossGate({ loss: loss?.loss }) === 'confirm' && !lossOk
  // The backup is required and taken by the IDE (Part I.3): a configured process,
  // or }IDE.Backup which Save Data + zips the folder beside the data. There is no
  // typed-in time — it proved nothing and the server ignores it.
  const canDeploy = approved && !!settings && !busy

  // The window can be dragged by its title bar. It used to close instead: a drag
  // that started on the panel and ended on the backdrop produced a click on the
  // backdrop, which is the close gesture. The backdrop now closes only when the
  // press AND the release are both on the backdrop itself.
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const dragFrom = useRef(null)
  const downOnBackdrop = useRef(false)
  const startDrag = (e) => {
    if (busy || e.button !== 0 || e.target.closest('button')) return
    e.preventDefault()
    dragFrom.current = { x: e.clientX - drag.x, y: e.clientY - drag.y }
    const move = (ev) => {
      if (!dragFrom.current) return
      setDrag({ x: ev.clientX - dragFrom.current.x, y: ev.clientY - dragFrom.current.y })
    }
    const up = () => {
      dragFrom.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[120] flex items-center justify-center"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onMouseUp={e => {
        const both = downOnBackdrop.current && e.target === e.currentTarget
        downOnBackdrop.current = false
        if (both && !busy) closeShip()
      }}
    >
      <div
        className="w-[620px] max-w-[calc(100vw-32px)] max-h-[88vh] bg-background border border-border rounded-lg shadow-xl flex flex-col"
        style={{ transform: `translate(${drag.x}px, ${drag.y}px)` }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className={cn('flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0', !busy && 'cursor-move select-none')}
          onMouseDown={startDrag}
        >
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
              {closedAtOpen && (
                <p className="text-[11px] text-muted-foreground">
                  This change set is already closed{session?.commit_ref ? <> at <span className="font-mono">{String(session.commit_ref).slice(0, 10)}</span></> : null}.
                  Pre-deploy will only check the target and rebuild the release for it — the set is not closed again.
                </p>
              )}
              <button onClick={start} disabled={!target} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">Start pre-deploy</button>
            </>
          )}

          {phase === 'pre' && (
            <>
              <StepHeader step={step} phase="pre" steps={STEPS} />

              {closedAtOpen && (
                <div className="rounded-md border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground">
                  <span className="text-foreground font-medium">Change set closed</span>
                  {session?.commit_ref ? <> at <span className="font-mono">{String(session.commit_ref).slice(0, 10)}</span></> : null}
                  {' '}— before deploying, the IDE checks {target || 'the target'}: is it busy, has anything changed there since its last deploy, and what is different.
                  The change set itself is not run again.
                </div>
              )}

              {step === 1 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    This check is read-only. It looks at three things: whether {target} is busy, whether it has changed since its last deploy, and what it has that {server} does not.
                    It builds nothing, runs no tests, and writes nothing to {target} or {server}. It decides whether the deploy can go ahead, and what you should know first.
                  </p>
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
                    <div className="border border-amber-600/40 bg-amber-500/5 rounded-md p-3 space-y-2">
                      <p className="text-xs font-semibold text-amber-700">A chore is due during the deploy window</p>
                      <p className="text-[11px]">{idle.choresDue.map(c => `${c.name} at ${fmt(c.at)}`).join(', ')} — it can start mid-deploy and change the model while the release is landing.</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setChoreAck(true)} className={cn('px-2.5 py-1 text-[11px] rounded', choreAck ? 'bg-amber-700 text-white' : 'border border-border hover:bg-muted')}>Deploy anyway</button>
                        <button onClick={() => setChoreAck(false)} className={cn('px-2.5 py-1 text-[11px] rounded', !choreAck ? 'bg-muted text-foreground' : 'border border-border hover:bg-muted')}>Wait</button>
                      </div>
                      {choreAck
                        ? <p className="text-[11px] text-amber-700">Recorded: deploying into a chore window.</p>
                        : <p className="text-[11px] text-muted-foreground">Wait until the chore has run, then press <em>Check again</em>.</p>}
                    </div>
                  )}
                  {needIdleConfirm && (
                    <label className="flex items-start gap-2 text-[11px]">
                      <input type="checkbox" checked={idleConfirmed} onChange={e => setIdleConfirmed(e.target.checked)} className="mt-0.5" />
                      <span>I know {idle.sessions.length} {idle.sessions.length === 1 ? 'person is' : 'people are'} signed in to {target} ({idle.sessions.join(', ')}).</span>
                    </label>
                  )}
                  {preBusy && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Checking {target} against what it last received…</p>}
                  {preCheck?.error && <p className="text-[11px] text-red-600">The pre-deploy check could not run: {preCheck.error}</p>}
                  {preCheck && !preCheck.error && (
                    <div className={cn('border rounded-md p-3 space-y-1.5', preCheck.stops?.length ? 'border-red-600/40 bg-red-500/5' : 'border-emerald-600/30 bg-emerald-600/5')}>
                      <p className={cn('text-xs font-semibold flex items-center gap-1.5', preCheck.stops?.length ? 'text-red-600' : 'text-emerald-700')}>
                        {preCheck.stops?.length ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                        Pre-deploy check {preCheck.stops?.length ? 'stopped' : 'passed'}
                      </p>
                      {(preCheck.stops ?? []).map((s, i) => (
                        <p key={`s-${i}`} className="text-[11px] text-red-600"><span className="font-medium">{s.object ?? s.kind}</span> — {s.reason}</p>
                      ))}
                      {(preCheck.carryBack ?? []).length > 0 && (
                        <div className="text-[11px]">
                          <p className="font-medium">A rule or process changed on {target}:</p>
                          {preCheck.carryBack.map((r, i) => <p key={`c-${i}`} className="text-muted-foreground">— {r.kind === 'rule-process' ? 'rule/process' : r.kind} {r.object}</p>)}
                          <button onClick={doCarryBack} disabled={!!carryBusy} className="mt-1 px-2.5 py-1 text-[11px] rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">
                            {carryBusy === 'carry' ? 'Bringing…' : `Bring ${target}'s version onto ${server}`}
                          </button>
                          {carryResult?.ok && <p className="text-emerald-700 mt-1">{carryResult.note}</p>}
                          {carryResult?.refused && <p className="text-red-600 mt-1">{carryResult.error}</p>}
                        </div>
                      )}
                      {(preCheck.kept ?? []).length > 0 && (
                        <div className="border border-border rounded-md p-2 space-y-1">
                          <p className="text-[11px] font-medium text-foreground">
                            {target} changed since the deploy on {fmtDate(preCheck.live?.deployedAt)}
                            {preCheck.live?.deployed ? <> (<span className="font-mono">{String(preCheck.live.deployed).slice(0, 8)}</span>)</> : null}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            These changes stay on {target}. Where the release includes the object, it is built from {target}'s own copy, so the changes travel with it. Where it does not, the deploy leaves the object alone. Nothing is copied to {server}.
                          </p>
                          {foldAttributeRows(preCheck.kept ?? []).map((k, i) => {
                            const gap = devMissingText(k.devMissing)
                            return (
                              <div key={`k-${i}`}>
                                <p className="text-[11px] text-muted-foreground">
                                  • {kindLabel(k.kind)} <span className="font-mono text-foreground">{k.object}</span>
                                  {k.summary ? <span className="text-muted-foreground/80"> — {friendlySummary(k.summary)}</span> : null}
                                </p>
                                {gap && <p className={`pl-3 text-[10px] ${gap.gap ? 'text-amber-700' : 'text-muted-foreground/70'}`}>{gap.text}</p>}
                              </div>
                            )
                          })}
                          {(preCheck.sync ?? []).length > 0 && (
                            <p className="text-[10px] text-muted-foreground">
                              Nothing is copied to {server}. If {server} needs any of it, copy it from {target} with
                              Sync DEV — a separate action.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => setStep(2)} disabled={!idle || blockIdle || !preCheck || !!preCheck.error || (preCheck.stops?.length ?? 0) > 0 || needIdleConfirm || ((idle?.choresDue ?? []).length > 0 && !choreAck)} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">Continue</button>
                    <button onClick={checkIdle} disabled={busy === 'idle'} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Check again</button>
                  </div>
                </div>
              )}


              {!closedAtOpen && step === 2 && (
                <div className="space-y-2">
                  <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2 text-[11px] text-muted-foreground leading-relaxed">
                    <p>
                      <span className="text-foreground font-medium">What runs:</span> the model's tests (assertions) on {server} —
                      <span className="text-foreground"> behaviour</span> tests check the numbers still produce the approved result,
                      and <span className="text-foreground">control</span> tests check the model is internally sound.
                    </p>
                    <p>
                      <span className="text-foreground font-medium">If a block-severity test fails:</span> the close stops here.
                      Nothing is committed and the change set stays open. Fix the issue on {server} — or set that test's severity to
                      <span className="text-foreground"> warn</span> if it is advisory — then press <span className="text-foreground">Run tests and close</span> again.
                      A failed test is never skipped silently.
                    </p>
                    <p>
                      <span className="text-foreground font-medium">If they pass:</span> the change set is closed and TM1 writes {server}'s
                      objects into the <span className="font-mono text-foreground">dev</span> branch (the
                      <span className="text-foreground"> DEV After Close</span> commit); the IDE writes its attributes to
                      <span className="font-mono text-foreground"> attrs-{server}</span>. Build Release uses that commit, not the live DEV files.
                    </p>
                    <p className="text-muted-foreground/70">This runs once per change set; an already-closed set shows its commit and tests instead.</p>
                  </div>
                  {session?.closed_at && !closed && (
                    <div className="border border-border rounded-md p-2 space-y-1">
                      <p className="text-[11px] font-semibold">This change set is already closed</p>
                      <p className="text-[10px] text-muted-foreground">
                        Closed {new Date(session.closed_at).toLocaleString()}
                        {session.commit_ref ? ` · DEV After Close ${String(session.commit_ref).slice(0, 10)}` : ''}.
                        Its tests ran at close; Build release can continue from that commit.
                      </p>
                    </div>
                  )}
                  {closeCheck && closeCheck.ok === false && (
                    <div className="border border-red-600/40 bg-red-500/5 rounded-md p-2 space-y-1">
                      <p className="text-[11px] font-semibold text-red-600">The close will stop</p>
                      {(closeCheck.stops ?? []).map((s, i) => <p key={i} className="text-[10px] text-red-600">{s}</p>)}
                    </div>
                  )}
                  {(closeCheck?.attributeValues ?? []).some(v => v.canTake || !v.take) && (
                    <div className="border border-border rounded-md p-2 space-y-1">
                      <p className="text-[11px] font-semibold">Attribute values changed on {server} since the last close</p>
                      {(closeCheck.attributeValues ?? []).filter(v => v.canTake || !v.take).map((v, i) => {
                        const key = `${v.dimension}::${v.element}::${v.attribute}`
                        return (
                          <label key={i} className="flex items-center gap-2 text-[10px]">
                            <input type="checkbox" disabled={!v.canTake} checked={!!takeValues[key]} onChange={e => setTakeValues(p => ({ ...p, [key]: e.target.checked }))} />
                            <span>{v.dimension}.{v.element}.{v.attribute}: {String(v.before ?? '')} → {String(v.after)}</span>
                            <span className="text-muted-foreground">· {v.owned}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                  {shownTests && (
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-[11px]">Tests: <span className={shownTests.blocking ? 'text-red-600' : 'text-emerald-700'}>{shownTests.passed}/{shownTests.total} passed</span>{shownTests.blocking ? ` · ${shownTests.blocking} blocking` : ''}</p>
                      {shownTests.total > shownTests.passed && (
                        <button
                          onClick={() => { closeShip(); useStore.getState().setDeployView('health') }}
                          className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          title="Open Model health to see which tests did not pass"
                        >
                          See the {shownTests.total - shownTests.passed} that did not pass
                        </button>
                      )}
                    </div>
                  )}
                  {(closeBlocking ?? []).length > 0 && (
                    <div className="border border-red-600/40 bg-red-500/5 rounded-md p-2 space-y-1">
                      <p className="text-[11px] font-semibold text-red-600">
                        {closeBlocking.length} block-severity test{closeBlocking.length === 1 ? '' : 's'} failed — the close stopped
                      </p>
                      {closeBlocking.map((b, i) => (
                        <p key={i} className="text-[10px]">
                          <span className="font-medium">{b.description}</span>
                          {b.expected != null && <span className="text-muted-foreground"> · expected {String(b.expected)}</span>}
                          {b.actual != null && <span className="text-muted-foreground"> · got {String(b.actual)}</span>}
                          {b.error && <span className="text-red-600"> · {b.error}</span>}
                        </p>
                      ))}
                      <button onClick={openTests} className="mt-1 px-2.5 py-1 text-[11px] rounded bg-red-700 text-white hover:bg-red-600">Open tests</button>
                      <p className="text-[10px] text-muted-foreground">
                        Fix it on {server}, or set this test's severity to warn in the test editor. Nothing was committed;
                        the change set stays open. Reopen its deploy and run Tests &amp; close again.
                      </p>
                    </div>
                  )}
                  {closeInfo?.finalized?.commit && <p className="text-[11px] text-emerald-700">DEV After Close: <span className="font-mono">{String(closeInfo.finalized.commit).slice(0, 10)}</span>{closeInfo.finalized.attrsError ? ` · attributes: ${closeInfo.finalized.attrsError}` : ''}</p>}
                  {closeInfo?.finalized?.error && <p className="text-[11px] text-red-600">DEV After Close failed: {closeInfo.finalized.error}</p>}
                  {(closeInfo?.closeCheck?.attributeValues ?? []).filter(v => !v.take).length > 0 && (
                    <div className="border border-amber-600/40 bg-amber-500/5 rounded-md p-2 space-y-1">
                      <p className="text-[11px] font-semibold text-amber-700">Attribute values changed on {server} since the last close</p>
                      {closeInfo.closeCheck.attributeValues.filter(v => !v.take).slice(0, 12).map((v, i) => (
                        <p key={i} className="text-[10px]">{v.dimension}.{v.element}.{v.attribute}: {String(v.before ?? '')} → {String(v.after)} · {v.owned}</p>
                      ))}
                    </div>
                  )}
                  {error && !(closeBlocking ?? []).length && <p className="text-[11px] text-red-600">{error}</p>}
                  {busy && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> {prog}</p>}
                  <div className="flex items-center gap-2 pt-1">
                    {alreadyClosed ? (
                      <button onClick={() => setStep(STEP.build)} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600">Continue to Build release</button>
                    ) : (
                      <button onClick={doTestsAndClose} disabled={!!busy} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">
                        Run tests and close
                      </button>
                    )}
                    <button onClick={() => setStep(1)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Back</button>
                  </div>
                </div>
              )}

              {step === STEP.build && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">The release starts from {target} as it is now and adds this change set. Nothing else from {server} is included.</p>
                  {release?.noChange && leftRows.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">This change set has nothing to send. {leftRows.length} other object{leftRows.length === 1 ? '' : 's'} differ on {server} — tick any you want to send too</p>
                  )}
                  {release?.noChange && leftRows.length === 0 && (
                    <div className="border border-border rounded-md p-3 space-y-1">
                      <p className="text-xs font-semibold">Nothing to deploy</p>
                      <p className="text-[11px] text-muted-foreground">{release.reason}</p>
                      <p className="text-[11px] text-muted-foreground">Recorded as done with this reason; it no longer blocks other change sets.</p>
                    </div>
                  )}
                  {release && !release.noChange && (
                    <div className="border border-border rounded-md p-3 space-y-1">
                      <p className="text-[11px]">Release <span className="font-mono">{String(release.releaseCommit).slice(0, 10)}</span> · ships <span className="font-semibold">{release.included?.length ?? 0}</span></p>
                      {(release.included ?? []).map((o, i) => (
                        <p key={i} className="text-[11px] text-muted-foreground">{actionWord(o)} · {o.type} <span className="font-mono text-foreground">{o.name}</span></p>
                      ))}
                      {(release.included ?? []).length === 0 && <p className="text-[11px] text-muted-foreground">Nothing to ship.</p>}
                    </div>
                  )}
                  {release && leftRows.length > 0 && (
                    <div className="border border-amber-600/40 bg-amber-600/5 rounded-md p-3 space-y-2">
                      <p className="text-[11px] font-semibold text-amber-700">On {server}, but not sent</p>
                      <p className="text-[10px] text-muted-foreground">This change set did not change these, so they are not sent. {target} keeps what it already has. Tick any you want to send too.</p>
                      {leftRows.map(r => (
                        <label key={r.key} className="flex items-center gap-2 text-[11px]">
                          <input type="checkbox" checked={!!includeLeft[r.key]} onChange={e => setIncludeLeft(p => ({ ...p, [r.key]: e.target.checked }))} />
                          <span className="text-muted-foreground/60">{r.type}</span>
                          <span className="font-mono">{r.name}</span>
                          {r.files.length > 1 && <span className="text-muted-foreground/60">{r.files.length} files</span>}
                        </label>
                      ))}
                      <button onClick={rebuildWithIncludes} disabled={!!busy || !leftRows.some(r => includeLeft[r.key])} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">
                        {busy === 'release' ? 'Rebuilding…' : 'Rebuild with the ticked ones'}
                      </button>
                    </div>
                  )}
                  {(release?.targetNotes ?? []).length > 0 && (
                    <div className="border border-border rounded-md p-3 space-y-1">
                      <p className="text-[11px] font-semibold">From {target}</p>
                      {(release.targetNotes ?? []).map((n, i) => <p key={i} className="text-[11px] text-muted-foreground">{n}</p>)}
                    </div>
                  )}
                  {(release?.indexNotes ?? []).length > 0 && (
                    <div className="border border-amber-600/40 bg-amber-600/5 rounded-md p-3 space-y-1">
                      <p className="text-[11px] font-semibold text-amber-700">Index changes</p>
                      {(release.indexNotes ?? []).map((n, i) => <p key={i} className="text-[11px]">{n}</p>)}
                    </div>
                  )}
                  {(release?.attributePlan?.values ?? []).length > 0 && (
                    <div className="border border-border rounded-md p-3 space-y-1">
                      <p className="text-[11px] font-semibold">Attribute values this release writes</p>
                      {(release.attributePlan.values ?? []).slice(0, 12).map((v, i) => (
                        <p key={i} className="text-[11px] text-muted-foreground">{v.dim}.{v.element}.{v.attribute} = {String(v.value)}</p>
                      ))}
                      {(release.attributePlan.values ?? []).length > 12 && <p className="text-[10px] text-muted-foreground">…and {release.attributePlan.values.length - 12} more</p>}
                    </div>
                  )}
                  {(release?.attributePlan?.notes ?? []).map((n, i) => (
                    <p key={`an-${i}`} className="text-[11px] text-muted-foreground">{n}</p>
                  ))}
                  {(release?.warnings ?? []).map((w, i) => (
                    <p key={i} className="text-[11px] text-amber-700">{w}</p>
                  ))}
                  {error && <p className="text-[11px] text-red-600">{error}</p>}
                  {busy && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> {prog}</p>}
                  <div className="flex items-center gap-2 pt-1">
                    {release && !release.noChange ? (
                      <>
                        <button onClick={() => setStep(STEP.review)} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600">Continue to Review</button>
                        <button onClick={doBuild} disabled={!!busy} className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40">Rebuild release</button>
                      </>
                    ) : (
                      <button onClick={doBuild} disabled={!!busy} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">{release ? 'Rebuild release' : 'Build release'}</button>
                    )}
                    <button onClick={() => setStep(closedAtOpen ? 1 : 2)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Back</button>
                  </div>
                </div>
              )}

              {step === STEP.review && (
                <div className="space-y-2">
                  {prep?.error && <p className="text-[11px] text-red-600">{prep.error}</p>}
                  {(() => {
                    const ops = prep?.plan?.ops ?? []
                    const changes = ops.filter(o => !/^skip\b/i.test(String(o)))
                    const same = ops.length - changes.length
                    if (!ops.length) return <p className="text-xs">On <span className="font-semibold">{target}</span>: nothing changes.</p>
                    if (!changes.length) return <p className="text-xs">On <span className="font-semibold">{target}</span>: nothing changes — all {same} objects are already identical.</p>
                    return (
                      <div className="space-y-0.5">
                        <p className="text-xs">On <span className="font-semibold">{target}</span>: <span className="font-semibold">{changes.length}</span> object{changes.length === 1 ? '' : 's'} change{same ? `, ${same} already identical` : ''}.</p>
                        {changes.map((o, i) => <p key={i} className="text-[11px] text-muted-foreground">— {planOpWords(o)}</p>)}
                      </div>
                    )
                  })()}
                  {(release?.included ?? []).map((o, i) => (
                    <div key={i} className="flex items-baseline gap-2 text-[11px] px-2 py-1 rounded bg-muted/30">
                      <span className="text-muted-foreground">{actionWord(o)}</span>
                      <span className="text-muted-foreground/60">{o.type}</span>
                      <span className="font-mono">{o.name}{o.parent ? ` (${o.parent})` : ''}</span>
                    </div>
                  ))}
                  {(release?.leftOnDev ?? []).some(x => x.type === 'dimension') && (
                    <div className="border border-amber-600/40 bg-amber-600/5 rounded-md p-3 space-y-1">
                      <p className="text-xs font-semibold text-amber-700">Not in this deploy</p>
                      <p className="text-[11px] text-muted-foreground">These differ on {server} and stay as they are on {target}:</p>
                      {(release.leftOnDev ?? []).filter(x => x.type === 'dimension').map(x => (
                        <p key={x.key} className="text-[11px]">
                          <span className="font-mono">{x.name}</span>{' '}
                          <span className="text-muted-foreground">
                            (DEV {x.devCount ?? '?'}{x.targetCount != null ? `, ${target} ${x.targetCount}` : ''} elements)
                          </span>
                        </p>
                      ))}
                    </div>
                  )}
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
                  {prep && !prep.error && prep.loss && prep.loss.elements === 0 && (() => {
                    const ships = release?.included ?? []
                    const kinds = [...new Set(ships.map(o => o.type))]
                    return (
                      <div className="text-[11px] space-y-0.5">
                        <p><span className="text-muted-foreground">Deletes:</span> nothing. {target} keeps everything it has.</p>
                        <p>
                          <span className="text-muted-foreground">Changes:</span>{' '}
                          {ships.length === 0 ? 'nothing in the model.' : `${ships.length} object${ships.length === 1 ? '' : 's'} — ${kinds.join(', ')}`}
                        </p>
                      </div>
                    )
                  })()}
                  {prep?.elementLossError && (
                    <p className="text-[11px] text-amber-700">
                      Could not check what this deploy removes from {target}: {prep.elementLossError}
                    </p>
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
                    <button onClick={() => setStep(STEP.build)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Back</button>
                  </div>
                </div>
              )}
            </>
          )}

          {phase === 'deploy' && !res && (
            <>
              <StepHeader phase="deploy" />
              <p className="text-xs">Ships <span className="font-semibold">{release?.included?.length ?? 0}</span> object{(release?.included?.length ?? 0) === 1 ? '' : 's'} · release <span className="font-mono">{String(release?.releaseCommit ?? '').slice(0, 10)}</span>.</p>
              <p className="text-[11px] text-muted-foreground">
                <span className="text-foreground font-medium">If it goes wrong:</span> restore {target}'s data folder from the backup
                this deploy takes, then use <em>{target} restored from a backup</em> (Deploy → Drift, admin only) to move its pointers back to that backup's tag.
              </p>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} className="mt-0.5" />
                <span>I approve sending <span className="font-semibold">{session?.name}</span> to <span className="font-semibold">{target}</span>.</span>
              </label>
              {settings?.backupProcess
                ? <p className="text-[11px] text-muted-foreground">Backup process <span className="font-mono text-foreground">{settings.backupProcess}</span> runs after Save Data; if it fails, nothing is sent.</p>
                : <p className="text-[11px] text-muted-foreground">Save Data, then <span className="font-mono text-foreground">{'}'}IDE.Backup</span> zips {target}'s data folder beside it. If the archive fails, nothing is sent.</p>}
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
                  {drift ? (drift.entries?.length ? ` · ${drift.entries.length} change${drift.entries.length === 1 ? '' : 's'} found on the target` : ' · target unchanged') : ''}
                  {res.feeders?.cubes?.length ? ` · feeders ${res.feeders.cubes.length}` : ''}
                </p>
                {res.devTests && !res.devTests.error && (
                  <p className={cn('text-[11px]', res.devTests.failed ? 'text-red-600' : 'opacity-90')}>
                    Logic checks on {target}: {res.devTests.passed} of {res.devTests.total} passed
                    {res.devTests.failed ? ` — failed: ${(res.devTests.failures ?? []).map(f => f.description).join(', ')}` : ''}
                  </p>
                )}
                {!res.signoff && (
                  <p className="text-[11px] font-medium">
                    Awaiting sign-off. Everything the tool can check has passed; this part is yours. Test it by hand on {target},
                    then confirm it: <span className="text-foreground">Change Sets → this change set → ⋯ → “I tested this on….”</span>.
                  </p>
                )}
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
