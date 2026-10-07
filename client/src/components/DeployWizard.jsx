import { useState, useEffect } from 'react'
import { useActiveWorkSession, useCloseWorkSession, useWorkSessions } from '@/hooks/useApi'
import { humanizeFile } from '@/lib/tm1-terms'

// Deploy wizard — the deploy journey in one guided screen:
//   Test → Close → Commit → Review → Approve → Deploy → Verify
// Change sets are started in the IDE (the status bar / first save), not here.
// One sentence per step, one main button, a recovery box on Deploy/Verify. Has
// no outside-click close (only the Close button), and Deploy does not auto-jump
// to Verify — the result stays until you click Continue.
const authHeader = () => ({ 'x-ide-token': localStorage.getItem('tm1-token') ?? '' })
const username = () => localStorage.getItem('tm1-username') ?? 'unknown'

function parseOps(ops) {
  return (ops ?? [])
    .map(op => {
      const m = String(op).match(/^(Create|Update|Delete|Skip)\s+([^(']+)\(?['"]?([^'")]*)['"]?\)?$/)
      return m ? { action: m[1], type: m[2], name: m[3] || 'project settings' } : { action: 'Other', type: '', name: String(op) }
    })
    .filter(o => o.action !== 'Skip')
}

const STEP_TITLES = ['Test', 'Close', 'Commit', 'Review', 'Approve', 'Deploy', 'Verify']
const STEPS = {
  1: { explain: 'Add the tests that cover what this change set changed, then run them. Behaviour checks the numbers are right (DEV only). Control checks the model holds together (DEV and PROD). A change is not done until it has the tests that prove it.' },
  2: { explain: 'Close the change set when you have finished building. Closing records the test result and is the gate \u2014 it starts the deploy journey. Blocking failures must be fixed first.' },
  3: { explain: 'This commits the current state of this server to the model\u2019s GitHub repo. Nothing on the target server changes yet \u2014 it is just filed, with a reference.' },
  4: { explain: 'Before we touch the target server, look at exactly what would change on it. Confirm it is only what you intended.' },
  5: { explain: 'Approve this exact commit for the target, and record who approved and when. Approval is bound to the commit \u2014 if the commit changes, you must approve again. Deploy cannot proceed without it.' },
  6: { explain: 'This applies the reviewed change to the target server, then runs safety checks to make sure nothing is broken.' },
  7: { explain: 'The target server saves a copy of itself and we compare it to the last deploy. Same = clean. Different = drift.' },
}

const textBtn = 'px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40'
const primaryBtn = 'px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 transition-colors disabled:opacity-40'
const inputCls = 'bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring'

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

export default function DeployWizard({ server, onClose, onOpenTests }) {
  const [step,      setStep]      = useState(1)
  const [message,   setMessage]   = useState(`Deploy from ${server}`)
  const [servers,   setServers]   = useState([])
  const [target,    setTarget]    = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [tests,     setTests]     = useState(null)
  const [pushed,    setPushed]    = useState(null)
  const [prep,      setPrep]      = useState(null)
  const [res,       setRes]       = useState(null)
  const [diffs,     setDiffs]     = useState(null)
  const [approval,  setApproval]  = useState(null)
  const [approvalNote, setApprovalNote] = useState('')
  const [drift,     setDrift]     = useState(null)
  const [lock,      setLock]      = useState(null)
  const [busy,      setBusy]      = useState('')
  const [error,     setError]     = useState(null)
  const [addedTests, setAddedTests] = useState(0)
  const [setAssertions, setSetAssertions] = useState([])

  const { data: activeSession, refetch: refetchActive } = useActiveWorkSession(server)
  const { data: sessions } = useWorkSessions(server)
  const closeSession = useCloseWorkSession()

  // Deploy opens on the change set in flight: the OPEN one, or — only when one is
  // genuinely mid-deploy — a CLOSED set that has been COMMITTED but not yet
  // shipped (a closed-but-never-committed set isn't in progress; it just wasn't
  // started). No guessing from arbitrary old sets.
  const latestClosed = (sessions ?? [])
    .filter(s => s.closed_at && !s.deployed_target && !s.deployed && s.commit_ref)
    .sort((a, b) => (a.closed_at < b.closed_at ? 1 : -1))[0] ?? null
  const deployCtx = activeSession ?? latestClosed

  useEffect(() => { if (deployCtx?.id) setSessionId(deployCtx.id) }, [deployCtx?.id])

  // Always open at step 1 (Test) — predictable. The tracker lets you jump to any
  // step, and the header shows the change set in play, but the wizard does not
  // hijack the starting step based on a previous set's state.

  // How many assertions this change set has added, and which ones (provenance).
  useEffect(() => {
    if (!sessionId) { setAddedTests(0); setSetAssertions([]); return }
    fetch(`/api/assertions?server=${encodeURIComponent(server)}`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => {
        const mine = (d.assertions ?? []).filter(a => a.changeSet === sessionId)
        setAddedTests(mine.length)
        setSetAssertions(mine.map(a => ({ id: a.id, description: a.description, kind: a.kind ?? 'behaviour', severity: a.severity ?? 'block' })))
      })
      .catch(() => {})
  }, [sessionId, server, tests])

  useEffect(() => {
    fetch('/api/servers', { headers: authHeader() }).then(r => r.json()).then(d => {
      const others = (d ?? []).map(s => s?.name).filter(n => n && n !== server)
      setServers(others)
      setTarget(t => t || (others[0] ?? ''))
    }).catch(() => {})
  }, [server])

  const run = async (action, body, route) => {
    setBusy(action); setError(null)
    try {
      const r = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      return d
    } catch (e) { setError(e.message); return null }
    finally { setBusy('') }
  }

  const closeChangeSet = async () => {
    if (!activeSession) return
    const d = await closeSession.mutateAsync({ id: activeSession.id }).catch(() => null)
    if (d) { setStep(3); setSessionId(activeSession.id) }
  }
  const runTests = async () => {
    setBusy('test'); setError(null)
    try {
      const t = await fetch(`/api/assertions/run?server=${encodeURIComponent(server)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: '{}' }).then(r => r.json())
      if (t.error) throw new Error(t.error)
      setTests(t)
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }
  const doPush = async () => {
    const d = await run('push', { source: server, message, session: sessionId }, '/api/deploy/git/push')
    if (d) { setPushed(d); setStep(4) }
  }
  const doPrepare = async () => {
    const d = await run('prepare', { source: server, target, session: sessionId }, '/api/deploy/git/prepare')
    if (d) { setPrep(d); setDiffs(null); setApproval(null) }   // stays on Review — Continue to Approve advances
  }
  const doReview = async () => {
    const d = await run('review', { source: server, target, session: sessionId }, '/api/deploy/git/review')
    if (d) setDiffs(d)
  }
  const doApprove = async () => {
    const commit = prep?.plan?.targetCommit
    if (!commit) return
    const d = await run('approve', { source: server, target, commit, note: approvalNote }, '/api/deploy/git/approve')
    if (d) { setApproval(d); setStep(6) }
  }
  const doDeploy = async () => {
    if (!window.confirm(`Deploy to ${target}? This applies the change and runs safety checks on it.`)) return
    const d = await run('deploy', { source: server, target }, '/api/deploy/git/execute')
    if (d) setRes(d)   // stays on Deploy — the result is shown until Continue
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
  const doDriftAction = async (action) => {
    const label = action === 'revert'
      ? 'Put the target back to the approved state (restores the drifted objects)?'
      : 'Bring the target\u2019s change back into the build stream instead of overwriting it?'
    if (!window.confirm(label)) return
    const d = await run(action, { target, source: server, branch: 'dev' }, `/api/git/drift/${action}`)
    if (d) setDrift(prev => ({ ...prev, actionResult: d }))
  }

  // Deploy lock: show who is deploying to the target (polled on Deploy/Verify).
  useEffect(() => {
    if (step !== 6 && step !== 7) return setLock(null)
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/git/lock?server=${encodeURIComponent(target)}`, { headers: authHeader() })
        setLock(await r.json())
      } catch { /* banner is best-effort */ }
    }, 3000)
    return () => clearInterval(t)
  }, [step, target])

  // The change set's state → where to resume (informational; the wizard still
  // opens at step 1 and this is only a gentle "you were here" hint).
  const resume = (() => {
    if (!deployCtx) return null
    if (!deployCtx.closed_at) return { label: 'open — continue building', step: 1 }
    if (!deployCtx.commit_ref) return { label: 'closed — ready to commit', step: 3 }
    if (deployCtx.deployed_target) return { label: 'shipped', step: 7 }
    return { label: 'committed — review + approve + deploy', step: 4 }
  })()

  // Closing while a deploy is running must warn: the deploy finishes server-side.
  const handleClose = () => {
    if (busy === 'deploy' && !window.confirm('A deploy to ' + target + ' is in progress. It will finish on the server — re-open after it completes to see the result. Close anyway?')) return
    onClose()
  }

  const changed = parseOps(prep?.plan?.ops)
  const behaviour = tests?.results?.filter(r => (r.kind ?? 'behaviour') === 'behaviour') ?? []
  const control   = tests?.results?.filter(r => r.kind === 'control') ?? []
  const blockFails = tests?.results?.filter(r => !r.pass && (r.severity ?? 'block') === 'block') ?? []

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
          {STEP_TITLES.map((t, i) => (
            <span key={t} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/40 mx-0.5">→</span>}
              <button
                onClick={() => setStep(i + 1)}
                className={i + 1 === step ? 'text-xs font-semibold text-foreground underline underline-offset-4' : 'text-xs text-muted-foreground hover:text-foreground'}
              >
                {i + 1} {t}
              </button>
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && <p className="text-xs text-red-600 border border-red-600/40 rounded px-3 py-2">{error}</p>}
          {lock && (step === 6 || step === 7) && (
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
                    <button onClick={() => setStep(2)} className={textBtn}>Continue to Close</button>
                  </div>
                    )
                  })()}
              </div>
            </div>
          )}


          {/* Step 2 — Close (the gate) */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[2].explain}</p>
              <div className="border border-border rounded-md p-3 space-y-3">
                {activeSession ? <p className="text-xs">Change set to close: <span className="font-semibold">{activeSession.name}</span></p> : deployCtx ? <p className="text-xs">Change set <span className="font-semibold">{deployCtx.name}</span> is already closed — continue to Commit.</p> : <p className="text-xs text-muted-foreground">No change set — start one in the status bar first.</p>}
                {!tests && <p className="text-xs text-amber-600">Run the tests first (step 1) so the close records a result.</p>}
                {tests && blockFails.length > 0 && (
                  <div className="border border-red-600/40 rounded-md p-2 space-y-1">
                    <p className="text-xs text-red-600">{blockFails.length} blocking test{blockFails.length !== 1 ? 's are' : ' is'} failing — fix on this server, then re-run the tests.</p>
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
                  <button onClick={closeChangeSet} disabled={closeSession.isPending || !activeSession || !tests || blockFails.length > 0} className={primaryBtn}>Close change set</button>
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
                  Change set {deployCtx ? <span className="font-mono text-foreground/80">"{deployCtx.name}"</span> : ''} — this sends <span className="text-foreground">everything on {server}</span> to GitHub, not just this change set; other people's changes go too (Review shows exactly what). Only commit when {server} is the state you want to ship.
                </p>
                {pushed && (
                  <div className="border border-border rounded-md p-3 bg-muted/20">
                    <p className="text-xs">Committed. {server} is filed in the GitHub repo as <span className="font-mono">{pushed.commit}</span>.</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Nothing on the target server changed. Next: review exactly what would change on it.</p>
                    <button onClick={() => setStep(4)} className={textBtn + ' mt-2'}>Continue to Review</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4 — Review */}
          {step === 4 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[4].explain}</p>
              <div className="border border-border rounded-md p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-16">Target</label>
                  <select value={target} onChange={e => setTarget(e.target.value)} className={inputCls}>
                    {servers.map(s => <option key={s} value={s} className="bg-background">{s}</option>)}
                    {servers.length === 0 && <option value="">(no other servers)</option>}
                  </select>
                  <button onClick={doPrepare} disabled={busy === 'prepare' || !target} className={primaryBtn}>Show what will change</button>
                </div>
                {prep && (
                  <div className="border border-border rounded-md p-3 space-y-2">
                    {prep.fullOverwrite ? (
                      <p className="text-xs text-amber-600">The target has never received a deploy before. Its first pull replaces every object on it — this needs a careful, separate review. Do not continue casually.</p>
                    ) : (
                      <>
                        <p className="text-xs">On <span className="font-semibold">{target}</span>: <span className="font-semibold">{changed.length}</span> object{changed.length !== 1 ? 's' : ''} will change{prep.plan ? `, and it would move to ${prep.plan.targetCommit}.` : '.'}</p>
                        <p className="text-[11px] text-muted-foreground">The target is currently at {prep.deployedCommit} (what it last received).</p>
                        {changed.length > 0 && (
                          <div className="space-y-1 pt-1">
                            {changed.map((o, i) => (
                              <div key={i} className="flex items-baseline gap-2 text-xs px-2 py-1 rounded bg-muted/30">
                                <span className="text-muted-foreground">{o.action.toLowerCase()}</span>
                                <span className="text-muted-foreground/60">{o.type}</span>
                                <span className="font-mono">{o.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {prep.plan && (prep.planByType.Skip ?? 0) > 0 && <p className="text-[11px] text-muted-foreground">{prep.planByType.Skip} objects are unchanged — nothing to do for them.</p>}
                        {changed.length === 0 && prep.plan && <p className="text-xs">Nothing would change — the target already matches the repo.</p>}

                        {changed.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <button onClick={doReview} disabled={busy === 'review'} className={textBtn}>{diffs ? 'Refresh the changes' : 'Show the actual changes'}</button>
                            {busy === 'review' && <span className="text-xs text-muted-foreground ml-2">Reading the diff…</span>}
                            {diffs?.error && <p className="text-xs text-red-600">{diffs.error}</p>}
                            {diffs?.entries?.length > 0 && (
                              <div className="space-y-1.5">
                                {diffs.entries.map((e, i) => (
                                  <details key={i} open={i === 0} className="border border-border rounded-md">
                                    <summary className="px-2 py-1 text-[11px] cursor-pointer select-none">
                              <span className="text-muted-foreground mr-1.5">{e.status}</span>
                              <span className="text-foreground">{humanizeFile(e.file)}</span>
                            </summary>
                                    <div className="mt-0.5 px-2 py-1.5 bg-muted/40 border-t border-border overflow-x-auto">
                                      {(e.diff || '(no content change)').split('\n').map((ln, j) => (
                                        <div key={j} className={'text-[10px] font-mono whitespace-pre ' + (ln.startsWith('+') ? 'text-emerald-700' : ln.startsWith('-') ? 'text-red-600' : ln.startsWith('@@') ? 'text-muted-foreground/60' : 'text-muted-foreground')}>{ln || ' '}</div>
                                      ))}
                                    </div>
                                  </details>
                                ))}
                              </div>
                            )}
{diffs?.manifest?.deletes?.length > 0 && (
                          <p className="text-[11px] text-amber-600">Also deletes: {diffs.manifest.deletes.map(d => `${d.type} ${d.name}`).join(', ')} (TM1 Git cannot propagate deletes — the deploy removes these from the target).</p>
                        )}
                        {diffs?.manifest?.wholesaleDims?.length > 0 && (
                          <p className="text-[11px] text-amber-600">Will copy attribute values wholesale for: {diffs.manifest.wholesaleDims.join(', ')} — the change set recorded only the dimension, not specific values.</p>
                        )}
                        {diffs?.outOfChangeSet?.length > 0 && (
                          <p className="text-[11px] text-amber-600">Outside this change set: {diffs.outOfChangeSet.map(humanizeFile).join(', ')} — from the repo, not this change set. Check these before deploying.</p>
                        )}
                            {diffs?.firstDeploy && (
                              <p className="text-[11px] text-amber-600">First deploy — this target has never received one. Everything it will get is listed above.</p>
                            )}
                          </div>
                        )}
                        {setAssertions.length > 0 && (
                        <div className="border border-border rounded-md p-2 text-[11px] space-y-1">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Tests in this change set</p>
                          {(() => {
                            const run = Object.fromEntries((tests?.results ?? []).map(r => [r.id, r]))
                            return setAssertions.map(a => {
                              const r = run[a.id]
                              return (
                                <p key={a.id}>
                                  <span className={a.severity === 'warn' ? 'text-amber-600' : 'text-muted-foreground'}>{a.severity}</span> · <span className="text-muted-foreground">{a.kind}</span> — <span className="text-foreground">{a.description}</span>
                                  {r && <span className="ml-1.5 text-[10px]">· <span className={r.pass ? 'text-emerald-700' : 'text-red-600'}>{r.pass ? 'passed' : (r.kind === 'control' ? 'failed' : 'changed')}</span></span>}
                                </p>
                              )
                            })
                          })()}
                        </div>
                      )}
                        <div className="flex items-center gap-2 pt-1">
                          <button onClick={() => setStep(3)} className={textBtn}>Back to Commit</button>
                          <button onClick={() => setStep(5)} disabled={!prep.ready} className={primaryBtn}>Continue to Approve</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 5 — Approve */}
          {step === 5 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[5].explain}</p>
              <div className="border border-border rounded-md p-3 space-y-3">
                {!prep?.plan?.targetCommit ? (
                  <p className="text-xs text-muted-foreground">Go back to Review and show what will change first — we need the commit to approve.</p>
                ) : (
                  <>
                    <p className="text-xs">Approve <span className="font-mono">{prep.plan.targetCommit}</span> for <span className="font-semibold">{target}</span>.</p>
                    <div className="border border-border rounded-md p-3 text-xs space-y-1 bg-muted/20">
                      <p><span className="text-muted-foreground">Change set:</span> {activeSession?.name ?? sessionId ? `(closed ${String(sessionId).slice(0, 8)})` : '—'}</p>
                      <p><span className="text-muted-foreground">Changes:</span> {changed.length ? changed.map(o => `${o.name} (${o.action.toLowerCase()})`).join(', ') : 'none'}{diffs?.outOfChangeSet?.length ? ` — plus ${diffs.outOfChangeSet.length} from outside the change set (highlighted in Review)` : ''}</p>
                      {tests && <p><span className="text-muted-foreground">Tests:</span> {tests.passed}/{tests.total} passing{blockFails.length ? `, ${blockFails.length} blocking` : ''}</p>}
                      <p><span className="text-muted-foreground">Commit:</span> <span className="font-mono">{prep.plan.targetCommit}</span></p>
                      <p className="text-[10px] text-muted-foreground/70 pt-2 border-t border-border mt-1">Approving records who approved, when, and this exact commit. On a solo model this is self-approval — it is still recorded.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground w-16">Note</label>
                      <input value={approvalNote} onChange={e => setApprovalNote(e.target.value)} placeholder="optional reason / reference" className={inputCls + ' flex-1'} />
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={doApprove} disabled={busy === 'approve'} className={primaryBtn}>Approve this commit</button>
                      {busy === 'approve' && <span className="text-xs text-muted-foreground">Recording…</span>}
                    </div>
                    {approval && (
                      <div className="border border-border rounded-md p-3 bg-muted/20">
                        <p className="text-xs">Approved by <span className="font-semibold">{approval.approver}</span> at {new Date(approval.approved_at).toLocaleTimeString()}.</p>
                        <button onClick={() => setStep(6)} className={textBtn + ' mt-2'}>Continue to Deploy</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Step 6 — Deploy */}
          {step === 6 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[6].explain}</p>
              <div className="border border-border rounded-md p-3 space-y-3">
                {!prep?.ready && <p className="text-xs text-muted-foreground">Go back to Review and show what will change first — we need to confirm the plan before deploying.</p>}
                {prep?.ready && !approval && <p className="text-xs text-amber-600">Not approved yet — go back to Approve (step 5) to record the decision.</p>}
                <div className="flex items-center gap-2">
                  <button onClick={doDeploy} disabled={busy === 'deploy' || !prep?.ready || !approval} className={primaryBtn}>Deploy to {target}</button>
                  {busy === 'deploy' && <span className="text-xs text-muted-foreground">Applying…</span>}
                </div>
                {changed.length > 0 && <p className="text-[11px] text-muted-foreground">This applies {changed.length} change{changed.length !== 1 ? 's' : ''} ({changed.map(o => o.name).join(', ')}) to {target}.</p>}
                {res && (
                  <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
                    {res.error && <p className="text-xs text-red-600">{res.error}</p>}
                    {res.executed && <p className="text-xs">Applied. {target} is now at <span className="font-mono">{res.targetCommit}</span>.</p>}
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
                        {res.reconcile.attributeValues && (res.reconcile.attributeValues.dims?.length
                          ? <p>Also applied: attribute values across {res.reconcile.attributeValues.dims?.length ?? 0} dimensions (TM1 Git does not carry these).</p>
                          : <p>No attribute values to copy.</p>)}
                        {(res.reconcile.attributeValues?.wholesale?.length > 0) && <p className="text-amber-600">Copied wholesale: {res.reconcile.attributeValues.wholesale.join(', ')}.</p>}
                        {(res.reconcile.attributeValues?.errors?.length > 0) && <p className="text-amber-600">Attribute sync: {res.reconcile.attributeValues.errors.map(e => `${e.dim} — ${e.error}`).join('; ')}</p>}
                        {(res.reconcile.attributeValues?.flagged?.length > 0) && <p className="text-amber-600">Attribute sync skipped: {res.reconcile.attributeValues.flagged.map(e => `${e.dim} — ${e.error}`).join('; ')}</p>}
                        {res.reconcile.deletes?.deleted?.length > 0 && <p>Deleted on {target}: {res.reconcile.deletes.deleted.map(d => `${d.type} ${d.name}`).join(', ')} (TM1 Git does not propagate deletes).</p>}
                        {(res.reconcile.deletes?.flagged?.length > 0) && <p className="text-amber-600">Delete skipped: {res.reconcile.deletes.flagged.map(d => `${d.type} ${d.name} — ${d.error}`).join('; ')}</p>}
                        {res.reconcile.deletes && !res.reconcile.deletes?.deleted?.length && !res.reconcile.deletes?.flagged?.length && <p>No objects needed deleting.</p>}
                        {res.reconcile.error && <p className="text-red-600">{res.reconcile.error}</p>}
                      </div>
                    )}
                    <button onClick={() => setStep(7)} className={textBtn + ' mt-1'}>Continue to Verify</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 7 — Verify */}
          {step === 7 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{STEPS[7].explain}</p>
              <div className="border border-border rounded-md p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-16">Target</label>
                  <select value={target} onChange={e => setTarget(e.target.value)} className={inputCls}>
                    {servers.map(s => <option key={s} value={s} className="bg-background">{s}</option>)}
                  </select>
                  <button onClick={doDrift} disabled={busy === 'drift'} className={primaryBtn}>Check for drift</button>
                </div>
                {drift && (
                  <div className="border border-border rounded-md p-3 space-y-2">
                    {drift.error && <p className="text-xs text-red-600">{drift.error}</p>}
                    {drift.entries && drift.entries.length === 0 && <p className="text-xs"><span className="font-semibold">No drift.</span> {target} matches exactly what it was given.</p>}
                    {drift.entries && drift.entries.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-amber-600">{target} has {drift.entries.length} thing{drift.entries.length !== 1 ? 's' : ''} that changed:</p>
                        {drift.entries.map((e, i) => (
                          <div key={i} className="flex items-baseline gap-2 text-[11px] px-2 py-1 rounded bg-muted/30">
                            <span className="text-muted-foreground">{e.status}</span>
                            <span className="text-foreground">{humanizeFile(e.file)}</span>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 pt-1">
                          <button onClick={() => doDriftAction('revert')} disabled={busy === 'revert'} className={textBtn}>Revert — restore the drifted objects</button>
                          <button onClick={() => doDriftAction('promote')} disabled={busy === 'promote'} className={textBtn}>Promote — bring them back to DEV</button>
                        </div>
                      </div>
                    )}
                    {drift.actionResult && (
                      <p className="text-[11px] text-muted-foreground">{drift.actionResult.note ?? drift.actionResult.error ?? 'Done.'} Re-check to confirm.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Recovery — only on Deploy and Verify */}
          {(step === 6 || step === 7) && (
            <div className="border border-border rounded-md">
              <div className="px-3 py-2 border-b border-border bg-muted/20 text-xs font-semibold">If something goes wrong</div>
              <div className="px-3 py-2 space-y-1.5 text-[11px] text-muted-foreground leading-relaxed">
                <p>· <span className="text-foreground">No rollback.</span> A deploy cannot be automatically undone — if it breaks, <span className="text-foreground">fix forward</span>: correct on {server}, commit, and deploy again.</p>
                <p>· <span className="text-foreground">PROD changed since the last deploy?</span> Use Revert (step 7) to put the drifted objects back, or Promote to bring them into {server}.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}