import { request } from '@/lib/api'
import { useState, useEffect, useRef } from 'react'
import { useActiveWorkSession, useCloseWorkSession, useWorkSessions } from '@/hooks/useApi'
import { humanizeFile } from '@/lib/tm1-terms'
import DiffViewerModal from '@/components/DiffViewerModal'
import { classifyDeployOutcome, toneClasses } from '@/lib/deploy/deploy-outcome'

// Deploy wizard — the deploy journey in one guided screen:
//   Test → Close → Commit → Build release → Review → Approve → Deploy → Verify
// A release carries EXACTLY this change set's objects (built on the target's
// recorded deployed commit). The old whole-snapshot path is gone.
const authHeader = () => ({ 'x-ide-token': localStorage.getItem('tm1-token') ?? '' })
const username = () => localStorage.getItem('tm1-username') ?? 'unknown'

function groupByType(items) {
  const groups = {}
  for (const o of items ?? []) (groups[o.type] ??= []).push(o)
  return groups
}

// A release lists one entry per CHANGED FILE, and an object can own more than
// one: a cube has its .json plus a rules file, a process its .json plus a .ti.
// Those rows carry the same type/name, so a summary that simply maps the list
// reads as duplicates ("SYS Settings (cube), SYS Settings (cube)") and disagrees
// with the Review plan, which counts objects. Collapse to one row per object and
// keep its files, so a count means what a reader expects it to mean.
function uniqueIncluded(included) {
  const byObject = new Map()
  for (const o of included ?? []) {
    const key = `${o.type}|${o.name}|${o.parent ?? ''}`
    const seen = byObject.get(key)
    if (!seen) byObject.set(key, { ...o, files: o.file ? [o.file] : [] })
    else if (o.file && !seen.files.includes(o.file)) seen.files.push(o.file)
  }
  return [...byObject.values()]
}

function parseOps(ops) {
  return (ops ?? [])
    .map(op => {
      const m = String(op).match(/^(Create|Update|Delete|Skip)\s+([^(']+)\(?['"]?([^'")]*)['"]?\)?$/)
      return m ? { action: m[1], type: m[2], name: m[3] || 'project settings' } : { action: 'Other', type: '', name: String(op) }
    })
    .filter(o => o.action !== 'Skip')
}

const STEP_TITLES = ['Test', 'Close', 'Commit', 'Build release', 'Review', 'Approve', 'Deploy', 'Verify']
// Four decisions, not eight stops. The eight steps remain the detail inside
// them — the nav shows the shape of the journey, and clicking a phase lands on
// the first step that phase still needs.
const PHASES = [
  { label: 'Prepare', steps: [1, 2, 3, 4] },
  { label: 'Review',  steps: [5] },
  { label: 'Approve', steps: [6] },
  { label: 'Deploy',  steps: [7, 8] },
]
const STEPS = {
  1: { explain: 'Add the tests that cover what this change set changed, then run them. Behaviour checks the numbers are right (DEV only). Control checks the model holds together (DEV and PROD). A change is not done until it has the tests that prove it.' },
  2: { explain: 'Close the change set when you have finished building. Closing records the test result and is the gate \u2014 it starts the deploy journey. Blocking failures must be fixed first.' },
  3: { explain: 'This commits the current state of this server to the model\u2019s GitHub repo. Nothing on the target server changes yet \u2014 it is just filed, with a reference.' },
  4: { explain: 'Build a release: a commit made of the target\u2019s last deployed state plus ONLY this change set\u2019s objects. Everything else stays on DEV. This is what the target actually receives.' },
  5: { explain: 'Look at exactly what the release would change on the target \u2014 it should be only this change set\u2019s objects.' },
  6: { explain: 'Approve this exact release commit for the target, and record who approved and when. Approval is bound to the commit \u2014 if the release is rebuilt, you must approve again. Deploy cannot proceed without it.' },
  7: { explain: 'This applies the reviewed release to the target server, then runs safety checks to make sure nothing is broken.' },
  8: { explain: 'The target server saves a copy of itself and we compare it to the last deploy. Same = clean. Different = drift.' },
}

const textBtn = 'px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40'
const primaryBtn = 'px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 transition-colors disabled:opacity-40'
// The way forward for a step, pinned to the bottom of the scrolling body so it
// is visible while you read a long result or plan list.
const stepActionBar = 'sticky bottom-0 -mx-4 -mb-4 px-4 py-2 bg-background border-t border-border flex items-center justify-end gap-2 flex-wrap'
const inputCls = 'bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring'

// What failed, what state the target is in, and the one next thing to do.
function OutcomeCard({ outcome }) {
  if (!outcome || outcome.kind === 'ok') return null
  return (
    <div className={`border rounded-md p-3 space-y-1 ${toneClasses(outcome.tone)}`}>
      <p className="text-xs font-semibold">{outcome.title}</p>
      <p className="text-[11px] leading-relaxed"><span className="font-medium">The target:</span> {outcome.prod}</p>
      {outcome.action && <p className="text-[11px] leading-relaxed"><span className="font-medium">Next:</span> {outcome.action}</p>}
    </div>
  )
}

function TestList({ title, meaning, results }) {
  if (!results?.length) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold">{title} <span className="font-normal text-muted-foreground">— {meaning}</span></p>
      {results.map(a => (
        <div key={a.id} className="flex items-baseline gap-2 text-[11px] px-2 py-1 rounded bg-background border border-border">
          <span className={a.pass ? 'text-emerald-700' : (a.kind === 'control' ? 'text-red-600' : 'text-amber-600')}>{a.pass ? 'passed' : (a.kind === 'control' ? 'failed' : 'changed')}</span>
          <span className={(a.severity ?? 'block') === 'block' ? 'text-muted-foreground/60' : 'text-amber-600/80'}>{a.severity ?? 'block'}</span>
          <span className="text-muted-foreground flex-1">{a.description}</span>
          <span className="text-muted-foreground/70">{a.pass ? `expected ${a.expected} · actual ${a.actual}` : `was ${a.expected}, now ${a.actual}`}</span>
        </div>
      ))}
    </div>
  )
}

export default function DeployWizard({ server, onClose, onOpenTests, initialSession = null, release: releaseMode = false, catchUp: catchUpMode = false, catchUpTarget = null }) {
  const initialCatchUp = initialSession?.kind === 'catch-up'
  const isCatchUp = catchUpMode || initialCatchUp
  const catchTargetFromName = initialCatchUp ? (/^Catch-up: (.+) level with /i.exec(initialSession?.name ?? '')?.[1] ?? null) : null
  const [step,      setStep]      = useState(releaseMode || isCatchUp ? 4 : 1)
  const [message,   setMessage]   = useState(`Deploy from ${server}`)
  const [servers,   setServers]   = useState([])
  const [target,    setTarget]    = useState(catchUpTarget ?? catchTargetFromName ?? '')
  const [sessionId, setSessionId] = useState(null)
  const [catchSession, setCatchSession] = useState(null)
  const [catchSentence, setCatchSentence] = useState('')
  const [catchBusy, setCatchBusy] = useState(false)
  const [tests,     setTests]     = useState(null)
  const [pushed,    setPushed]    = useState(null)
  const [release,   setRelease]   = useState(null)
  const [addSel,    setAddSel]    = useState({})
  const [delSel,    setDelSel]    = useState({})
  const [prep,      setPrep]      = useState(null)
  const [prepAt,    setPrepAt]    = useState(null)   // when the target was last read
  const [res,       setRes]       = useState(null)
  const [approval,  setApproval]  = useState(null)
  const [approvalNote, setApprovalNote] = useState('')
  const [drift,     setDrift]     = useState(null)
  const [lock,      setLock]      = useState(null)
  const [busy,      setBusy]      = useState('')
  const [error,     setError]     = useState(null)
  const [confirming, setConfirming] = useState(false)
  // The change set's own log, with each entry's before/after state. Review is
  // supposed to be a review — showing the object names alone asks the approver
  // to remember what they changed.
  const [logEntries, setLogEntries] = useState(null)
  const [diffEntry,  setDiffEntry]  = useState(null)
  // target → 'signed-in' | 'needs-login' | 'rejected' | 'paw'. Read up front so
  // the login requirement shows before the Build release click, not as a 401
  // after the commit.
  const [serverAuth, setServerAuth] = useState({})
  const [addedTests, setAddedTests] = useState(0)
  const [setAssertions, setSetAssertions] = useState([])

  const { data: activeSession } = useActiveWorkSession(server)
  const { data: sessions } = useWorkSessions(server)
  const closeSession = useCloseWorkSession()

  const latestClosed = (sessions ?? [])
    .filter(s => s.closed_at && !s.deployed_target && !s.deployed && s.commit_ref)
    .sort((a, b) => (a.closed_at < b.closed_at ? 1 : -1))[0] ?? null
  const deployCtx = isCatchUp ? (catchSession ?? initialSession) : (initialSession ?? (releaseMode ? latestClosed : activeSession ?? latestClosed))

  // Where this change set actually is in the journey. The wizard used to always
  // open on step 1 and make the user click past Test/Close/Commit they had
  // already done elsewhere.
  const resume = (() => {
    if (!deployCtx) return null
    if (!deployCtx.closed_at) return { label: 'open — continue building', step: 1 }
    if (!deployCtx.commit_ref) return { label: 'closed — ready to commit', step: 3 }
    if (deployCtx.deployed_target) return { label: 'shipped', step: 8 }
    return { label: 'committed — build a release', step: 4 }
  })()

  useEffect(() => { if (deployCtx?.id) setSessionId(deployCtx.id) }, [deployCtx?.id])

  // Jump to the first incomplete step, once, when the context is known. A
  // release/catch-up start at Build release. After that the user owns the step.
  const jumped = useRef(false)
  useEffect(() => {
    if (jumped.current || !deployCtx?.id) return
    jumped.current = true
    if (releaseMode || isCatchUp) return
    if (resume?.step && resume.step > 1) setStep(resume.step)
  }, [deployCtx?.id, resume?.step, releaseMode, isCatchUp])

  // Per-server login state, refreshed whenever a sign-in completes.
  useEffect(() => {
    let alive = true
    const load = () => request('/api/auth/servers', { headers: authHeader() })
      .then(r => r.json())
      .then(list => {
        if (!alive) return
        const map = {}
        for (const s of list ?? []) map[s.name] = s.status
        setServerAuth(map)
      })
      .catch(() => {})
    load()
    window.addEventListener('tm1-server-signed-in', load)
    return () => { alive = false; window.removeEventListener('tm1-server-signed-in', load) }
  }, [])

  useEffect(() => {
    const onSignedIn = (e) => {
      const signed = String(e.detail?.server ?? '').toLowerCase()
      const relevant = !signed || signed === String(server ?? '').toLowerCase() || signed === String(target ?? '').toLowerCase()
      if (!relevant) return
      setError(prev => /Sign in to server|rejected the login/i.test(prev ?? '') ? null : prev)
    }
    window.addEventListener('tm1-server-signed-in', onSignedIn)
    return () => window.removeEventListener('tm1-server-signed-in', onSignedIn)
  }, [server, target])

  useEffect(() => {
    if (!sessionId) { setAddedTests(0); setSetAssertions([]); return }
    request(`/api/assertions?server=${encodeURIComponent(server)}`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => {
        const mine = (d.assertions ?? []).filter(a => a.changeSet === sessionId)
        setAddedTests(mine.length)
        setSetAssertions(mine.map(a => ({ id: a.id, description: a.description, kind: a.kind ?? 'behaviour', severity: a.severity ?? 'block' })))
      })
      .catch(() => {})
  }, [sessionId, server, tests])

  useEffect(() => {
    const route = isCatchUp
      ? `/api/deploy/git/catch-up/targets?source=${encodeURIComponent(server)}`
      : '/api/servers'
    request(route, { headers: authHeader() }).then(r => r.json()).then(d => {
      const others = isCatchUp
        ? (d?.targets ?? []).map(t => t.target).filter(Boolean)
        : (d ?? []).map(s => s?.name).filter(n => n && n !== server)
      setServers(others)
      // A deploy target is (almost) always PROD. Defaulting to the first
      // alphabetical server picked 24Retail, which nobody meant to deploy to.
      setTarget(t => t || others.find(n => /prod/i.test(n)) || (others.length === 1 ? others[0] : ''))
    }).catch(() => {})
  }, [server, isCatchUp])

  const run = async (action, body, route) => {
    setBusy(action); setError(null)
    try {
      const r = await request(route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body) })
      const txt = await r.text()
      let d = null
      try { d = txt ? JSON.parse(txt) : null } catch { d = null }
      if (d === null) {
        // A non-JSON body is almost always the SPA/404 page — the backend is
        // out of date or the route is missing. Say that, not "Unexpected token '<'".
        throw new Error(/^\s*</.test(txt)
          ? `${route} returned a web page, not JSON (HTTP ${r.status}) — the backend is probably out of date. Restart the server and try again.`
          : `Request failed (${r.status} ${r.statusText || ''})`.trim())
      }
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
      return d
    } catch (e) { setError(e.message); return null }
    finally { setBusy('') }
  }

  // Closing is one decision with one gate: the server runs the model's assertions
  // and refuses on a blocking failure. The client-side result from step 1 is a
  // preview, so it must not decide this — and a refusal has to be shown, not
  // swallowed (it just looked like nothing happened).
  const closeChangeSet = async () => {
    if (!activeSession) return
    setError(null)
    try {
      await closeSession.mutateAsync({ id: activeSession.id })
      setStep(3)
      setSessionId(activeSession.id)
    } catch (e) {
      setError(e?.message ?? 'Could not close the change set')
    }
  }
  const runTests = async () => {
    setBusy('test'); setError(null)
    try {
      const t = await request(`/api/assertions/run?server=${encodeURIComponent(server)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: '{}' }).then(r => r.json())
      if (t.error) throw new Error(t.error)
      setTests(t)
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }
  const doPush = async () => {
    if (deployCtx?.wont_deploy_at) { setError(`Change set "${deployCtx.name}" is retired as a phantom change set — restore it in Change Sets first.`); return }
    const d = await run('push', { source: server, message, session: sessionId }, '/api/deploy/git/push')
    if (d) { setPushed(d); setStep(4) }
  }
  const doBuildRelease = async () => {
    if (deployCtx?.wont_deploy_at) { setError(`Change set "${deployCtx.name}" is retired as a phantom change set — restore it in Change Sets first.`); return }
    const addObjects = Object.values(addSel).map(o => ({ type: o.type, name: o.name, parent: o.parent ?? null }))
    const d = await run('release', { source: server, target, session: sessionId, addObjects }, '/api/deploy/git/release')
    if (d) { setRelease(d); setAddSel({}); setDelSel({}); setPrep(null); setApproval(null) }
  }
  const doStartCatchUp = async () => {
    setCatchBusy(true); setError(null)
    try {
      const r = await request('/api/deploy/git/catch-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ source: server, target, confirm: catchSentence }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      setCatchSession(d.session)
      setSessionId(d.session.id)
    } catch (e) { setError(e.message) }
    finally { setCatchBusy(false) }
  }
  const doPrepare = async () => {
    setPrepAt(Date.now())
    const d = await run('prepare', { source: server, target, session: sessionId, branch: `release-${target}` }, '/api/deploy/git/prepare')
    if (d) setPrep(d); else setPrep(null)   // a failed plan clears the preview → Approve stays blocked
  }
  const doApprove = async () => {
    const commit = release?.releaseCommit
    if (!commit) return
    const deletes = isCatchUp ? Object.values(delSel) : undefined
    const d = await run('approve', { source: server, target, commit, note: approvalNote, deletes }, '/api/deploy/git/approve')
    if (d) { setApproval(d); setStep(7) }
  }
  // The confirmation lives in the wizard now (target, commit, objects) instead of
  // a native confirm() on the most consequential button in the app.
  const doDeploy = async () => {
    setConfirming(false)
    const d = await run('deploy', { source: server, target, session: sessionId }, '/api/deploy/git/execute')
    if (d) {
      setRes(d)
      if (d.executed) { setDrift(null); setStep(8) }   // Verify runs itself from here
    }
  }
  const doClearLock = async () => {
    if (!window.confirm(`Clear the stale deploy lock on ${target}? A deploy that died left it behind. This records who cleared it and when.`)) return
    const d = await run('clear', { server: target }, '/api/git/lock/clear')
    if (d?.ok) setLock(null)
  }
  const doDrift = async () => {
    const d = await run('drift', { server: target }, '/api/git/drift')
    if (d) setDrift(d)
  }

  // The change set's log carries the before/after text for each object it
  // touched. Load it for Review so an object can be opened rather than described.
  useEffect(() => {
    if (!sessionId) return
    let alive = true
    request(`/api/sessions/${encodeURIComponent(sessionId)}/log`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => { if (alive) setLogEntries(Array.isArray(d) ? d : d.entries ?? []) })
      .catch(() => { if (alive) setLogEntries([]) })
    return () => { alive = false }
  }, [sessionId])

  // Match a pull-plan row to its log entry. The plan names TM1 entities
  // ("Cubes", "Processes"), the log uses the IDE's object types ("cube",
  // "rules", "process"). Name first, type preferred, never guessed from a
  // different object.
  const entryFor = (obj) => {
    const entries = logEntries ?? []
    if (!entries.length) return null
    const name = String(obj?.name ?? '').toLowerCase()
    const same = entries.filter(e => String(e.object_name ?? '').toLowerCase() === name)
    if (!same.length) return null
    const t = String(obj?.type ?? '').toLowerCase()
    const prefer = t.startsWith('cube') ? ['rules', 'cube']
      : t.startsWith('process') ? ['process']
      : t.startsWith('dimension') ? ['dimension', 'attribute']
      : t.startsWith('chore') ? ['chore']
      : t.startsWith('view') ? ['view']
      : t.startsWith('subset') ? ['subset']
      : []
    const withState = same.filter(e => e.before_state != null || e.after_state != null)
    return withState.find(e => prefer.includes(String(e.object_type).toLowerCase())) ?? withState[0] ?? null
  }

  // Review is the plan — fetch it on entry instead of asking for a second click.
  // The handler is kept in a ref updated by an effect (writing a ref during
  // render is what react-hooks/refs forbids), so the trigger below can stay
  // keyed on step + release without re-running on every render.
  const prepareRef = useRef(null)
  useEffect(() => { prepareRef.current = doPrepare })
  const plannedFor = useRef(null)
  useEffect(() => {
    if (step !== 5) return
    const commit = release?.releaseCommit
    if (!commit || plannedFor.current === commit) return
    plannedFor.current = commit
    prepareRef.current()
  }, [step, release?.releaseCommit])

  // Deploy → straight to Verify with the drift check already running: the two
  // used to be separate clicks with a dead end at the end.
  const driftRef = useRef(null)
  useEffect(() => { driftRef.current = doDrift })
  useEffect(() => {
    if (step !== 8 || !res?.executed || drift) return
    driftRef.current()
  }, [step, res?.executed, drift])

  useEffect(() => {
    if (step !== 7 && step !== 8) return setLock(null)
    const t = setInterval(async () => {
      try {
        const r = await request(`/api/git/lock?server=${encodeURIComponent(target)}`, { headers: authHeader() })
        setLock(await r.json())
      } catch { /* banner is best-effort */ }
    }, 3000)
    return () => clearInterval(t)
  }, [step, target])

  const handleClose = () => {
    if (busy === 'deploy' && !window.confirm('A deploy to ' + target + ' is in progress. It will finish on the server — re-open after it completes to see the result. Close anyway?')) return
    onClose()
  }

  const changed = parseOps(prep?.plan?.ops)
  const behaviour = tests?.results?.filter(r => (r.kind ?? 'behaviour') === 'behaviour') ?? []
  const control   = tests?.results?.filter(r => r.kind === 'control') ?? []
  const blockFails = tests?.results?.filter(r => !r.pass && (r.severity ?? 'block') === 'block') ?? []
  // One row per object: the release lists files, which double up per object.
  const ships = uniqueIncluded(release?.included)

  // The plan is a snapshot of the target. Offer a re-read only when it could
  // change: no plan (the read failed), an error, or a snapshot older than 2 min.
  // Staleness is tracked in state — asking the clock during render is impure.
  const [prepStale, setPrepStale] = useState(false)
  useEffect(() => {
    if (step !== 5 || !prepAt) return
    const check = () => setPrepStale(Date.now() - prepAt > 2 * 60 * 1000)
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [step, prepAt])
  const rereadNeeded = !prep || !!prep.error || prepStale

  // A deploy is six steps that fail differently; say which one failed.
  const outcome = classifyDeployOutcome(res)

  // Drift splits by what a deploy could damage: views and subsets are not in
  // TM1's pull, so they are reported and never block.
  const driftBlocking = (drift?.entries ?? []).filter(e => e.blocking !== false)
  const driftReported = (drift?.entries ?? []).filter(e => e.blocking === false)

  // A target that has no live session makes Build release fail with a 401 after
  // the commit. Say so on selection instead. 'paw' servers ride the shared PAW
  // session, so they never need this.
  const targetNeedsLogin = !!target && (serverAuth[target] === 'needs-login' || serverAuth[target] === 'rejected')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-[680px] max-h-[90vh] flex flex-col bg-background border border-border rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Deploy step by step</span>
          <span className="text-xs text-muted-foreground">from {server}</span>
          {deployCtx
            ? <span className="text-[10px] text-muted-foreground/80">· change set <span className="font-mono text-foreground/80">{deployCtx.name}</span>
              {resume && resume.step > 1 ? <><span className="text-muted-foreground/60"> · {resume.label}</span> <button onClick={() => setStep(resume.step)} className="ml-1 underline underline-offset-2 text-foreground/80 hover:text-foreground">resume</button></> : null}</span>
            : <span className="text-[10px] text-amber-600/90">· no change set — start one in the status bar (or on your first save)</span>}
          <div className="flex-1" />
          <button onClick={handleClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>

        <div className="flex items-center gap-1 px-4 py-2.5 border-b border-border bg-muted/20 flex-wrap">
          {PHASES.map((p, i) => {
            const steps = isCatchUp ? p.steps.filter(s => s >= 4) : p.steps
            if (steps.length === 0) return null
            const active = steps.includes(step)
            const done = steps.every(s => s < step)
            const first = steps[0]
            // Prepare lands on the first step that phase still needs, which is
            // what the resume link would have sent you to anyway.
            const go = p.label === 'Prepare' && resume?.step >= first && resume.step <= steps[steps.length - 1]
              ? resume.step
              : first
            return (
              <span key={p.label} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground/40 mx-0.5">→</span>}
                <button
                  onClick={() => setStep(go)}
                  title={steps.length > 1 ? steps.map(s => STEP_TITLES[s - 1]).join(' → ') : STEP_TITLES[first - 1]}
                  className={active ? 'text-xs font-semibold text-foreground underline underline-offset-4' : 'text-xs text-muted-foreground hover:text-foreground'}
                >
                  {done ? '✓' : `${i + 1}`} {p.label}
                  {/* A phase covers several steps, so show which one you are on
                      — otherwise Build release looks like "still in Prepare". */}
                  {active && STEP_TITLES[step - 1] !== p.label && (
                    <span className="font-normal text-muted-foreground"> · {STEP_TITLES[step - 1]}</span>
                  )}
                </button>
              </span>
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && <p className="text-xs text-red-600 border border-red-600/40 rounded px-3 py-2">{error}</p>}
          {deployCtx?.wont_deploy_at && (
            <p className="text-xs border border-border rounded px-3 py-2 bg-muted/30 text-muted-foreground">
              This change set is a <span className="font-semibold text-foreground">retired phantom</span> — empty, ignored by releases, and owning nothing.
              {deployCtx.wont_deploy_reason ? <> Reason: “{deployCtx.wont_deploy_reason}”.</> : null} Unmark it in Change Sets to use it again.
            </p>
          )}
          {lock && (step === 7 || step === 8) && (
            <div className={'text-xs border rounded px-3 py-2 ' + (lock.stale ? 'border-red-600/40 text-red-600' : 'border-amber-600/40 text-amber-600')}>
              {lock.stale
                ? <span className="flex items-center gap-2 flex-wrap">
                    <span>A deploy on {target} by <span className="font-semibold">{lock.by}</span> since {new Date(lock.at).toLocaleTimeString()} didn't finish — the lock is stale.</span>
                    <button onClick={doClearLock} disabled={busy === 'clear'} className="px-2 py-0.5 rounded border border-red-600/40 text-red-600 hover:bg-red-500/10 text-[10px]">Clear lock</button>
                  </span>
                : <span>{target} is being deployed by <span className="font-semibold">{lock.by}</span> since {new Date(lock.at).toLocaleTimeString()} — a deploy in progress is refused until it finishes.</span>}
            </div>
          )}

          {/* Step 1 — Test */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[1].explain}</p>
              <div className="border border-border rounded-md p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <button onClick={runTests} disabled={busy === 'test'} className={primaryBtn}>{tests ? 'Run tests again' : 'Run tests'}</button>
                  {busy === 'test' && <span className="text-xs text-muted-foreground">Running…</span>}
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-border">
                  <span className="text-xs text-muted-foreground">{addedTests} assertion{addedTests !== 1 ? 's' : ''} added in this change set</span>
                  <button onClick={onOpenTests} className={textBtn}>Add tests for this change</button>
                </div>
                {tests && (() => {
                    const setIds = new Set(setAssertions.map(a => a.id))
                    const setRun = (tests.results ?? []).filter(r => setIds.has(r.id))
                    return (
                  <div className="border border-border rounded-md p-3 space-y-3 bg-muted/20">
                    <p className="text-xs">
                      All model tests: <span className={blockFails.length ? 'text-red-600' : 'text-emerald-700'}>{tests.passed} of {tests.total} passed</span>
                      {blockFails.length ? ` — ${blockFails.length} blocking failure${blockFails.length !== 1 ? 's' : ''}.` : '.'}
                    </p>
                    {setRun.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">This change set's tests</p>
                        {setRun.map(r => (
                          <div key={r.id} className="flex items-baseline gap-2 text-[11px] px-2 py-1 rounded bg-background border border-border">
                            <span className={r.pass ? 'text-emerald-700' : (r.kind === 'control' ? 'text-red-600' : 'text-amber-600')}>{r.pass ? 'passed' : (r.kind === 'control' ? 'failed' : 'changed')}</span>
                            <span className={(r.severity ?? 'block') === 'block' ? 'text-muted-foreground/60' : 'text-amber-600/80'}>{r.severity ?? 'block'}</span>
                            <span className="text-muted-foreground flex-1">{r.description}</span>
                            <span className="text-muted-foreground/70">{r.pass ? `expected ${r.expected} · actual ${Math.round(r.actual * 100) / 100}` : `was ${r.expected}, now ${Math.round(r.actual * 100) / 100}`}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <TestList title="Behaviour" meaning="the numbers are right (DEV only)" results={behaviour} />
                    <TestList title="Control" meaning="the model holds together (DEV and PROD)" results={control} />
                  </div>
                    )
                  })()}
              </div>
              {/* The result list can be 60 rows long; the way forward stays on
                  screen instead of waiting at the bottom of it. */}
              <div className={stepActionBar}>
                <button onClick={() => setStep(2)} className={primaryBtn}>Continue to Close</button>
              </div>
            </div>
          )}

          {/* Step 2 — Close (the gate) */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[2].explain}</p>
              <div className="border border-border rounded-md p-3 space-y-3">
                {activeSession ? <p className="text-xs">Change set to close: <span className="font-semibold">{activeSession.name}</span></p> : deployCtx ? <p className="text-xs">Change set <span className="font-semibold">{deployCtx.name}</span> is already closed — continue to Commit.</p> : <p className="text-xs text-muted-foreground">No change set — start one in the status bar first.</p>}
                <p className="text-xs text-muted-foreground">Closing runs the model's tests on the server. A blocking failure refuses it — the preview below is from step 1 and is not what decides.</p>
                {tests && blockFails.length > 0 && (
                  <div className="border border-red-600/40 rounded-md p-2 space-y-1">
                    <p className="text-xs text-red-600">{blockFails.length} blocking test{blockFails.length !== 1 ? 's are' : ' is'} failing in the last preview — closing will be refused until they are fixed on this server.</p>
                    {blockFails.map(f => <p key={f.id} className="text-[11px] text-muted-foreground">· {f.description}</p>)}
                  </div>
                )}
                {tests && blockFails.length === 0 && <p className="text-xs text-emerald-700">No blocking failures.</p>}
                {tests && (
                  <div className="border border-border rounded-md p-2 text-[11px] space-y-1 bg-muted/20">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">On close, this change set records</p>
                    <p>· tests {tests.passed}/{tests.total} passing</p>
                    <p>· {blockFails.length} blocking failure(s)</p>
                    <p>· {(tests.results ?? []).filter(r => !r.pass && r.severity === 'warn').length} warning(s)</p>
                    <p>· closed by {username()}</p>
                  </div>
                )}
                {activeSession && addedTests === 0 && (
                  <p className="text-xs text-amber-600">No assertions were added in this change set. If this change has logic worth testing, add coverage first (step 1, Test). You can still close.</p>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={closeChangeSet} disabled={closeSession.isPending || !activeSession} className={primaryBtn}>
                    {closeSession.isPending ? 'Running the model tests on the server…' : 'Close change set'}
                  </button>
                  {!activeSession && <button onClick={() => setStep(3)} className={textBtn}>Continue</button>}
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — Commit */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[3].explain}</p>
              <div className="border border-border rounded-md p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-16">Note</label>
                  <input value={message} onChange={e => setMessage(e.target.value)} className={inputCls + ' flex-1'} />
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={doPush} disabled={busy === 'push'} className={primaryBtn}>Commit {server} to the GitHub repo</button>
                  {busy === 'push' && <span className="text-xs text-muted-foreground">Committing…</span>}
                </div>
                <p className="text-[10px] text-muted-foreground/70 border-t border-border pt-2">
                  This sends <span className="text-foreground">everything on {server}</span> to GitHub (that is the model's history). The release (next step) is what carries only this change set's objects to the target.
                </p>
                {pushed && (
                  <div className="border border-border rounded-md p-3 bg-muted/20">
                    <p className="text-xs">Committed. {server} is filed in the GitHub repo as <span className="font-mono">{pushed.commit}</span>.</p>
                    <button onClick={() => setStep(4)} className={primaryBtn + ' mt-2'}>Continue to Build release</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4 — Build release */}
          {step === 4 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[4].explain}</p>
              {isCatchUp && !deployCtx && (
                <div className="border border-amber-600/40 rounded-md p-3 space-y-2 bg-amber-500/5">
                  <p className="text-xs">Catch-up release — ships everything that differs between <span className="font-semibold">{target}</span> and <span className="font-semibold">{server}</span>, outside any single change set.</p>
                  <p className="text-[11px] text-amber-600">Once, deliberately, as an admin. Type the sentence to confirm.</p>
                  <p className="text-[11px] font-mono text-foreground/80">I understand this brings {target} level with {server}</p>
                  <input value={catchSentence} onChange={e => setCatchSentence(e.target.value)} className={inputCls + ' w-full'} placeholder={`I understand this brings ${target} level with ${server}`} />
                  <button onClick={doStartCatchUp} disabled={catchBusy || !target || !catchSentence.trim()} className={primaryBtn}>Start catch-up</button>
                </div>
              )}
              <div className="border border-border rounded-md p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-16">Target</label>
                  <select value={target} onChange={e => {
                    setTarget(e.target.value)
                    setRelease(null); setPrep(null); setApproval(null); setConfirming(false)
                  }} disabled={isCatchUp && !!target} className={inputCls + (isCatchUp ? ' opacity-70' : '')}>
                    {!target && <option value="">Select target…</option>}
                    {servers.map(s => <option key={s} value={s} className="bg-background">{s}</option>)}
                    {servers.length === 0 && <option value="">(no other servers)</option>}
                  </select>
                  <button onClick={doBuildRelease} disabled={busy === 'release' || !target || targetNeedsLogin || (isCatchUp && !deployCtx)} className={primaryBtn}>Build release</button>
                  {busy === 'release' && <span className="text-xs text-muted-foreground">Building…</span>}
                </div>
                {targetNeedsLogin && (
                  <div className="flex items-center gap-2 text-[11px] text-amber-600">
                    <span>{target} needs its own login before a release can be built.</span>
                    <button onClick={() => window.dispatchEvent(new CustomEvent('tm1-server-login', { detail: { server: target, force: true } }))} className={textBtn}>Sign in to {target}</button>
                  </div>
                )}
                {release && (
                  <div className="space-y-2">
                    {release.catchUp && (
                      <div className="border border-amber-600/40 rounded-md p-2 bg-amber-500/5">
                        <p className="text-xs font-semibold text-amber-600">Catch-up release</p>
                        <p className="text-[11px] text-muted-foreground">Ships everything that differs between {target} and {server}, outside any single change set.</p>
                      </div>
                    )}
                    <p className="text-xs">Release <span className="font-mono">{release.releaseCommit}</span> built on {target}'s recorded commit <span className="font-mono">{release.base}</span>.</p>
                    <div className="border border-emerald-600/30 rounded-md p-2 space-y-1 bg-emerald-600/5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Included — ships to {target} ({ships.length})</p>
                      {release.catchUp
                        ? Object.entries(groupByType(ships)).map(([type, items]) => (
                          <div key={type} className="space-y-0.5">
                            <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide pt-1">{type} ({items.length})</p>
                            {items.map((o, i) => (
                              <p key={i} className="text-[11px]"><span className="text-emerald-700">{o.action === 'D' ? 'delete' : 'update'}</span> · <span className="font-mono">{type === 'other' ? o.name : `${o.type} ${o.name}`}</span>{o.files.length ? <span className="text-muted-foreground/60"> ({o.files.map(humanizeFile).join(', ')})</span> : null}</p>
                            ))}
                          </div>
                        ))
                        : ships.map((o, i) => (
                          <p key={i} className="text-[11px]"><span className="text-emerald-700">{o.action === 'D' ? 'delete' : 'update'}</span> · <span className="font-mono">{o.type} {o.name}</span>{o.files.length ? <span className="text-muted-foreground/60"> ({o.files.map(humanizeFile).join(', ')})</span> : null}</p>
                        ))}
                      {ships.length === 0 && <p className="text-[11px] text-muted-foreground">Nothing from this change set changed a file.</p>}
                    </div>
                    {release.catchUp && (
                      <div className="border border-border rounded-md p-2 space-y-1 bg-muted/20">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Change sets this catch-up covers ({(release.coveredSets ?? []).length})</p>
                        {(release.coveredSets ?? []).map(s => (
                          <p key={s.id} className="text-[11px]"><span className="font-mono">{s.name}</span> <span className="text-muted-foreground/60">— {s.entries} change{s.entries !== 1 ? 's' : ''}{s.user ? `, ${s.user}` : ''}</span></p>
                        ))}
                        {(release.coveredSets ?? []).length === 0 && <p className="text-[11px] text-muted-foreground">None of DEV's unreleased closed change sets touch the included objects.</p>}
                        {(release.openSets ?? []).length > 0 && (
                          <>
                            <p className="text-[10px] text-amber-600 uppercase tracking-wide pt-1">Open — partly shipped, stays in play</p>
                            {(release.openSets ?? []).map(s => (
                              <p key={s.id} className="text-[11px] text-amber-600/90"><span className="font-mono">{s.name}</span> <span className="text-muted-foreground/60">— {s.entries} change{s.entries !== 1 ? 's' : ''}{s.user ? `, ${s.user}` : ''}</span></p>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                    {release.catchUp && (
                      <div className="border border-border rounded-md p-2 space-y-1 bg-muted/20">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">On {target} but not in the repo ({(release.targetOnly ?? []).length}) — tick any to delete after the pull</p>
                        {(release.targetOnly ?? []).map((o, i) => {
                          const key = `${o.type}|${o.name}|${o.parent ?? ''}|${o.hierarchy ?? ''}`
                          return (
                            <label key={i} className="flex items-baseline gap-2 text-[11px] font-mono text-muted-foreground">
                              <input type="checkbox" checked={!!delSel[key]} onChange={e => setDelSel(prev => e.target.checked ? { ...prev, [key]: o } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)))} className="mt-0.5 accent-red-600" />
                              <span>{o.type} {o.name}{o.parent ? ` (${o.parent}${o.hierarchy && o.hierarchy !== o.parent ? ` › ${o.hierarchy}` : ''})` : ''}</span>
                            </label>
                          )
                        })}
                        {(release.targetOnly ?? []).length === 0 && <p className="text-[11px] text-muted-foreground">Nothing target-only.</p>}
                        {Object.keys(delSel).length > 0 && <p className="text-[10px] text-red-600 pt-1">{Object.keys(delSel).length} selected for deletion after the pull. Approval records this list.</p>}
                      </div>
                    )}
                    {(release.addedAsDependency?.length > 0) && (
                      <div className="border border-sky-600/30 rounded-md p-2 space-y-1 bg-sky-600/5">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Added because something in the release needs it ({release.addedAsDependency.length})</p>
                        {release.addedAsDependency.map((o, i) => (
                          <p key={i} className="text-[11px]"><span className="font-mono">{o.type} {o.name}</span> <span className="text-muted-foreground/60">({humanizeFile(o.file)})</span>{o.neededBy ? <span className="text-muted-foreground/60"> — needed by {humanizeFile(o.neededBy)}</span> : null}</p>
                        ))}
                      </div>
                    )}
                    {(release.addedByUser?.length > 0) && (
                      <div className="border border-emerald-600/30 rounded-md p-2 space-y-1 bg-emerald-600/5">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Added to this release by you ({release.addedByUser.length})</p>
                        {release.addedByUser.map((o, i) => (
                          <p key={i} className="text-[11px]"><span className="font-mono">{o.type} {o.name}</span> <span className="text-muted-foreground/60">({humanizeFile(o.file)})</span>{o.by ? <span className="text-muted-foreground/60"> — by {o.by}</span> : null}</p>
                        ))}
                      </div>
                    )}
                    {release.runs > 0 && (release.excluded ?? []).some(o => !o.owner) && (
                      <p className="text-[11px] text-amber-600">This change set ran {release.runs} process{release.runs !== 1 ? 'es' : ''}; unowned changes below may be their output.</p>
                    )}
                    <div className="border border-border rounded-md p-2 space-y-1 bg-muted/20">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Left on DEV — not shipped ({release.excluded?.length ?? 0})</p>
                      {(release.excluded ?? []).map((o, i) => {
                        const key = `${o.type}|${o.name}|${o.parent ?? ''}`
                        return (
                          <div key={i} className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
                            {!o.owner && (
                              <input
                                type="checkbox"
                                checked={!!addSel[key]}
                                onChange={e => setAddSel(prev => e.target.checked ? { ...prev, [key]: o } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)))}
                                title="Add this unowned item to the release"
                                className="mt-0.5 accent-emerald-600"
                              />
                            )}
                            <span className="flex-1"><span className="font-mono">{o.type} {o.name}</span>{o.owner ? ` — in "${o.owner.sessionName}"${o.owner.user ? ` (${o.owner.user})` : ''}` : null}</span>
                            {!o.owner && <span className="text-[10px] text-muted-foreground/60">Add to this release</span>}
                          </div>
                        )
                      })}
                      {(release.excluded ?? []).length === 0 && <p className="text-[11px] text-muted-foreground">Nothing else changed between the base and DEV's commit.</p>}
                      {Object.keys(addSel).length > 0 && <p className="text-[10px] text-emerald-600 pt-1">Build release again to include the ticked items.</p>}
                    </div>
                    {(release.noFile?.length > 0) && (
                      <p className="text-[11px] text-amber-600">In this change set but no file changed (e.g. only a value): {release.noFile.map(o => `${o.type} ${o.name}`).join(', ')}</p>
                    )}
                    <button onClick={() => setStep(5)} className={primaryBtn}>Continue to Review</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 5 — Review (the release's plan) */}
          {step === 5 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[5].explain}</p>
              <div className="border border-border rounded-md p-3 space-y-3">
                {!release && <p className="text-xs text-muted-foreground">Build the release first (step 4).</p>}
                {release && !prep && busy !== 'prepare' && <span className="text-xs text-muted-foreground">Reading the target…</span>}
                {busy === 'prepare' && <span className="text-xs text-muted-foreground">Reading the target…</span>}
                {/* Only offered when it can change something: the read failed, or
                    the snapshot is old enough that the target may have moved. */}
                {release && rereadNeeded && (
                  <button
                    onClick={doPrepare}
                    disabled={busy === 'prepare' || !target}
                    className={textBtn}
                    title="Reads the target's current state again and recomputes what this release would change. Needed only when the read failed or the target has changed since."
                  >
                    Re-read the target
                  </button>
                )}
                {prep && (
                  <div className="border border-border rounded-md p-3 space-y-2">
                    {prep.error && <p className="text-xs text-red-600">{prep.error}</p>}
                    <p className="text-xs">On <span className="font-semibold">{target}</span>: <span className="font-semibold">{changed.length}</span> object{changed.length !== 1 ? 's' : ''} will change{prep.plan ? `, moving to ${prep.plan.targetCommit}.` : '.'}</p>
                    <p className="text-[11px] text-muted-foreground">
                      The target is currently at {prep.deployedCommit} (what it last received)
                      {prepAt ? ` · read ${new Date(prepAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}.
                    </p>
                    {changed.length > 0 && (
                      <div className="space-y-1 pt-1">
                        {changed.map((o, i) => {
                          const entry = entryFor(o)
                          return (
                            <div key={i} className="flex items-baseline gap-2 text-xs px-2 py-1 rounded bg-muted/30">
                              <span className="text-muted-foreground">{o.action.toLowerCase()}</span>
                              <span className="text-muted-foreground/60">{o.type}</span>
                              <span className="font-mono">{o.name}</span>
                              {entry
                                ? <button onClick={() => setDiffEntry(entry)} className="ml-auto text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground shrink-0">View change</button>
                                : <span className="ml-auto text-[10px] text-muted-foreground/50 shrink-0" title="No recorded before/after for this object in this change set">no diff recorded</span>}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {prep.plan && (prep.planByType?.Skip ?? 0) > 0 && <p className="text-[11px] text-muted-foreground">{prep.planByType.Skip} objects are unchanged — nothing to do for them.</p>}
                    {changed.length === 0 && prep.plan && <p className="text-xs">Nothing would change — the target already matches the release.</p>}
                    {prep.error && <p className="text-xs text-red-600">The pull plan failed — cannot continue to Approve. {prep.error}</p>}
                  </div>
                )}
              </div>
              {/* Same reason as Test: the plan can list a hundred objects. */}
              {prep && (
                <div className={stepActionBar}>
                  <button onClick={() => setStep(4)} className={textBtn}>Back to Build release</button>
                  <button onClick={() => setStep(6)} disabled={!prep.ready || !!prep.error} className={primaryBtn} title={prep.error ? 'The pull plan failed — fix it, then re-show what will change' : ''}>Continue to Approve</button>
                </div>
              )}
            </div>
          )}

          {/* Step 6 — Approve */}
          {step === 6 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[6].explain}</p>
              <div className="border border-border rounded-md p-3 space-y-3">
                {!release?.releaseCommit ? (
                  <p className="text-xs text-muted-foreground">Build the release first (step 4) — we approve the release commit.</p>
                ) : (
                  <>
                    <p className="text-xs">Approve release <span className="font-mono">{release.releaseCommit}</span> for <span className="font-semibold">{target}</span>.</p>
                    <div className="border border-border rounded-md p-3 text-xs space-y-1 bg-muted/20">
                      <p><span className="text-muted-foreground">Change set:</span> {deployCtx?.name ?? (sessionId ? `(closed ${String(sessionId).slice(0, 8)})` : '—')}</p>
                      <p><span className="text-muted-foreground">Ships:</span> {ships.map(o => `${o.name} (${o.type})`).join(', ') || 'nothing'}</p>
                      {tests && <p><span className="text-muted-foreground">Tests:</span> {tests.passed}/{tests.total} passing{blockFails.length ? `, ${blockFails.length} blocking` : ''}</p>}
                      <p><span className="text-muted-foreground">Release commit:</span> <span className="font-mono">{release.releaseCommit}</span></p>
                      <p className="text-[10px] text-muted-foreground/70 pt-2 border-t border-border mt-1">Approving records who approved, when, and this exact commit. A failed rule/process dependency blocks approval. On a solo model this is self-approval — it is still recorded.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground w-16">Note</label>
                      <input value={approvalNote} onChange={e => setApprovalNote(e.target.value)} placeholder="optional reason / reference" className={inputCls + ' flex-1'} />
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={doApprove} disabled={busy === 'approve'} className={primaryBtn}>Approve this release</button>
                      {busy === 'approve' && <span className="text-xs text-muted-foreground">Recording…</span>}
                    </div>
                    {approval && (
                      <div className="border border-border rounded-md p-3 bg-muted/20">
                        <p className="text-xs">Approved by <span className="font-semibold">{approval.approver}</span> at {new Date(approval.approved_at).toLocaleTimeString()}.</p>
                        <button onClick={() => setStep(7)} className={primaryBtn + ' mt-2'}>Continue to Deploy</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Step 7 — Deploy */}
          {step === 7 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[7].explain}</p>
              <div className="border border-border rounded-md p-3 space-y-3">
                {!release?.releaseCommit && <p className="text-xs text-muted-foreground">Build and approve a release first.</p>}
                {release?.releaseCommit && !approval && <p className="text-xs text-amber-600">Not approved yet — go back to Approve (step 6) to record the decision.</p>}
                {confirming ? (
                  <div className="border border-red-600/40 rounded-md p-3 space-y-2 bg-red-500/5">
                    <p className="text-xs font-semibold">Deploy to {target}?</p>
                    <p className="text-[11px] text-muted-foreground">
                      Applies {ships.length} object{ships.length !== 1 ? 's' : ''}
                      {ships.length ? ` (${ships.map(o => o.name).join(', ')})` : ''} and moves {target} to{' '}
                      <span className="font-mono">{release?.releaseCommit}</span>, then runs the safety checks.
                      <span className="text-foreground"> There is no rollback.</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <button onClick={doDeploy} disabled={busy === 'deploy'} className={primaryBtn}>
                        {busy === 'deploy' ? 'Applying…' : `Yes, deploy to ${target}`}
                      </button>
                      <button onClick={() => setConfirming(false)} disabled={busy === 'deploy'} className={textBtn}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setConfirming(true)} disabled={busy === 'deploy' || !release?.releaseCommit || !approval} className={primaryBtn}>Deploy to {target}</button>
                    {busy === 'deploy' && <span className="text-xs text-muted-foreground">Applying…</span>}
                  </div>
                )}
                {/* The confirmation panel says the same thing in more detail. */}
                {ships.length > 0 && !confirming && <p className="text-[11px] text-muted-foreground">This applies {ships.length} change{ships.length !== 1 ? 's' : ''} ({ships.map(o => o.name).join(', ')}) to {target}.</p>}
                <OutcomeCard outcome={outcome} />
                {res && (
                  <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
                    {res.error && <p className="text-xs text-red-600">{res.error}</p>}
                    {res.refused && !res.error && <p className="text-xs text-red-600">Refused.</p>}
                    {res.executed && <p className="text-xs">Applied. {target} is now at <span className="font-mono">{res.targetCommit}</span>.</p>}
                    {res.subsetsViews?.errors?.length > 0 && (
                      <p className="text-xs text-red-600">Release apply failures: {res.subsetsViews.errors.map(e => `${e.type} ${e.name} — ${e.error}`).join('; ')}</p>
                    )}
                    {res.incomplete?.length > 0 && (
                      <p className="text-xs text-red-600">Not verified on {target}: {res.incomplete.join(', ')}</p>
                    )}
                    {res.incompleteCheckError && (
                      <p className="text-xs text-red-600">Post-deploy verification error: {res.incompleteCheckError}</p>
                    )}
                    {res.verification?.results?.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-xs">Safety checks: <span className={res.controlOk ? 'text-emerald-700' : 'text-red-600'}>{res.verification.passed} of {res.verification.total} passed</span></p>
                        {res.verification.results.map(a => (
                          <div key={a.id} className="flex items-baseline gap-2 text-[11px] px-2 py-1 rounded bg-background border border-border">
                            <span className={a.pass ? 'text-emerald-700' : 'text-red-600'}>{a.pass ? 'passed' : 'failed'}</span>
                            <span className="text-muted-foreground flex-1">{a.description}</span>
                            <span className="text-muted-foreground/70">{a.pass ? `expected ${a.expected} · actual ${a.actual}` : `expected ${a.expected}, got ${a.actual}`}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {res.reconcile && (
                      <div className="space-y-1 text-[11px] text-muted-foreground pt-1">
                        {res.reconcileWarning && <p className="text-amber-600">{res.reconcileWarning}</p>}
                        {res.reconcile.deletes?.deleted?.length > 0 && <p>Deleted on {target}: {res.reconcile.deletes.deleted.map(d => `${d.type} ${d.name}`).join(', ')} (TM1 Git does not propagate deletes).</p>}
                        {(res.reconcile.deletes?.flagged?.length > 0) && <p className="text-amber-600">Delete skipped: {res.reconcile.deletes.flagged.map(d => `${d.type} ${d.name} — ${d.error}`).join('; ')}</p>}
                        {res.reconcile.error && <p className="text-red-600">{res.reconcile.error}</p>}
                      </div>
                    )}
                    {res.executed && <button onClick={() => setStep(8)} className={primaryBtn + ' mt-1'}>Continue to Verify</button>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 8 — Verify */}
          {step === 8 && (
            <div className="space-y-3">
              <OutcomeCard outcome={outcome} />
              {res?.executed ? (
                <div className={`border rounded-md p-3 space-y-1.5 ${res.controlOk === false ? 'border-red-600/40 bg-red-500/5' : 'border-emerald-600/30 bg-emerald-600/5'}`}>
                  <p className="text-sm font-semibold">Deployed to {target}</p>
                  <p className="text-xs">{target} is now at <span className="font-mono">{res.targetCommit}</span>.</p>
                  {res.verification && (
                    <p className="text-xs">Safety checks: <span className={res.controlOk ? 'text-emerald-700' : 'text-red-600'}>{res.verification.passed} of {res.verification.total} passed</span></p>
                  )}
                  <p className="text-xs">
                    {drift == null
                      ? 'Checking drift…'
                      : driftBlocking.length > 0
                        ? <span className="text-amber-600">{driftBlocking.length} difference{driftBlocking.length !== 1 ? 's' : ''} — deploys to {target} stay paused.</span>
                        : <span className="text-emerald-700">No drift — {target} matches exactly what it was given.</span>}
                    {driftReported.length > 0 && (
                      <span className="text-muted-foreground"> · {driftReported.length} view/subset change{driftReported.length !== 1 ? 's' : ''} on {target} — reported, not blocking.</span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={handleClose} className={primaryBtn}>Done</button>
                    <button onClick={doDrift} disabled={busy === 'drift'} className={textBtn}>Check again</button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[8].explain}</p>
              )}
              <div className="border border-border rounded-md p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-16">Target</label>
                  <select value={target} onChange={e => { setTarget(e.target.value); setDrift(null) }} className={inputCls}>
                    {servers.map(s => <option key={s} value={s} className="bg-background">{s}</option>)}
                  </select>
                  <button onClick={doDrift} disabled={busy === 'drift'} className={primaryBtn}>Check for drift</button>
                </div>
                {drift && (
                  <div className="border border-border rounded-md p-3 space-y-2">
                    {drift.error && <p className="text-xs text-red-600">{drift.error}</p>}
                    {driftBlocking.length === 0 && <p className="text-xs"><span className="font-semibold">No drift.</span> {target} matches exactly what it was given.</p>}
                    {driftBlocking.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-amber-600">{target} has {driftBlocking.length} thing{driftBlocking.length !== 1 ? 's' : ''} that changed:</p>
                        {driftBlocking.map((e, i) => (
                          <div key={i} className="flex items-baseline gap-2 text-[11px] px-2 py-1 rounded bg-muted/30">
                            <span className="text-muted-foreground">{e.status}</span>
                            <span className="text-foreground">{humanizeFile(e.file)}</span>
                          </div>
                        ))}
                        <p className="text-[11px] text-muted-foreground pt-1">Deploys to {target} stay paused. Re-apply the change on DEV in a change set, then release it.</p>
                      </div>
                    )}
                    {driftReported.length > 0 && (
                      <div className="space-y-1 pt-2 border-t border-border/40">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Changed on {target} — not blocking ({driftReported.length})</p>
                        {driftReported.map((e, i) => (
                          <p key={i} className="text-[11px] text-muted-foreground">
                            <span className="font-mono">{e.status}</span> {humanizeFile(e.file)}
                            <span className="text-muted-foreground/60"> · {e.kind === 'view' ? 'view' : 'subset'} — a deploy does not touch it</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Recovery — only on Deploy and Verify */}
          {(step === 7 || step === 8) && (
            <div className="border border-border rounded-md">
              <div className="px-3 py-2 border-b border-border bg-muted/20 text-xs font-semibold">If something goes wrong</div>
              <div className="px-3 py-2 space-y-1.5 text-[11px] text-muted-foreground leading-relaxed">
                <p>· <span className="text-foreground">Each failure leaves a different state.</span> If this deploy fails, a card above says which step failed, what the target now holds, and the one next action. Read that before doing anything else.</p>
                <p>· <span className="text-foreground">Nothing rolls back automatically.</span> A deploy that reached the target is corrected on {server} and shipped again. A pull that failed part-way is different: the target then has to be returned to its last received commit first.</p>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Rendered above the wizard (its own z-index), reusing the IDE's diff. */}
      {diffEntry && <DiffViewerModal entry={diffEntry} onClose={() => setDiffEntry(null)} />}
    </div>
  )
}
