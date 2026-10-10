import { useState, useEffect } from 'react'
import { X, GitCompare, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import HelpPanel from '@/components/HelpPanel'
import { humanizeFile } from '@/lib/tm1-terms'

// Drift view (#3): PROD pushes its live state to prod-live; the diff vs its
// deployed commit shows what's drifted on PROD (out-of-band edits, PROD-only
// objects). Drift pauses deploys — there is no automated Revert/Promote (retired);
// the fix is to re-apply the change on DEV in a change set and release it.
const authHeader = () => ({ 'x-ide-token': localStorage.getItem('tm1-token') ?? '' })

export default function GitDrift({ server, onClose }) {
  const [servers, setServers] = useState([])
  const [target,  setTarget]  = useState('')
  const [drift,   setDrift]   = useState(null)
  const [busy,    setBusy]    = useState('')
  const [error,   setError]   = useState(null)
  const [openDiff, setOpenDiff] = useState(null)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    fetch('/api/servers', { headers: authHeader() }).then(r => r.json()).then(d => {
      const others = (d ?? []).map(s => s?.name).filter(n => n && n !== server)
      setServers(others)
      setTarget(t => t || (others[0] ?? ''))
    }).catch(() => {})
  }, [server])

  const check = async () => {
    setBusy('check'); setError(null)
    try {
      const r = await fetch('/api/git/drift', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ server: target }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      setDrift(d)
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }

  const btn = 'flex items-center gap-1.5 px-3 py-1 text-xs rounded border border-border text-foreground hover:bg-muted disabled:opacity-40 transition-colors'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="w-[680px] max-h-[85vh] flex flex-col bg-background border border-border rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <GitCompare size={14} className="text-muted-foreground" />
          <span className="text-sm font-semibold">Drift — PROD now vs DEV at the last deploy</span>
          <div className="flex-1" />
          <button onClick={() => setShowHelp(true)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Help — Git drift"><HelpCircle size={14} /></button>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors" title="Close"><X size={14} /></button>
        </div>
        <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="gitdrift" />

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                  : (drift.entries?.length ?? 0) === 0
                    ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={12} /> Clean</span>
                    : <span className="inline-flex items-center gap-1 text-xs text-red-600"><AlertTriangle size={12} /> {drift.entries.length} drifted</span>}
              </div>
              <div className="p-3 space-y-2">
                {drift.note && <p className="text-xs text-muted-foreground">{drift.note}</p>}
                {drift.error && <p className="text-xs text-red-600">{drift.error}</p>}
                {(drift.entries ?? []).map((e, i) => (
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
                {(drift.entries?.length ?? 0) > 0 && (
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Deploys to {drift.server} are paused while it has drift. Re-apply the change on DEV in a change
                    set, then release it.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}