import { useEffect, useState } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { request, authHeader } from '@/lib/api'

// Part E — Sync DEV from PROD. Separate from a deploy and never a deploy. PROD's
// own changes are written onto DEV in a `sync` change set that owns nothing; the
// admin may untick an item to skip it this time.
const GET = async (url) => {
  const r = await request(url, { headers: authHeader() })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.error) throw new Error(d.error || r.statusText)
  return d
}
const POST = async (route, body) => {
  const r = await request(route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.error) throw new Error(d.error || r.statusText)
  return d
}

export default function DeploySync({ source }) {
  const [targets, setTargets] = useState([])
  const [target, setTarget] = useState('')
  const [plan, setPlan] = useState(null)
  const [untick, setUntick] = useState({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    request('/api/servers', { headers: authHeader() })
      .then(r => r.json())
      .then(list => setTargets((list ?? []).map(s => s?.name ?? s).filter(n => n && n !== source)))
      .catch(() => {})
  }, [source])

  const load = async () => {
    setBusy('plan'); setError(null); setResult(null)
    try {
      const d = await GET(`/api/deploy/sync/plan?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`)
      setPlan(d); setUntick({})
    } catch (e) { setError(e.message); setPlan(null) }
    finally { setBusy('') }
  }

  const run = async () => {
    setBusy('sync'); setError(null)
    try {
      const r = await POST('/api/deploy/sync', { source, target, untick: Object.keys(untick).filter(k => untick[k]) })
      setResult(r)
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }

  const rows = [
    ...(plan?.dimensions ?? []).filter(d => d.offered !== false).map(d => ({ key: `dimension:${d.dimension}`, label: `Dimension ${d.dimension}`, detail: d.summary?.map(s => `${s.count} ${s.what}`).join(', ') || 'changed on PROD' })),
    ...(plan?.chores ?? []).map(c => ({ key: `chore:${c.name}`, label: `Chore ${c.name}`, detail: c.fields?.length ? `schedule: ${c.fields.join(', ')}` : 'only on PROD' })),
    ...(plan?.subsets ?? []).map(c => ({ key: `subset:${c.name}:${c.dimension}`, label: `Subset ${c.name}`, detail: c.dimension })),
    ...(plan?.views ?? []).map(c => ({ key: `view:${c.name}:${c.cube}`, label: `View ${c.name}`, detail: c.cube })),
    ...(plan?.hierarchies ?? []).map(h => ({ key: `hierarchy:${h.name}:${h.dimension}`, label: `Hierarchy ${h.name}`, detail: h.dimension })),
  ]

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><RefreshCw size={13} /> Sync {source} from PROD</h2>
          <p className="text-xs text-muted-foreground">
            Separate from a deploy. PROD's own changes are written into {source} in a <span className="font-mono">sync</span> change set
            that owns nothing and is never deployed. Default is to take PROD's version; untick anything to skip it this time.
            DEV must have <span className="text-foreground">no open change set</span> — close or retire them first, because a sync
            writes into {source} and would move the data under in-flight work.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">PROD</span>
          <select value={target} onChange={e => { setTarget(e.target.value); setPlan(null); setResult(null) }} className="bg-muted border border-border rounded px-2 py-1 text-xs">
            {!target && <option value="">Select PROD…</option>}
            {targets.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={load} disabled={!target || !!busy} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted disabled:opacity-40">
            {busy === 'plan' ? 'Reading…' : 'Show what PROD changed'}
          </button>
        </div>

        {plan && (
          <div className="border border-border rounded-md divide-y divide-border/40">
            {(plan.clashes ?? []).length > 0 && (
              <div className="p-2 space-y-1 bg-amber-500/5">
                <p className="text-[11px] font-medium text-amber-700">Clashes — PROD's value replaces the developer's change</p>
                {(plan.clashes ?? []).map(c => (
                  <p key={`clash-${c.key}-${c.kind}`} className="text-[10px] text-muted-foreground">
                    <span className="text-foreground">{c.item}</span>
                    {' '}· PROD: <span className="font-mono">{c.prodValue ?? '(none)'}</span>
                    {' '}· {source}: <span className="font-mono">{c.devValue ?? '(none)'}</span>
                    {' '}· change set {c.changeSet ? `${c.changeSet.name} (${c.changeSet.user ?? 'unknown'})` : 'not recorded'}
                  </p>
                ))}
              </div>
            )}
            {rows.length === 0 && <p className="p-3 text-[11px] text-emerald-700">Nothing to sync — {source} already has what PROD has.</p>}
            {rows.map(r => (
              <label key={r.key} className="flex items-start gap-2 p-2 text-[11px]">
                <input type="checkbox" checked={!untick[r.key]} onChange={e => setUntick(p => ({ ...p, [r.key]: !e.target.checked }))} className="mt-0.5" />
                <span><span className="text-foreground">{r.label}</span> <span className="text-muted-foreground">— {r.detail}</span></span>
              </label>
            ))}
            <div className="p-2 flex items-center gap-2">
              <button onClick={run} disabled={!!busy || rows.length === 0} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">
                {busy === 'sync' ? <span className="flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Syncing…</span> : 'Sync into ' + source}
              </button>
              <span className="text-[10px] text-muted-foreground">Every chore copied is switched off on {source}.</span>
            </div>
          </div>
        )}

        {error && <p className="text-[11px] text-red-600">{error}</p>}
        {result && (
          <div className="border border-emerald-600/30 bg-emerald-600/5 rounded-md p-3 space-y-1">
            <p className="text-[11px] text-emerald-700">{result.ok ? 'Synced' : (result.error || 'Stopped')}{result.closed?.commit ? ` · DEV After Close ${String(result.closed.commit).slice(0, 10)}` : ''}</p>
            {(result.applied ?? []).map((a, i) => <p key={i} className="text-[10px] text-muted-foreground">{a.dimension}: {a.applied}</p>)}
            {(result.errors ?? []).map((e, i) => <p key={`e-${i}`} className="text-[10px] text-red-600">{e.dimension}: {e.why}</p>)}
            {(result.developerNotes ?? []).map((n, i) => <p key={`n-${i}`} className="text-[10px] text-muted-foreground">Told {n.name}: their change was replaced by PROD's.</p>)}
          </div>
        )}
      </div>
    </div>
  )
}
