import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, X, Loader2, Copy, AlertTriangle, CheckCircle2, Ban } from 'lucide-react'
import { request, authHeader } from '@/lib/api'
import { useStore } from '@/store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// The report of one deployment: what shipped, who approved it, what the checks
// said, what drifted. Read-only — the deploy already happened.
//
// Opened from anywhere that knows (target, commit): the change set row, Deploy →
// History, or the ship result. One record per deployment, so all of them show
// the same document.
//
// A deploy from before records existed still opens: it shows the commit, time
// and summary that History keeps, and says plainly that nothing more was kept.
// A link that dead-ends is worse than one that admits what it lacks.

const OUTCOME = {
  ok:               { label: 'Deployed', className: 'text-emerald-700 border-emerald-600/30 bg-emerald-600/5' },
  refused:          { label: 'Refused — nothing reached the target', className: 'text-amber-600 border-amber-600/40 bg-amber-500/5' },
  'pull-failed':    { label: 'The pull failed part-way', className: 'text-red-600 border-red-600/40 bg-red-500/5' },
  unrecorded:       { label: 'Deployed, but the record was not written', className: 'text-amber-600 border-amber-600/40 bg-amber-500/5' },
  'subsets-views':  { label: 'Deployed, some views/subsets did not apply', className: 'text-amber-600 border-amber-600/40 bg-amber-500/5' },
  incomplete:       { label: 'Deployed, some objects not confirmed', className: 'text-amber-600 border-amber-600/40 bg-amber-500/5' },
  'checks-failed':  { label: 'Deployed, but the safety checks failed', className: 'text-red-600 border-red-600/40 bg-red-500/5' },
  restored:         { label: 'Returned to its last release', className: 'text-emerald-700 border-emerald-600/30 bg-emerald-600/5' },
}

const fmt = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

const short = (c) => (c ? String(c).slice(0, 10) : '—')

const label = (o) => `${o.parent ? `${o.parent} · ` : ''}${o.name ?? '(unnamed)'}`

function toMarkdown(r) {
  const lines = []
  lines.push(`# Deploy report — ${r.target}`)
  lines.push('')
  lines.push(`- Outcome: ${OUTCOME[r.outcome]?.label ?? r.outcome}`)
  if (r.changeSet?.name) lines.push(`- Change set: ${r.changeSet.name}`)
  if (r.approval?.by) lines.push(`- Approved by: ${r.approval.by}${r.approval.at ? ` · ${fmt(r.approval.at)}` : ''}`)
  lines.push(`- Commits: ${short(r.base)} → ${short(r.commit)}${r.release && r.release !== r.commit ? ` (release ${short(r.release)})` : ''}`)
  if (r.finishedAt) lines.push(`- When: ${fmt(r.finishedAt)}${r.durationMs != null ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ''}`)
  if (r.error) lines.push(`- Message: ${r.error}`)
  lines.push('')
  lines.push(`## What shipped (${r.objects?.length ?? 0})`)
  if (!r.objects?.length) lines.push('_No object list recorded._')
  for (const o of r.objects ?? []) lines.push(`- ${o.type} · ${label(o)}`)
  if (r.checks) {
    lines.push('')
    lines.push(`## Checks`)
    lines.push(`- ${r.checks.error ? `errored: ${r.checks.error}` : `${r.checks.passed} of ${r.checks.total} passed`}`)
    for (const f of r.checks.failures ?? []) lines.push(`- FAILED: ${f.description} (expected ${f.expected}, got ${f.actual})`)
  }
  lines.push('')
  lines.push('## Drift')
  lines.push(`- Before: ${r.drift?.before ?? 'not checked'}`)
  for (const e of r.drift?.blocking ?? []) lines.push(`- blocking: ${e.status} ${e.file}`)
  for (const e of r.drift?.reported ?? []) lines.push(`- reported, not blocking: ${e.status} ${e.file}`)
  if (r.subsetsViews?.errors?.length) {
    lines.push('')
    lines.push('## Views and subsets that did not apply')
    for (const e of r.subsetsViews.errors) lines.push(`- ${e.type} ${e.name}: ${e.error}`)
  }
  if (r.loss?.elements > 0) {
    lines.push('')
    lines.push(`## Elements removed (${r.loss.elements} in ${r.loss.dimensions} dimensions)`)
    for (const l of r.elementLoss ?? []) lines.push(`- ${l.dimension}/${l.hierarchy}: ${l.count} (${(l.sample ?? []).join(', ')})`)
  }
  if (r.incomplete?.length) {
    lines.push('')
    lines.push('## Objects not confirmed')
    for (const x of r.incomplete) lines.push(`- ${x}`)
  }
  return lines.join('\n')
}

function Row({ k, children }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="w-24 shrink-0 text-muted-foreground">{k}</span>
      <span className="text-foreground">{children}</span>
    </div>
  )
}

export default function DeployReport() {
  const { deployReport, closeDeployReport } = useStore()
  const target = deployReport?.target ?? null
  const commit = deployReport?.commit ?? null

  // Server state in a query: opening the panel is a read, not a local state machine.
  const q = useQuery({
    queryKey: ['deploy-record', target, commit],
    enabled: !!deployReport && !!target,
    queryFn: async () => {
      const qs = new URLSearchParams({ target: target ?? '' })
      if (commit) qs.set('commit', commit)
      const r = await request(`/api/deploy/record?${qs.toString()}`, { headers: authHeader() })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      return d
    },
  })
  const data = q.data ?? null
  const loading = q.isLoading
  const error = q.error?.message ?? null

  useEffect(() => {
    if (!deployReport) return
    const onKey = (e) => { if (e.key === 'Escape') closeDeployReport() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deployReport, closeDeployReport])

  if (!deployReport) return null

  const rec = data?.record ?? null
  const outcome = rec ? OUTCOME[rec.outcome] : null

  const copyMarkdown = async () => {
    const md = rec ? toMarkdown(rec) : `# Deploy report — ${target}\n\nNo record was kept for ${short(commit)}.`
    try {
      await navigator.clipboard.writeText(md)
      toast.success('Report copied as markdown')
    } catch {
      toast.error('Could not copy — select the text instead')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[130] flex items-center justify-center" onClick={closeDeployReport}>
      <div className="w-[680px] max-w-[calc(100vw-32px)] max-h-[86vh] bg-background border border-border rounded-lg shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          <FileText size={14} className="text-muted-foreground" />
          <span className="text-sm font-semibold">Deploy report</span>
          <span className="text-xs text-muted-foreground">· {target}</span>
          <div className="flex-1" />
          {rec && (
            <button onClick={copyMarkdown} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground" title="Copy as markdown">
              <Copy size={10} /> Copy
            </button>
          )}
          <button onClick={closeDeployReport} className="text-muted-foreground hover:text-foreground ml-2" title="Close"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center"><Loader2 size={12} className="animate-spin" /> Loading…</div>}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {!loading && !error && !rec && (
            <div className="border border-amber-600/40 bg-amber-500/5 rounded-md p-3 space-y-1">
              <p className="text-xs font-semibold flex items-center gap-1.5 text-amber-600"><AlertTriangle size={12} /> No record for this deployment</p>
              {data?.deployed ? (
                <>
                  <p className="text-[11px]"><span className="text-muted-foreground">The target is at</span> <span className="font-mono">{short(data.deployed.lastDeployedCommit)}</span></p>
                  <p className="text-[11px] text-muted-foreground">Deployed {fmt(data.deployed.at)}{data.deployed.summary ? ` · ${data.deployed.summary}` : ''}</p>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">This target has no deploy state recorded.</p>
              )}
              {data?.approval && (
                <p className="text-[11px] text-muted-foreground">Approved by {data.approval.approver} · {fmt(data.approval.approved_at)}{data.approval.note ? ` — ${data.approval.note}` : ''}</p>
              )}
              <p className="text-[11px] text-muted-foreground pt-1">
                This deploy happened before the IDE kept reports. Only the commit, time and summary were kept; what shipped and how the checks fared were not recorded.
              </p>
            </div>
          )}

          {rec && (
            <>
              <div className={cn('border rounded-md p-3 space-y-1', outcome?.className ?? 'border-border')}>
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  {rec.outcome === 'ok' || rec.outcome === 'restored'
                    ? <CheckCircle2 size={13} />
                    : rec.outcome === 'refused' ? <Ban size={13} /> : <AlertTriangle size={13} />}
                  {outcome?.label ?? rec.outcome}
                </p>
                {rec.error && <p className="text-[11px] leading-relaxed">{rec.error}</p>}
                {rec.outcome === 'ok' && <p className="text-[11px] opacity-90">{rec.target} is at what it was given, and the safety checks passed.</p>}
              </div>

              <div className="border border-border rounded-md p-3 space-y-1">
                <Row k="When">{fmt(rec.finishedAt)}{rec.durationMs != null ? ` · ${(rec.durationMs / 1000).toFixed(1)}s` : ''}</Row>
                {rec.approval?.by && <Row k="Approved by">{rec.approval.by}{rec.approval.at ? ` · ${fmt(rec.approval.at)}` : ''}</Row>}
                {rec.approval?.note && <Row k="Note">{rec.approval.note}</Row>}
                {rec.changeSet?.name && <Row k="Change set">{rec.changeSet.name}</Row>}
                <Row k="Commits"><span className="font-mono">{short(rec.base)}</span> → <span className="font-mono">{short(rec.commit)}</span>{rec.release && rec.release !== rec.commit ? <span className="text-muted-foreground"> (release <span className="font-mono">{short(rec.release)}</span>)</span> : null}</Row>
                {rec.source && <Row k="From">{rec.source}</Row>}
              </div>

              <div className="border border-border rounded-md overflow-hidden">
                <div className="px-3 py-1.5 bg-muted/30 border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                  What shipped ({rec.objects?.length ?? 0})
                </div>
                {(rec.objects?.length ?? 0) === 0
                  ? <p className="px-3 py-2 text-[11px] text-muted-foreground italic">No object list was recorded for this deployment.</p>
                  : rec.objects.map((o, i) => (
                      <div key={i} className="flex items-baseline gap-2 px-3 py-1 text-[11px] border-b border-border/40 last:border-0">
                        <span className="text-muted-foreground w-16 shrink-0">{o.type}</span>
                        <span className="text-foreground">{label(o)}</span>
                      </div>
                    ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="border border-border rounded-md p-3 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Checks</p>
                  {rec.checks
                    ? (rec.checks.error
                        ? <p className="text-[11px] text-red-600">Errored: {rec.checks.error}</p>
                        : <p className={cn('text-[11px]', rec.checks.failed ? 'text-red-600' : 'text-emerald-700')}>
                            {rec.checks.passed} of {rec.checks.total} passed
                          </p>)
                    : <p className="text-[11px] text-muted-foreground italic">Not run</p>}
                  {(rec.checks?.failures ?? []).slice(0, 4).map((f, i) => (
                    <p key={i} className="text-[10px] text-red-600 leading-snug">{f.description}</p>
                  ))}
                </div>
                <div className="border border-border rounded-md p-3 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Drift</p>
                  <p className="text-[11px]">{rec.drift?.before === 'clean' ? 'Clean before the deploy' : rec.drift?.before === 'drifted' ? 'Drifted before the deploy' : 'Not checked'}</p>
                  {(rec.drift?.blocking ?? []).map((e, i) => (
                    <p key={i} className="text-[10px] text-amber-600">{e.status} {e.file}</p>
                  ))}
                  {(rec.drift?.reported ?? []).map((e, i) => (
                    <p key={`r${i}`} className="text-[10px] text-muted-foreground">{e.status} {e.file} <span className="opacity-70">· not blocking</span></p>
                  ))}
                </div>
              </div>

              {rec.loss?.elements > 0 && (
                <div className="border border-amber-600/40 bg-amber-500/5 rounded-md p-3 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold">
                    Elements removed ({rec.loss.elements} in {rec.loss.dimensions} dimension{rec.loss.dimensions === 1 ? '' : 's'})
                  </p>
                  {(rec.elementLoss ?? []).map((l, i) => (
                    <p key={i} className="text-[11px]">
                      {l.dimension}/{l.hierarchy}: <span className="font-semibold">{l.count}</span>
                      {l.sample?.length ? <span className="text-muted-foreground"> — {l.sample.join(', ')}</span> : null}
                    </p>
                  ))}
                </div>
              )}

              {(rec.subsetsViews?.errors?.length ?? 0) > 0 && (
                <div className="border border-amber-600/40 bg-amber-500/5 rounded-md p-3 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">Views and subsets that did not apply</p>
                  {rec.subsetsViews.errors.map((e, i) => (
                    <p key={i} className="text-[11px]">{e.type} {e.name}: <span className="text-muted-foreground">{e.error}</span></p>
                  ))}
                </div>
              )}

              {(rec.incomplete?.length ?? 0) > 0 && (
                <div className="border border-amber-600/40 bg-amber-500/5 rounded-md p-3 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">Not confirmed on the target</p>
                  {rec.incomplete.map((x, i) => <p key={i} className="text-[11px]">{x}</p>)}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground">A record of what happened. Nothing here changes {target ?? 'the target'}.</span>
          <div className="flex-1" />
          <button onClick={closeDeployReport} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">Close</button>
        </div>
      </div>
    </div>
  )
}
