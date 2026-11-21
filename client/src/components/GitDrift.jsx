import { request } from '@/lib/api'
import { useState, useEffect } from 'react'
import { X, GitCompare, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, HelpCircle, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import HelpPanel from '@/components/HelpPanel'
import { humanizeFile } from '@/lib/tm1-terms'

// Drift view (#3): PROD pushes its live state to prod-live; the diff vs its
// deployed commit shows what's drifted on PROD (out-of-band edits, PROD-only
// objects). Drift pauses deploys — there is no automated Revert/Promote (retired);
// the fix is to re-apply the change on DEV in a change set and release it.
const authHeader = () => ({ 'x-ide-token': localStorage.getItem('tm1-token') ?? '' })

export default function GitDrift({ server, onClose, embedded = false }) {
  const [servers, setServers] = useState([])
  const [target,  setTarget]  = useState('')
  const [drift,   setDrift]   = useState(null)
  const [busy,    setBusy]    = useState('')
  const [error,   setError]   = useState(null)
  const [openDiff, setOpenDiff] = useState(null)
  // Split by what a deploy could actually damage: everything except views and
  // subsets is in TM1's pull, so only those block.
  const blocking = (drift?.entries ?? []).filter(e => e.blocking !== false)
  const reported = (drift?.entries ?? []).filter(e => e.blocking === false)
  const [showHelp, setShowHelp] = useState(false)
  // Return-to-last-release: the recovery for a half-applied pull, and for a
  // target that no longer resembles any release. Admin only, typed confirmation.
  const [ret, setRet] = useState(null)   // { confirm, reason, busy, error, result }

  useEffect(() => {
    request('/api/servers', { headers: authHeader() }).then(r => r.json()).then(d => {
      const others = (d ?? []).map(s => s?.name).filter(n => n && n !== server)
      setServers(others)
      setTarget(t => t || (others[0] ?? ''))
    }).catch(() => {})
  }, [server])

  const check = async () => {
    setBusy('check'); setError(null)
    try {
      const r = await request('/api/git/drift', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ server: target }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      setDrift(d)
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }

  // Opening the return dialog asks the server what it would remove, in the same
  // words the first pull uses ("removes N elements in M dimensions") — the count
  // is part of what has to be typed, so it cannot be confirmed unread.
  const openReturn = async () => {
    const t = drift?.server ?? target
    setRet({ confirm: '', reason: '', busy: false, error: null, result: null, loading: true })
    try {
      const r = await request(`/api/deploy/git/return/preview?target=${encodeURIComponent(t)}`, { headers: authHeader() })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      setRet(x => ({ ...x, loading: false, preview: d }))
    } catch (e) {
      setRet(x => ({ ...x, loading: false, error: e.message }))
    }
  }

  const doReturn = async () => {
    setRet(r => ({ ...r, busy: true, error: null, result: null }))
    try {
      const r = await request('/api/deploy/git/return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ target: drift?.server ?? target, confirm: ret.confirm, reason: ret.reason }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      setRet(x => ({ ...x, busy: false, result: d }))
      await check()
    } catch (e) {
      setRet(x => ({ ...x, busy: false, error: e.message }))
    }
  }

  const btn = 'flex items-center gap-1.5 px-3 py-1 text-xs rounded border border-border text-foreground hover:bg-muted disabled:opacity-40 transition-colors'

  return (
    <div
      className={embedded ? 'flex-1 min-h-0 overflow-y-auto p-6' : 'fixed inset-0 bg-black/50 flex items-center justify-center z-50'}
      onClick={embedded ? undefined : onClose}
    >
      <div
        className={embedded ? 'w-full max-w-3xl mx-auto flex flex-col bg-background' : 'w-[680px] max-h-[85vh] flex flex-col bg-background border border-border rounded-lg shadow-xl'}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <GitCompare size={14} className="text-muted-foreground" />
          <span className="text-sm font-semibold">Drift — PROD now vs DEV at the last deploy</span>
          <div className="flex-1" />
          <button onClick={() => setShowHelp(true)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Help — Git drift"><HelpCircle size={14} /></button>
          {!embedded && <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors" title="Close"><X size={14} /></button>}
        </div>
        <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="gitdrift" />

        <div className={embedded ? 'p-4 space-y-4' : 'flex-1 overflow-y-auto p-4 space-y-4'}>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Has PROD changed since we last deployed to it? PROD saves a copy of itself; we compare it to the last deploy.
            Same = clean. Different = drift.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Target</span>
            <select value={target} onChange={e => setTarget(e.target.value)} className="bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
              {servers.map(s => <option key={s} value={s} className="bg-background">{s}</option>)}
              {servers.length === 0 && <option value="">(no other servers)</option>}
            </select>
            <button onClick={check} disabled={busy || !target || target === server} className={btn}>
              {busy === 'check' ? <RefreshCw size={12} className="animate-spin" /> : <GitCompare size={12} />} Check drift
            </button>
          </div>

          {error && <p className="text-xs text-red-600 border border-red-600/40 rounded px-3 py-2">{error}</p>}

          {drift && (
            <div className="border border-border rounded-md">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                <span className="text-xs font-semibold">{drift.server}</span>
                <span className="text-[10px] text-muted-foreground">deployed {drift.deployed}</span>
                <div className="flex-1" />
                {drift.error
                  ? <span className="inline-flex items-center gap-1 text-xs text-red-600"><AlertTriangle size={12} /> Check failed</span>
                  : blocking.length === 0
                    ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={12} /> Clean{reported.length ? ` · ${reported.length} reported` : ''}</span>
                    : <span className="inline-flex items-center gap-1 text-xs text-red-600"><AlertTriangle size={12} /> {blocking.length} drifted</span>}
              </div>
              <div className="p-3 space-y-2">
                {drift.note && <p className="text-xs text-muted-foreground">{drift.note}</p>}
                {drift.error && <p className="text-xs text-red-600">{drift.error}</p>}
                {blocking.map((e, i) => (
                  <div key={i} className="border border-border/60 rounded px-2 py-1.5">
                    <button className="w-full flex items-center gap-2 text-left" onClick={() => setOpenDiff(openDiff === `${e.status}:${e.file}` ? null : `${e.status}:${e.file}`)}>
                      <span className={cn('text-[10px] font-mono w-5 shrink-0', e.status === 'A' ? 'text-emerald-600' : e.status === 'D' ? 'text-red-600' : 'text-amber-600')}>{e.status}</span>
                      <span className="flex-1 text-xs text-foreground truncate">{humanizeFile(e.file)}</span>
                      {e.diff && <span className="text-muted-foreground">{openDiff === `${e.status}:${e.file}` ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>}
                    </button>
                    {openDiff === `${e.status}:${e.file}` && e.diff && (
                      <pre className="mt-1 text-[10px] font-mono text-muted-foreground bg-muted/40 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{e.diff}</pre>
                    )}
                  </div>
                ))}
                {blocking.length > 0 && (
                  <div className="pt-1 space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">
                      Deploys to {drift.server} are paused while it has drift. Re-apply the change on DEV in a change
                      set, then release it — or, if {drift.server} is in an unusable state, put it back to the release
                      it last received.
                    </p>
                    <button
                      onClick={openReturn}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded border border-red-600/40 text-red-600 hover:bg-red-500/10"
                    >
                      <Undo2 size={11} /> Return {drift.server} to its last release…
                    </button>
                  </div>
                )}
                {/* Views and subsets are not in TM1's pull, so a change to one is
                    reported and never blocks — but it is never silent either. */}
                {reported.length > 0 && (
                  <div className="pt-2 border-t border-border/40 space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Changed on PROD — not blocking ({reported.length})</p>
                    {reported.map((e, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground">
                        <span className="font-mono">{e.status}</span> {humanizeFile(e.file)}
                        <span className="text-muted-foreground/60"> · {e.kind === 'view' ? 'view' : 'subset'} — a deploy does not touch it</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {ret && (
        <div className="fixed inset-0 bg-black/50 z-[140] flex items-center justify-center" onClick={() => !ret.busy && setRet(null)}>
          <div className="w-[520px] max-w-[calc(100vw-32px)] bg-background border border-border rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <Undo2 size={14} className="text-red-600" />
              <span className="text-sm font-semibold">Return {drift?.server} to its last release</span>
              <div className="flex-1" />
              {!ret.busy && <button onClick={() => setRet(null)} className="p-1 text-muted-foreground hover:text-foreground"><X size={14} /></button>}
            </div>
            <div className="p-4 space-y-3">
              {!ret.result && (
                <>
                  <p className="text-xs leading-relaxed">
                    This puts <span className="font-semibold">{drift?.server}</span> back to the model it received from its
                    last recorded release (<span className="font-mono">{String(drift?.deployed ?? '').slice(0, 10)}</span>).
                    Every object in that release is restored.
                  </p>
                  <div className="border border-amber-600/40 bg-amber-500/5 rounded px-3 py-2 space-y-1">
                    <p className="text-[11px] font-semibold text-amber-700">What it cannot undo</p>
                    <p className="text-[11px] text-muted-foreground">· Data values loaded since then — a pull never touches cell data.</p>
                    <p className="text-[11px] text-muted-foreground">· Objects created after the release — a pull never deletes.</p>
                    <p className="text-[11px] text-muted-foreground">· Anything outside Git (attribute values written over REST).</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">Why (recorded in the deploy history)</label>
                    <input value={ret.reason} onChange={e => setRet(r => ({ ...r, reason: e.target.value }))}
                      placeholder="e.g. a pull failed part-way and the target is half-updated"
                      className="w-full bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  {ret.loading && <p className="text-[11px] text-muted-foreground">Reading what this would remove…</p>}
                  {ret.preview?.elementLoss?.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-amber-700">
                        Elements the target would lose: <span className="font-semibold">{ret.preview.loss.elements}</span> in{' '}
                        <span className="font-semibold">{ret.preview.loss.dimensions}</span> dimension{ret.preview.loss.dimensions === 1 ? '' : 's'}
                      </p>
                      <table className="w-full text-left text-[11px] border border-border rounded">
                        <thead><tr className="text-muted-foreground"><th className="px-2 py-1">Dimension</th><th className="px-2 py-1">Hierarchy</th><th className="px-2 py-1">Count</th><th className="px-2 py-1">Sample</th></tr></thead>
                        <tbody>
                          {ret.preview.elementLoss.map(l => (
                            <tr key={`${l.dimension}/${l.hierarchy}`} className="border-t border-border">
                              <td className="px-2 py-1">{l.dimension}</td>
                              <td className="px-2 py-1 text-muted-foreground">{l.hierarchy}</td>
                              <td className="px-2 py-1">{l.count}</td>
                              <td className="px-2 py-1 text-muted-foreground">{l.sample?.join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {ret.preview && ret.preview.elementLoss?.length === 0 && (
                    <p className="text-[11px] text-emerald-700">No element loss — every object on the target is in that release.</p>
                  )}
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">Type this to confirm</label>
                    <input value={ret.confirm} onChange={e => setRet(r => ({ ...r, confirm: e.target.value }))}
                      placeholder={ret.preview ? `Type exactly: ${ret.preview.confirmText}` : 'Reading the target…'}
                      className="w-full bg-muted border border-border rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  {ret.error && <p className="text-[11px] text-red-600 border border-red-600/40 rounded px-2 py-1">{ret.error}</p>}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={doReturn}
                      disabled={ret.busy || ret.loading || !ret.preview || ret.confirm.trim() !== ret.preview?.confirmText}
                      className="px-3 py-1.5 text-xs rounded bg-red-700 text-white hover:bg-red-600 disabled:opacity-40"
                    >
                      {ret.busy ? 'Returning…' : `Return ${drift?.server}`}
                    </button>
                    <button onClick={() => setRet(null)} disabled={ret.busy} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">Cancel</button>
                    <span className="text-[10px] text-muted-foreground ml-auto">Administrators only</span>
                  </div>
                </>
              )}
              {ret.result && (
                <>
                  <div className="border border-emerald-600/30 bg-emerald-600/5 rounded px-3 py-2 space-y-1">
                    <p className="text-xs font-semibold text-emerald-700">
                      {ret.result.already ? 'Already holding the last release' : 'Returned to the last release'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {ret.result.already
                        ? `${drift?.server} already matched its last release — nothing was changed.`
                        : `${(ret.result.applied ?? []).length} object(s) restored. Drift should now be clean; check it above.`}
                    </p>
                    {ret.result.historyError && <p className="text-[11px] text-amber-700">{ret.result.historyError}</p>}
                  </div>
                  <button onClick={() => setRet(null)} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600">Done</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
