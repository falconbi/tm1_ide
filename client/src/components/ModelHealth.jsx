import { useState } from 'react'
import { X, Activity, RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronRight, Copy, FileCode2, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

// Plain-English summary of what an assertion's MDX checks: the cube and its
// [Dim].[Member] filters.
function summarizeMdx(mdx) {
  if (!mdx) return { cube: '', filters: [] }
  const cube = mdx.match(/FROM\s+\[([^\]]+)\]/i)?.[1] ?? ''
  const refs = []
  const re = /\[([^\]\[]+)\]\.\[([^\]\[]+)\]\.\[([^\]\[]+)\]/g
  let m
  while ((m = re.exec(mdx))) refs.push({ dim: m[1], member: m[3] })
  const seen = new Set()
  const filters = refs.filter(r => { const k = `${r.dim}.${r.member}`; if (seen.has(k)) return false; seen.add(k); return true })
  return { cube, filters }
}

// What to investigate, based on the assertion's tags.
function suggestHints(tags = []) {
  const t = tags.join(' ').toLowerCase()
  if (/consolidat|ownership|nci|goodwill|control/.test(t))
    return 'Consolidation / ownership logic — check the consolidation processes, holdings and the control chain that feed this result.'
  if (/tax/.test(t))
    return 'Tax — check the tax rates / bands and the payroll inputs that drive this figure.'
  if (/company|balance/.test(t))
    return 'Company adjustments / balances — check the adjustment entries and that every entity balances at this stage.'
  if (/headcount|forecast/.test(t))
    return 'Headcount / forecast — check the headcount plan, leavers / joiners and the forecast version this compares against.'
  return 'Something this MDX depends on changed since the value was recorded — a rule, source data, a feeder, or a version/element. Check what feeds this cube and re-run.'
}

// Model health (v1): does the model compute right (assertions), would TM1 Git
// accept it (readiness), and does it meet house standards (Default view/subset).
// Runs on the button only — nothing happens on open. Monochrome; colour only for
// pass/fail.
export default function ModelHealth({ server, onClose }) {
  const { openTab } = useStore()
  const [result,  setResult]  = useState(null)
  const [running, setRunning] = useState(false)
  const [error,   setError]   = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [copied,  setCopied]  = useState(null)
  const [assertKind, setAssertKind] = useState('all')
  const [histories, setHistories] = useState({})
  const [openHist,  setOpenHist]  = useState(null)

  const loadHistory = async f => {
    if (histories[f.id]) return
    try {
      const r = await fetch(`/api/assertions/history?server=${encodeURIComponent(server)}&id=${encodeURIComponent(f.id)}`, { headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' } })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      setHistories(h => ({ ...h, [f.id]: d }))
    } catch { setHistories(h => ({ ...h, [f.id]: [] })) }
  }

  const run = async () => {
    setRunning(true); setError(null)
    try {
      const r = await fetch(`/api/model-health?server=${encodeURIComponent(server)}`, {
        method: 'POST',
        headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' },
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      setResult(d)
    } catch (e) { setError(e.message) }
    finally { setRunning(false) }
  }

  const copy = async (text, id) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1500) } catch { /* ignore */ }
  }

  const Status = ({ ok }) => ok
    ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={13} /> OK</span>
    : <span className="inline-flex items-center gap-1 text-xs text-red-600"><XCircle size={13} /> Issues</span>

  const empty = <p className="text-xs text-muted-foreground italic">Clean — nothing to report.</p>

  const a = result?.sections?.assertions
  const g = result?.sections?.git_readiness
  const h = result?.sections?.house_standards

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="w-[640px] max-h-[85vh] flex flex-col bg-background border border-border rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <Activity size={14} className="text-muted-foreground" />
          <span className="text-sm font-semibold">Model health — {server}</span>
          <div className="flex-1" />
          <button onClick={run} disabled={running}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded border border-border text-foreground hover:bg-muted disabled:opacity-40 transition-colors">
            {running ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />} Run health check
          </button>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors" title="Close"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && <p className="text-xs text-red-600 border border-red-600/40 rounded px-3 py-2">{error}</p>}
          {!result && !running && <p className="text-xs text-muted-foreground italic">Nothing has run yet. Click "Run health check" — it executes the model's assertions and scans for readiness and house standards (this can take a few seconds).</p>}

          {/* Assertions */}
          <section className="border border-border rounded-md">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold">Assertions</span>
              <span className="text-[10px] text-muted-foreground">does the model compute the right numbers?</span>
              <div className="flex-1" />
              {a && (a.error ? <Status ok={false} /> : <Status ok={a.ok} />)}
            </div>
            <div className="p-3 space-y-2">
              {!a && <p className="text-xs text-muted-foreground italic">Not run yet.</p>}
              {a?.error && <p className="text-xs text-red-600">{a.error}</p>}
              {a && !a.error && (
                <>
                  <p className="text-[10px] text-muted-foreground/80">Behaviour = a specific number on DEV. Control = a rule that must hold on any data (DEV and PROD).</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs text-muted-foreground">
                      {a.passed}/{a.total} passing
                      {a.failed > 0 && (() => {
                        const beh = a.failures.filter(f => (f.kind ?? 'behaviour') !== 'control').length
                        const ctl = a.failures.filter(f => f.kind === 'control').length
                        return <> · {beh > 0 && <span className="text-amber-600">{beh} changed</span>}{beh > 0 && ctl > 0 && ' · '}{ctl > 0 && <span className="text-red-600">{ctl} failed</span>}</>
                      })()}
                    </p>
                    {a.by_kind && (
                      <span className="text-[10px] text-muted-foreground">
                        · behaviour {a.by_kind.behaviour.passed}/{a.by_kind.behaviour.total} · control {a.by_kind.control.passed}/{a.by_kind.control.total}
                      </span>
                    )}
                    <div className="flex items-center gap-1 ml-auto">
                      {['all', 'behaviour', 'control'].map(k => (
                        <button key={k} onClick={() => setAssertKind(k)}
                          className={cn('px-2 py-0.5 text-[10px] rounded border transition-colors', assertKind === k ? 'bg-muted text-foreground border-border' : 'border-border/50 text-muted-foreground hover:text-foreground')}>
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                  {a.failures.filter(f => assertKind === 'all' || (f.kind ?? 'behaviour') === assertKind).length === 0 && empty}
                  {a.failures.filter(f => assertKind === 'all' || (f.kind ?? 'behaviour') === assertKind).map(f => {
                    const s = summarizeMdx(f.mdx)
                    const isControl = (f.kind ?? 'behaviour') === 'control'
                    const controlsOk = a.by_kind?.control ? a.by_kind.control.passed === a.by_kind.control.total : true
                    const label = isControl ? 'failed' : 'changed'
                    const tone = isControl ? 'text-red-600' : 'text-amber-600'
                    return (
                      <div key={f.id} className={cn('border rounded px-2 py-1.5', isControl ? 'border-red-600/30' : 'border-amber-600/30')}>
                        <button className="w-full flex items-start gap-2 text-left" onClick={() => setExpanded(expanded === f.id ? null : f.id)}>
                          <span className={cn('mt-0.5 shrink-0', tone)}>{expanded === f.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                          <span className="flex-1">
                            <span className="block text-xs"><span className={cn('font-medium mr-1.5', tone)}>{label}</span>{f.description}</span>
                            {f.tags?.length > 0 && (
                              <span className="block text-[10px] text-muted-foreground mt-0.5">{f.tags.map(t => `# ${t}`).join('  ')}</span>
                            )}
                            <span className="block text-[10px] text-muted-foreground mt-0.5">
                              {f.error ? `error: ${f.error}` : `expected ${f.expected}, got ${f.actual}`}
                            </span>
                          </span>
                        </button>
                        <div className="mt-1.5 ml-5 space-y-1.5">
                          {s.cube && (
                            <p className="text-[10px] text-muted-foreground">
                              <span className="font-mono text-foreground/80">{s.cube}</span>
                              {s.filters.length > 0 && <> — {s.filters.map(r => `${r.dim}: ${r.member}`).join(' · ')}</>}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground/80">
                            {isControl
                              ? <><span className="text-red-600/80">What to do:</span> the model is broken — a rule no longer holds. Fix the logic; do not change the expected.</>
                              : controlsOk
                                ? <><span className="text-amber-600/80">What to do:</span> the model still holds together, so this is most likely the data moving. Confirm the new number is right, then update the expected (the test was out of date).</>
                                : <><span className="text-amber-600/80">What to do:</span> control checks are failing too — look at the logic, not just the data.</>}
                          </p>
                          <p className="text-[10px] text-muted-foreground/80"><span className="text-amber-600/80">Check:</span> {suggestHints(f.tags)}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <button onClick={() => { setOpenHist(openHist === f.id ? null : f.id); loadHistory(f) }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-foreground hover:bg-muted transition-colors" title="Show run history">
                              <ChevronDown size={10} className={cn('transition-transform', openHist === f.id && 'rotate-180')} /> History
                            </button>
                            {s.cube && (
                              <>
                                <button onClick={() => openTab({ id: `rules:${server}:${s.cube}`, type: 'rules', label: s.cube, server, cube: s.cube, content: null })}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-foreground hover:bg-muted transition-colors" title="Open this cube's rules">
                                  <FileCode2 size={10} /> Open rules
                                </button>
                                <button onClick={() => openTab({ id: `view:${server}:${s.cube}:Default`, type: 'view', label: s.cube, server, cube: s.cube, viewName: 'Default' })}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-foreground hover:bg-muted transition-colors" title="Open the cube's Default view">
                                  <Table2 size={10} /> Open Default view
                                </button>
                              </>
                            )}
                          </div>
                          {openHist === f.id && histories[f.id] && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] text-muted-foreground">Last runs:</span>
                              {histories[f.id].length === 0 && <span className="text-[10px] text-muted-foreground italic">no history recorded yet</span>}
                              {histories[f.id].map((h, i) => (
                                <span key={h.run} className={cn('text-[10px] px-1.5 py-0.5 rounded border', h.pass === 1 ? 'border-emerald-600/30 text-emerald-600' : 'border-red-600/30 text-red-600')}
                                  title={`${h.run} — expected ${h.expected}, actual ${h.actual}`}>
                                  {h.run.slice(4, 12)} {h.pass === 1 ? 'P' : 'F'}
                                </span>
                              ))}
                            </div>
                          )}
                          {expanded === f.id && f.mdx && (
                            <div className="flex items-start gap-2">
                              <pre className="flex-1 text-[10px] font-mono text-muted-foreground bg-muted/40 rounded px-2 py-1.5 whitespace-pre-wrap break-all">{f.mdx}</pre>
                              <button onClick={() => copy(f.mdx, f.id)} className="p-1 text-muted-foreground hover:text-foreground transition-colors" title="Copy MDX">
                                <Copy size={12} />
                              </button>
                            </div>
                          )}
                          {copied === f.id && <p className="text-[10px] text-emerald-600">Copied</p>}
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </section>

          {/* Git readiness */}
          <section className="border border-border rounded-md">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold">Git readiness</span>
              <span className="text-[10px] text-muted-foreground">would TM1 Git accept it?</span>
              <div className="flex-1" />
              {g && (g.error ? <Status ok={false} /> : <Status ok={g.ok} />)}
            </div>
            <div className="p-3 space-y-2">
              {!g && <p className="text-xs text-muted-foreground italic">Not run yet.</p>}
              {g?.error && <p className="text-xs text-red-600">{g.error}</p>}
              {g && !g.error && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {g.memberLessTitles.length} member-less titles · {g.staleViewMembers.length} stale member refs · {g.staleSubsetElements.length} stale subset elements · {g.roundTripNames.length} round-trip problem names
                  </p>
                  {g.memberLessTitles.length + g.staleViewMembers.length + g.staleSubsetElements.length + g.roundTripNames.length === 0 && empty}
                  {g.memberLessTitles.map((x, i) => <p key={`m${i}`} className="text-xs text-red-600">title without a selected member: {x.cube}/{x.view} (dim {x.dim})</p>)}
                  {g.staleViewMembers.map((x, i) => <p key={`s${i}`} className="text-xs text-red-600">stale member {x.dim}.{x.member} ({x.where})</p>)}
                  {g.staleSubsetElements.map((x, i) => <p key={`e${i}`} className="text-xs text-red-600">static subset {x.dim}/{x.subset} references missing element {x.element}</p>)}
                  {g.roundTripNames.map((x, i) => <p key={`r${i}`} className="text-xs text-red-600">{x.kind} "{x.name}" — {x.problem}</p>)}
                  {g.tm1projectIgnore?.length > 0 && <p className="text-[10px] text-muted-foreground">tm1project Ignore ({g.tm1projectIgnore.length}): {g.tm1projectIgnore.join(', ')}</p>}
                </>
              )}
            </div>
          </section>

          {/* House standards */}
          <section className="border border-border rounded-md">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold">House standards</span>
              <span className="text-[10px] text-muted-foreground">Default view per cube, Default subset per dimension</span>
              <div className="flex-1" />
              {h && (h.error ? <Status ok={false} /> : <Status ok={h.ok} />)}
            </div>
            <div className="p-3 space-y-2">
              {!h && <p className="text-xs text-muted-foreground italic">Not run yet.</p>}
              {h?.error && <p className="text-xs text-red-600">{h.error}</p>}
              {h && !h.error && (
                <>
                  {h.cubesWithoutDefaultView.length === 0 && h.dimsWithoutDefaultSubset.length === 0 && empty}
                  {h.cubesWithoutDefaultView.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">Cubes without a Default view:</p>
                      <p className="text-xs text-red-600">{h.cubesWithoutDefaultView.join(', ')}</p>
                    </div>
                  )}
                  {h.dimsWithoutDefaultSubset.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">Dimensions without a Default subset:</p>
                      <p className="text-xs text-red-600">{h.dimsWithoutDefaultSubset.join(', ')}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}