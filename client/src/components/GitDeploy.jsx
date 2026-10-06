import { useState, useEffect } from 'react'
import { X, GitBranch, Play, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Trash2, Tag, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import HelpPanel from '@/components/HelpPanel'

// Parse pull-plan ops like "Update Processes('WFP Seed Assumptions')" into
// { action, type, name } for visual rendering.
function parseOps(ops) {
  return (ops ?? [])
    .map(op => {
      const m = String(op).match(/^(Create|Update|Delete|Skip)\s+([^(']+)\(?['"]?([^'")]*)['"]?\)?$/)
      return m ? { action: m[1], type: m[2], name: m[3] || '(tm1project)' } : { action: 'Other', type: '?', name: String(op) }
    })
}
const OP_BADGE = {
  Create: { cls: 'bg-emerald-500/15 text-emerald-600', label: 'Create' },
  Update: { cls: 'bg-amber-500/15 text-amber-600',    label: 'Update' },
  Delete: { cls: 'bg-red-500/15 text-red-600',        label: 'Delete' },
}
const TYPE_ICON = { Process: '⚙', Cube: '▦', Dimension: '▤', View: '▦', Subset: '▦', '?': '·' }

// Git deploy — the TM1 Git deploy flow: prepare (baseline + pull plan preview),
// then deploy (atomic pull + control checks on the target).
const authHeader = () => ({ 'x-ide-token': localStorage.getItem('tm1-token') ?? '' })

export default function GitDeploy({ server, onClose }) {
  const [servers, setServers] = useState([])
  const [target,  setTarget]  = useState('')
  const [branch,  setBranch]  = useState('dev')
  const [prep,    setPrep]    = useState(null)
  const [res,     setRes]     = useState(null)
  const [busy,    setBusy]    = useState('')
  const [error,   setError]   = useState(null)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    fetch('/api/servers', { headers: authHeader() }).then(r => r.json()).then(d => {
      const others = (d ?? []).map(s => s?.name).filter(n => n && n !== server)
      setServers(others)
      setTarget(t => t || (others[0] ?? ''))
    }).catch(() => {})
  }, [server])

  const prepare = async () => {
    setBusy('prepare'); setError(null); setRes(null)
    try {
      const r = await fetch('/api/deploy/git/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ source: server, target, branch }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      setPrep(d)
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }

  const deploy = async () => {
    if (!window.confirm(`Deploy ${branch} → ${target}? This applies the pull to ${target} and runs its control checks.`)) return
    setBusy('execute'); setError(null)
    try {
      const r = await fetch('/api/deploy/git/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ source: server, target, branch }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      setRes(d)
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }

  const btn = 'flex items-center gap-1.5 px-3 py-1 text-xs rounded border border-border text-foreground hover:bg-muted disabled:opacity-40 transition-colors'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="w-[640px] max-h-[85vh] flex flex-col bg-background border border-border rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <GitBranch size={14} className="text-muted-foreground" />
          <span className="text-sm font-semibold">Git deploy — {server}</span>
          <div className="flex-1" />
          <button onClick={() => setShowHelp(true)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Help — Git deploy"><HelpCircle size={14} /></button>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors" title="Close"><X size={14} /></button>
        </div>
        <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="gitdeploy" />

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Target</span>
            <select value={target} onChange={e => setTarget(e.target.value)} className="bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
              {servers.map(s => <option key={s} value={s} className="bg-background">{s}</option>)}
              {servers.length === 0 && <option value="">(no other servers)</option>}
            </select>
            <span className="text-xs text-muted-foreground">Branch</span>
            <input value={branch} onChange={e => setBranch(e.target.value)} className="w-24 bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
            <button onClick={prepare} disabled={busy || !target || target === server} className={btn}>
              {busy === 'prepare' ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />} Prepare
            </button>
          </div>

          {error && <p className="text-xs text-red-600 border border-red-600/40 rounded px-3 py-2">{error}</p>}

          {prep && (
            <div className="border border-border rounded-md">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                <span className="text-xs font-semibold">Prepare — {prep.target}</span>
                <div className="flex-1" />
                {prep.fullOverwrite
                  ? <span className="inline-flex items-center gap-1 text-xs text-amber-600"><AlertTriangle size={12} /> Full overwrite</span>
                  : <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={12} /> Baseline</span>}
              </div>
              <div className="p-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {prep.fullOverwrite
                    ? `Target has NO deployed commit — its first pull will be a FULL OVERWRITE of every object.`
                    : `Deployed commit ${prep.deployedCommit} (${prep.deployedSummary ?? ''})`}
                </p>
                {prep.plan && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Plan: {Object.entries(prep.planByType ?? {}).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ')} — target would go to {prep.plan.targetCommit}
                    </p>

                    {(() => {
                      const changed = parseOps(prep.plan.ops).filter(o => o.action !== 'Skip')
                      if (!changed.length) return null
                      return (
                        <div className="border border-border rounded-md">
                          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-muted/30">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">What will change</span>
                            <div className="flex-1" />
                            <span className="text-[10px] text-muted-foreground/60">{prep.plan.total - (prep.planByType.Skip ?? 0)} of {prep.plan.total}</span>
                          </div>
                          <div className="p-2 space-y-1">
                            {changed.map((o, i) => (
                              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-muted/20">
                                <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', OP_BADGE[o.action]?.cls ?? 'bg-muted text-muted-foreground')}>{OP_BADGE[o.action]?.label ?? o.action}</span>
                                <span className="text-[10px] text-muted-foreground/50 w-16 shrink-0">{o.type}</span>
                                <span className="text-xs font-mono truncate">{o.name}</span>
                              </div>
                            ))}
                            <div className="flex items-center gap-2 px-2 py-0.5 text-[10px] text-muted-foreground/50">
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Skip</span>
                              <span>{prep.planByType.Skip ?? 0} unchanged — no action needed</span>
                            </div>
                          </div>
                        </div>
                      )
                    })()}
                    <details className="mt-1">
                      <summary className="text-[10px] text-muted-foreground cursor-pointer select-none hover:text-foreground">Show all operations</summary>
                      <pre className="mt-1 text-[10px] font-mono text-muted-foreground bg-muted/40 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                        {(prep.plan.ops ?? []).join('\n')}
                      </pre>
                    </details>
                  </>
                )}
                <p className="text-[10px] text-muted-foreground/80">Drift: {prep.drift} (the prod-live diff lands with the drift view)</p>
                <div className="flex items-center gap-2">
                  <button onClick={deploy} disabled={busy || !prep.ready || prep.fullOverwrite}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors">
                    {busy === 'execute' ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />} Deploy to {prep.target}
                  </button>
                  {prep.fullOverwrite && <span className="text-[10px] text-amber-600">Overwrite requires a reviewed first-pull — handled separately.</span>}
                </div>
              </div>
            </div>
          )}

          {res && (
            <div className="border border-border rounded-md">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                <span className="text-xs font-semibold">Deploy result — {res.target}</span>
                <div className="flex-1" />
                {res.controlOk
                  ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={12} /> Control OK</span>
                  : <span className="inline-flex items-center gap-1 text-xs text-red-600"><AlertTriangle size={12} /> Control issues</span>}
              </div>
              <div className="p-3 space-y-3">
                {res.error && <p className="text-xs text-red-600">{res.error}</p>}
                {res.executed && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 size={12} className="text-emerald-600" /> Applied — target now at <span className="font-mono">{res.targetCommit}</span>
                  </p>
                )}

                {/* What changed on the target */}
                {prep?.plan && (() => {
                  const changed = parseOps(prep.plan.ops).filter(o => o.action !== 'Skip')
                  if (!changed.length) return null
                  return (
                    <div className="border border-border rounded-md">
                      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-muted/30">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">What changed on {res.target}</span>
                        <div className="flex-1" />
                        <span className="text-[10px] text-emerald-600">{changed.length} object{changed.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="p-2 space-y-1">
                        {changed.map((o, i) => (
                          <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-muted/20">
                            <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', OP_BADGE[o.action]?.cls ?? 'bg-muted text-muted-foreground')}>{OP_BADGE[o.action]?.label ?? o.action}</span>
                            <span className="text-[10px] text-muted-foreground/50 w-16 shrink-0">{o.type}</span>
                            <span className="text-xs font-mono truncate">{o.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {/* Checks — what we verified on the target */}
                {res.verification?.results?.length > 0 && (
                  <div className="border border-border rounded-md">
                    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-muted/30">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Checks on {res.target}</span>
                      <div className="flex-1" />
                      <span className={cn('text-[10px] font-medium', res.controlOk ? 'text-emerald-600' : 'text-red-600')}>
                        {res.verification.passed}/{res.verification.total} passing
                      </span>
                    </div>
                    <div className="p-2 space-y-1">
                      {res.verification.results.map(a => (
                        <div key={a.id} className="flex items-start gap-2 px-2 py-1 rounded bg-muted/20">
                          {a.pass
                            ? <CheckCircle2 size={12} className="text-emerald-600 mt-0.5 shrink-0" />
                            : <XCircle size={12} className="text-red-600 mt-0.5 shrink-0" />}
                          <div className="min-w-0">
                            <p className="text-xs text-foreground leading-snug">{a.description}</p>
                            <p className="text-[10px] text-muted-foreground/60">
                              {a.error ? `error: ${a.error}` : a.pass ? `expected ${a.expected} · actual ${a.actual}` : `expected ${a.expected}, got ${a.actual}`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reconcile — the gaps TM1 Git can't do (#6) */}
                {res.reconcile && (
                  <div className="border border-border rounded-md">
                    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-muted/30">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Reconcile — the gaps TM1 Git can't do</span>
                    </div>
                    <div className="p-2 space-y-1.5 text-xs">
                      {res.reconcile.error && <p className="text-red-600">{res.reconcile.error}</p>}
                      {res.reconcile.attributeValues && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Tag size={12} className="shrink-0" />
                          <span>Attribute values synced across <span className="text-foreground font-medium">{res.reconcile.attributeValues.dims?.length ?? 0}</span> dimensions</span>
                        </div>
                      )}
                      {res.reconcile.deletes?.deleted?.length > 0 && (
                        <div className="space-y-1">
                          {res.reconcile.deletes.deleted.map((d, i) => (
                            <div key={i} className="flex items-center gap-2 text-muted-foreground">
                              <Trash2 size={12} className="text-red-600 shrink-0" />
                              <span>Deleted <span className="font-mono text-foreground">{d.type}</span> — <span className="font-mono text-foreground">{d.name}</span></span>
                            </div>
                          ))}
                        </div>
                      )}
                      {(!res.reconcile.deletes?.deleted?.length) && res.reconcile.deletes && (
                        <p className="text-muted-foreground flex items-center gap-2"><Trash2 size={12} className="shrink-0" /><span>No deletes needed</span></p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}