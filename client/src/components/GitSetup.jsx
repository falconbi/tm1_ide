import { request } from '@/lib/api'
import { useState, useEffect } from 'react'

// Git connection setup — link a server to an EXISTING GitHub repo (no repo
// creation; creating needs a broader token, so the UI says so). Guarded:
// the token is never shown or returned ("token set ✓" only); an already-linked
// server shows its link and is never re-initialised; every step reports, and a
// failure stops the flow at that step with a plain message.
const authHeader = () => ({ 'x-ide-token': localStorage.getItem('tm1-token') ?? '', 'Content-Type': 'application/json' })

export default function GitSetup({ server, onClose, embedded = false }) {
  const [status, setStatus] = useState(null)
  const [repo, setRepo] = useState('')
  const [deployment, setDeployment] = useState(server.includes('PROD') ? 'PROD' : server.includes('TEST') ? 'TEST' : 'DEV')
  const [token, setToken] = useState('')
  const [tokenSet, setTokenSet] = useState(false)
  const [readiness, setReadiness] = useState(null)
  const [linked, setLinked] = useState(false)
  const [first, setFirst] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [statusError, setStatusError] = useState(null)
  const [showLinkForm, setShowLinkForm] = useState(false)

  const run = async (action, body, route) => {
    setBusy(action); setError(null)
    try {
      const r = await request(route, { method: 'POST', headers: authHeader(), body: JSON.stringify(body ?? {}) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      return d
    } catch (e) { setError(e.message); return null }
    finally { setBusy('') }
  }
  useEffect(() => {
    request(`/api/git/setup/status?server=${encodeURIComponent(server)}`, { headers: authHeader() })
      .then(r => r.json()).then(d => {
        setStatus(d)
        if (d?.error) setStatusError(d.error)
        if (d?.linked) setLinked(true)
      }).catch(e => setStatusError(e.message))
  }, [server])
  const tokenSource = status?.tokenSource ?? 'none'
  const tokenLabel = tokenSource === 'env' ? 'from .env' : tokenSource === 'saved' ? 'saved in the IDE' : 'not set'

  const saveToken = async () => {
    const d = await run('token', { token }, '/api/git/setup/token')
    if (d?.ok) { setTokenSet(true); setToken('') }
  }
  const checkReadiness = async () => {
    setBusy('ready')
    try {
      const r = await request(`/api/git/setup/readiness?server=${encodeURIComponent(server)}`, { headers: authHeader() })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      setReadiness(d)
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }
  const readinessBlocked = readiness?.ok === false
  const doInit = async () => {
    setBusy('init'); setError(null)
    try {
      const r = await request('/api/git/setup/init', { method: 'POST', headers: authHeader(), body: JSON.stringify({ server, repo, deployment }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      setLinked(true); setStatus(d); setReadiness(null); setShowLinkForm(false)
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }
  // Direct 'commit current state' — no change set. For realigning a server
  // whose contents were replaced/copied, so the repo matches reality. Only for
  // non-PROD servers (a PROD commit would push the wrong thing to the working branch).
  const commitCurrent = async () => {
    if (!window.confirm('This commits the entire current state of ' + server + ' to the repo, NOT in a change set. Use this when the server was replaced/copied and the repo needs to match. Continue?')) return
    const d = await run('commit', { source: server, message: `Commit current state of ${server}` }, '/api/deploy/git/push')
    if (d) setFirst(d)
  }
  // Part C.1 — a TEST/PROD target writes its OWN objects into Git; nothing is
  // pulled onto the server. This is the step that used to be "first pull".
  const doSetupStart = async () => {
    const d = await run('start', { server, repo: status?.repoUrl ?? repo, deployment }, '/api/git/setup/start')
    if (d) setFirst({ ...d, note: d.note ?? `${server} wrote its own copy into Git.` })
  }
  // The attrs-<server> branch is written by the IDE only (TM1 never exports
  // attributes), so a server linked before setup ran has no attribute baseline
  // for its first close. Write just that branch; leave objects and history alone.
  const doStartAttrs = async () => {
    const d = await run('attrs', { server, attrsOnly: true }, '/api/git/setup/start')
    if (d) setFirst({ ...d, note: d.changed === false ? `Attributes of ${server} were already on ${status?.attrsBranch ?? `attrs-${server}`}.` : `Attributes of ${server} written to ${d.branch ?? status?.attrsBranch ?? `attrs-${server}`}${d.commit ? ` (${d.commit})` : ''}.` })
  }

  const inputCls = 'bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring'
  const primary = 'px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 transition-colors disabled:opacity-40'
  const text = 'px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40'

  return (
    <div className={embedded ? 'flex-1 min-h-0 overflow-y-auto p-6' : 'fixed inset-0 bg-black/50 flex items-center justify-center z-50'}>
      <div
        className={embedded ? 'w-full max-w-3xl mx-auto flex flex-col bg-background' : 'w-[600px] max-h-[90vh] flex flex-col bg-background border border-border rounded-lg shadow-xl'}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Link {server} to GitHub</span>
          {!embedded && <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>}
        </div>
        <div className={embedded ? 'p-4 space-y-4' : 'flex-1 overflow-y-auto p-4 space-y-4'}>
          {error && <p className="text-xs text-red-600 border border-red-600/40 rounded px-3 py-2">{error}</p>}
          {statusError && <p className="text-xs text-red-600 border border-red-600/40 rounded px-3 py-2">{statusError}</p>}

          {!status?.linked && !statusError && (
            <details className="border border-border rounded-md bg-muted/20">
              <summary className="px-3 py-2 text-xs font-semibold cursor-pointer select-none">Full steps — how this works</summary>
              <div className="px-3 pb-3 pt-1 space-y-2 text-[11px] text-muted-foreground leading-relaxed">
                <p><span className="text-foreground">Before you start, have:</span></p>
                <p>· An existing empty GitHub repo for THIS model (one repo per model — its DEV, TEST and PROD servers all link to the same repo, as different deployments). The tool links existing repos; it can't create one.</p>
                <p>· A GitHub <span className="text-foreground">fine-grained personal access token</span> with <span className="text-foreground">Contents: Read &amp; write</span> on that repo (Settings → Developer settings → Fine-grained tokens).</p>
                <p className="text-foreground">Then, in order:</p>
                <p>1. <span className="text-foreground">Repository</span> — paste the repo's <span className="font-mono">…/your-for-model.git</span> URL.</p>
                <p>2. <span className="text-foreground">What is this server</span> — DEV (builds &amp; pushes to the repo) · TEST or PROD (writes its own objects into Git as Last Deployed; nothing is pulled onto it).</p>
                <p>3. <span className="text-foreground">Token</span> — paste it. It is stored only on this server — never shown, logged or sent back. You'll see <span className="text-emerald-700">token set ✓</span>.</p>
                <p>4. <span className="text-foreground">Check readiness</span> — must pass before linking (view/set/member-name problems would break the pull).</p>
                <p>5. <span className="text-foreground">Link to repo (GitInit)</span> — ties this server to the repo as its deployment.</p>
                <p>6. <span className="text-foreground">First move</span> — DEV: <span className="text-foreground">Start DEV</span> (the server writes <span className="font-mono">dev</span>, the IDE writes <span className="font-mono">attrs-{server}</span>). TEST/PROD: <span className="text-foreground">the server writes its own copy</span> (Start TEST/PROD). Nothing is pulled onto either server.</p>
                <p>Already-linked servers (like DEV/PROD here) skip all of this — this screen just shows their link.</p>
              </div>
            </details>
          )}

          {status?.linked && !showLinkForm ? (
            <div className="space-y-4">
              <div className="border border-border rounded-md p-3 text-xs space-y-1">
                <p className="text-emerald-700">Linked to <span className="font-mono">{status.repoUrl}</span> as <span className="font-semibold">{status.deployment}</span> · remote {status.connected ? 'connected ✓' : 'not connected ✗'}</p>
                <p><span className="text-muted-foreground">Token:</span> {tokenLabel}</p>
                {String(status.deployment ?? '').toUpperCase() === 'DEV'
                  ? <p className="text-muted-foreground">Ready to build and commit.</p>
                  : <p className="text-muted-foreground">{status.deployment} already wrote its own copy; nothing is pulled onto it.</p>}
                <button onClick={() => setShowLinkForm(true)} className={text + ' mt-1'}>Link to a different repo</button>
              </div>
              {status?.attrsBranch && Array.isArray(status.branches) && !status.branches.includes(status.attrsBranch) && (
                <div className="border border-amber-600/40 rounded-md p-3 space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Attributes baseline missing</p>
                  <p className="text-[10px] text-muted-foreground/70">This server is linked but has no <span className="font-mono">{status.attrsBranch}</span> branch. TM1 Git never writes attributes, so without it the first close has no attribute baseline.</p>
                  <button onClick={doStartAttrs} disabled={busy === 'attrs'} className={primary}>{busy === 'attrs' ? 'Writing…' : 'Write attributes'}</button>
                </div>
              )}
              {String(status.deployment ?? '').toUpperCase() !== 'PROD' && (
                <div className="border border-border rounded-md p-3 space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Commit current state (no change set)</p>
                  <p className="text-[10px] text-muted-foreground/70">Commits the whole current state of {server} to the repo as-is, NOT in a change set — for when the server was replaced/copied and the repo needs to match (e.g. a PROD copy). Later reviews will mark this as &apos;outside any change set&apos;.</p>
                  <button onClick={commitCurrent} disabled={busy === 'commit'} className={primary}>{busy === 'commit' ? 'Committing…' : 'Commit current state to the repo'}</button>
                  {first && <p className="text-xs text-emerald-700">Committed <span className="font-mono">{first.commit}</span>.</p>}
                </div>
              )}
            </div>
          ) : statusError ? null : (
            <>
              {/* 1. repo */}
              <div className="border border-border rounded-md p-3 space-y-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">1 · The repository</p>
                <input value={repo} onChange={e => setRepo(e.target.value)} placeholder="https://github.com/you/your-model-repo.git" className={inputCls + ' w-full'} />
                <p className="text-[10px] text-muted-foreground/70">Create the (empty) repo on GitHub first — the token here can&apos;t create one. Paste its .git URL.</p>
              </div>
              {/* 2. deployment */}
              <div className="border border-border rounded-md p-3 space-y-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">2 · What is this server?</p>
                <div className="flex gap-1">
                  {['DEV', 'TEST', 'PROD'].map(d => (
                    <button key={d} onClick={() => setDeployment(d)} className={text + (deployment === d ? ' bg-muted text-foreground' : '')}>{d}</button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/70">{deployment === 'DEV' ? 'DEV: this server pushes to the working branch.' : `${deployment}: the server writes its own objects into Git — nothing is pulled onto it.`}</p>
              </div>
              {/* 3. token */}
              <div className="border border-border rounded-md p-3 space-y-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">3 · The GitHub token</p>
                <p className="text-xs"><span className="text-muted-foreground">Token:</span> {tokenSet ? 'saved in the IDE ✓' : tokenLabel}</p>
                {tokenSet ? (
                  <p className="text-emerald-700 text-xs">token set ✓</p>
                ) : (
                  <div className="flex gap-2">
                    <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="fine-grained PAT (repo: contents read/write)" className={inputCls + ' flex-1'} />
                    <button onClick={saveToken} disabled={busy === 'token' || token.trim().length < 8} className={primary}>Save token</button>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/70">{tokenSource === 'env' ? 'TM1_GIT_TOKEN in .env wins over a saved token. Change it there, or remove that line and restart.' : 'Stored only on this server — never shown, logged or sent back to the browser.'}</p>
              </div>
              {/* 4. readiness + init */}
              <div className="border border-border rounded-md p-3 space-y-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">4 · Check &amp; link</p>
                <div className="flex gap-2">
                  <button onClick={checkReadiness} disabled={busy === 'ready'} className={text}>{busy === 'ready' ? 'Checking…' : 'Check readiness'}</button>
                  <button onClick={doInit} disabled={busy === 'init' || readinessBlocked || !repo.trim() || (deployment !== 'PROD' && !deployment)} title={readinessBlocked ? 'Fix the readiness blockers first' : ''} className={primary}>Link to repo (GitInit)</button>
                </div>
                {readiness && (
                  <p className={'text-[11px] ' + (readiness.ok === false ? 'text-amber-600' : 'text-emerald-700')}>
                    Readiness: {readiness.ok === false ? 'blockers found — fix them before pushing.' : 'OK.'}
                    {readiness.failed?.length ? ' · ' + readiness.failed.map(f => f.message ?? f).join('; ') : ''}
                  </p>
                )}
                {linked && <p className="text-emerald-700 text-xs">Linked ✓ — repo {status?.repoUrl} as {status?.deployment}.</p>}
              </div>
              {/* 5. first move — a target writes its OWN objects into Git; nothing
                  is pulled onto it (Part C.1). */}
              {linked && deployment !== 'DEV' && (
                <div className="border border-border rounded-md p-3 space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">5 · {deployment} writes its own copy</p>
                  <p className="text-[11px] text-muted-foreground">
                    TM1 on {server} writes its own objects into Git as {deployment} Last Deployed, and the IDE writes its attributes.
                    Nothing is put onto {server} — there is no first pull.
                  </p>
                  <button onClick={doSetupStart} disabled={busy === 'start'} className={primary}>
                    {busy === 'start' ? 'Writing…' : `Start ${deployment}`}
                  </button>
                </div>
              )}
              {linked && deployment === 'DEV' && (
                <div className="border border-border rounded-md p-3 space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">5 · First move</p>
                  <p className="text-[11px] text-muted-foreground">
                    TM1 on {server} writes its own objects into <span className="font-mono">dev</span>, and the IDE writes its
                    attributes to <span className="font-mono">attrs-{server}</span>. Nothing is pulled onto {server}.
                  </p>
                  <button onClick={doSetupStart} disabled={busy === 'start' || readinessBlocked} title={readinessBlocked ? 'Fix the readiness blockers first' : ''} className={primary}>{busy === 'start' ? 'Starting…' : 'Start DEV'}</button>
                </div>
              )}
            </>
          )}
          {first && <p className="text-xs text-emerald-700 border border-emerald-600/40 rounded px-3 py-2">{first.note ?? 'Done.'}</p>}
        </div>
      </div>
    </div>
  )
}
