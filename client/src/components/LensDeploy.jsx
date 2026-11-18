import { useState } from 'react'
import {
  ArrowLeft, ArrowRight, CheckCircle2, XCircle, AlertTriangle, Loader2,
  Lock, FileCode2, Trash2, ShieldCheck, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  useServers, useLensDeployPlan, useLensDeployHistory,
  useApproveLensDeploy, useExecuteLensDeploy,
} from '@/hooks/useApi'

const STEPS = ['Compare', 'Review', 'Approve', 'Deploy', 'Verify']

const actionStyle = {
  new: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  changed: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  same: 'bg-muted text-muted-foreground border-border',
  draft: 'bg-muted text-muted-foreground/60 border-border',
}

const actionLabel = { new: 'New', changed: 'Changed', same: 'Same', draft: 'Draft' }

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const shortHash = hash => (hash ? hash.slice(0, 10) : '—')

function StepBar({ step }) {
  return (
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <span className={cn('px-1.5 py-0.5 rounded',
            i === step ? 'bg-primary text-primary-foreground font-semibold'
              : i < step ? 'text-emerald-500' : 'text-muted-foreground/50')}>
            {i + 1}. {label}
          </span>
          {i < STEPS.length - 1 && <span className="text-muted-foreground/30">›</span>}
        </div>
      ))}
    </div>
  )
}

function LensRow({ entry, showHash = true }) {
  const disabled = entry.action === 'draft' || entry.action === 'same'
  return (
    <div className={cn('px-3 py-2 border-b border-border/60 last:border-0', disabled && 'opacity-60')}>
      <div className="flex items-center gap-2 text-xs">
        <span className={cn('px-1.5 py-0.5 rounded border text-[10px] font-medium shrink-0', actionStyle[entry.action])}>
          {actionLabel[entry.action] ?? entry.action}
        </span>
        <span className="font-medium truncate">{entry.title}</span>
        <span className="text-muted-foreground/70 font-mono text-[10px] truncate">{entry.name}</span>
        {showHash && <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono shrink-0">{shortHash(entry.sourceHash)}</span>}
      </div>
      {entry.action === 'draft' && (
        <p className="text-[10px] text-muted-foreground mt-0.5">Draft — publish it on the source before it can ship.</p>
      )}
      {entry.blockers?.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {entry.blockers.map((b, i) => (
            <p key={i} className="text-[10px] text-red-500 flex items-start gap-1">
              <AlertTriangle size={9} className="mt-0.5 shrink-0" /> {b.message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryPanel({ target }) {
  const { data, isLoading } = useLensDeployHistory(target)
  const history = [...(data?.history ?? [])].reverse().slice(0, 6)
  if (!target) return null
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold flex items-center gap-1.5">
        <RefreshCw size={11} className="text-muted-foreground" /> Lens deploy history on {target}
      </div>
      {isLoading && <div className="p-3 text-xs text-muted-foreground flex items-center gap-2"><Loader2 size={11} className="animate-spin" /> Loading…</div>}
      {!isLoading && !history.length && <p className="p-3 text-xs text-muted-foreground">No Lens deploys recorded on this target yet.</p>}
      {history.map(h => {
        const ok = h.entries?.filter(e => e.ok).length ?? 0
        const bad = h.entries?.filter(e => !e.ok).length ?? 0
        return (
          <div key={`${h.approvalId}-${h.at}`} className="px-3 py-2 border-b border-border/60 last:border-0 text-[11px] flex items-center gap-2">
            {h.ok ? <CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> : <XCircle size={11} className="text-red-500 shrink-0" />}
            <span className="text-muted-foreground">{fmt(h.at)}</span>
            <span className="font-mono text-foreground truncate">{h.source} → {h.target}</span>
            <span className="text-muted-foreground/70">{h.by}</span>
            <span className="ml-auto text-muted-foreground shrink-0">
              {ok} shipped{bad ? ` · ${bad} failed` : ''}{h.deletes?.length ? ` · ${h.deletes.length} deleted` : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function LensDeploy({ source }) {
  const { data: servers } = useServers()
  const serverList = (servers?.value ?? servers ?? []).map(s => s.name ?? s).filter(Boolean)
  const [target, setTarget] = useState('')
  const [step, setStep] = useState(0)
  const [comparing, setComparing] = useState(false)
  const [note, setNote] = useState('')
  const [delSel, setDelSel] = useState({})
  const [approval, setApproval] = useState(null)
  const [result, setResult] = useState(null)

  const { data: plan, isLoading, error } = useLensDeployPlan(source, target, comparing)
  const approve = useApproveLensDeploy()
  const execute = useExecuteLensDeploy()

  const selectedDeletes = Object.keys(delSel).filter(k => delSel[k])
  const canApprove = !!plan && plan.ok && (plan.deployable.length > 0 || selectedDeletes.length > 0) && !approve.isPending

  const reset = () => {
    setStep(0)
    setComparing(false)
    setTarget('')
    setNote('')
    setDelSel({})
    setApproval(null)
    setResult(null)
  }

  const compare = () => {
    if (!target) return
    setStep(1)
    setComparing(true)
    setApproval(null)
    setResult(null)
    setDelSel({})
  }

  const doApprove = async () => {
    try {
      const rec = await approve.mutateAsync({
        source, target, note,
        entries: plan.deployable,
        deletes: selectedDeletes,
        planHash: plan.planHash,
      })
      setApproval(rec)
      setStep(3)
      toast.success('Approved — the exact source hashes are recorded on the target')
    } catch (e) { toast.error(e.message ?? 'Approval failed') }
  }

  const doExecute = async () => {
    try {
      const r = await execute.mutateAsync({ source, target, approvalId: approval?.id })
      setResult(r)
      setStep(4)
      if (r.ok) toast.success(`Lens deploy finished — ${r.entries.filter(e => e.ok).length} shipped`)
      else toast.error('Lens deploy finished with failures — see the results')
    } catch (e) { toast.error(e.message ?? 'Deploy failed') }
  }

  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <FileCode2 size={16} className="text-emerald-500" />
          <div>
            <h2 className="text-sm font-semibold">Deploy → Lenses</h2>
            <p className="text-xs text-muted-foreground">
              Ship model-owned Lenses from the source to a target. No Git, no change set — TM1 admin only, approved by exact content hash.
            </p>
          </div>
          <div className="ml-auto"><StepBar step={step} /></div>
        </div>

        {step === 0 && (
          <>
            <div className="border border-border rounded-lg p-4 flex flex-col gap-3">
              <label className="text-xs font-semibold">Target server</label>
              <select
                value={target}
                onChange={e => { setTarget(e.target.value); setComparing(false); setDelSel({}) }}
                className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select target…</option>
                {serverList.filter(s => s !== source).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono text-foreground">{source}</span>
                <ArrowRight size={11} />
                <span className="font-mono text-foreground">{target || 'target'}</span>
              </div>
              <button
                disabled={!target}
                onClick={compare}
                className="self-start px-3 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                Compare source and target
              </button>
            </div>
            <HistoryPanel target={target} />
          </>
        )}

        {step === 1 && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={() => { setStep(0); setComparing(false) }} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <ArrowLeft size={11} /> Back
              </button>
              <span className="text-xs text-muted-foreground">Review what would ship to <span className="font-mono text-foreground">{target}</span></span>
            </div>

            {isLoading && <div className="p-4 text-xs text-muted-foreground flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Comparing Lenses…</div>}
            {error && <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-500">{error.message}</div>}

            {plan && !isLoading && (
              <>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-500">{plan.counts.new} new</span>
                  <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-500">{plan.counts.changed} changed</span>
                  <span className="px-2 py-1 rounded bg-muted text-muted-foreground">{plan.counts.same} same</span>
                  <span className="px-2 py-1 rounded bg-muted text-muted-foreground">{plan.counts.drafts} draft{plan.counts.drafts === 1 ? '' : 's'}</span>
                  <span className="px-2 py-1 rounded bg-muted text-muted-foreground">{plan.counts.targetOnly} target-only</span>
                  {plan.counts.blockers > 0 && <span className="px-2 py-1 rounded bg-red-500/10 text-red-500">{plan.counts.blockers} blocker{plan.counts.blockers === 1 ? '' : 's'}</span>}
                </div>

                {plan.blockers.length > 0 && (
                  <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-xs text-red-500 flex items-start gap-2">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold mb-1">This plan cannot be approved until the target has these objects.</p>
                      {plan.blockers.map((b, i) => <p key={i}>{b.lens} {b.message}</p>)}
                    </div>
                  </div>
                )}

                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold">
                    Source Lenses {plan.deployable.length > 0 && <span className="font-normal text-muted-foreground">— {plan.deployable.length} will ship (all published new/changed)</span>}
                  </div>
                  {plan.entries.length === 0 && <p className="p-3 text-xs text-muted-foreground">No Lenses on {source}.</p>}
                  {plan.entries.map(e => <LensRow key={e.name} entry={e} />)}
                </div>

                {plan.targetOnly.length > 0 && (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold flex items-center gap-1.5">
                      <Trash2 size={11} className="text-muted-foreground" /> Target-only Lenses
                      <span className="font-normal text-muted-foreground">— off by default; tick any to delete on the target</span>
                    </div>
                    {plan.targetOnly.map(t => (
                      <label key={t.name} className="flex items-center gap-2 px-3 py-2 border-b border-border/60 last:border-0 text-xs cursor-pointer hover:bg-muted/20">
                        <input
                          type="checkbox"
                          checked={!!delSel[t.name]}
                          onChange={e => setDelSel(s => ({ ...s, [t.name]: e.target.checked }))}
                          className="accent-red-600"
                        />
                        <span className="font-medium">{t.title}</span>
                        <span className="text-muted-foreground/70 font-mono text-[10px]">{t.name}</span>
                        <span className={cn('ml-auto px-1.5 py-0.5 rounded border text-[10px]', actionStyle[t.status === 'published' ? 'same' : 'draft'])}>{t.status}</span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    disabled={!canApprove}
                    onClick={() => setStep(2)}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                  >
                    Continue to approve
                  </button>
                  {!plan.ok && <span className="text-[11px] text-red-500">Fix the blockers on the target first.</span>}
                  {plan.ok && plan.deployable.length === 0 && selectedDeletes.length === 0 && <span className="text-[11px] text-muted-foreground">Nothing to ship or delete.</span>}
                </div>
              </>
            )}
          </>
        )}

        {step === 2 && plan && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={() => setStep(1)} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <ArrowLeft size={11} /> Back
              </button>
              <span className="text-xs text-muted-foreground">Approve this exact source content for <span className="font-mono text-foreground">{target}</span></span>
            </div>
            <div className="border border-border rounded-lg p-4 flex flex-col gap-3">
              <div className="text-xs flex items-center gap-2">
                <ShieldCheck size={14} className="text-emerald-500" />
                <span className="font-semibold">{plan.deployable.length} Lens{plan.deployable.length === 1 ? '' : 'es'} to ship</span>
                {selectedDeletes.length > 0 && <span className="text-red-500">· {selectedDeletes.length} to delete</span>}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground break-all bg-muted/40 rounded px-2 py-1.5">
                plan hash {plan.planHash}
              </div>
              <p className="text-[11px] text-muted-foreground">
                The approval is bound to this hash. If any source Lens changes after approval, the deploy refuses and you must compare again.
              </p>
              <label className="text-xs font-semibold">Note (optional)</label>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Why these Lenses are shipping"
                className="w-full bg-muted border border-border rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                disabled={!canApprove}
                onClick={doApprove}
                className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors"
              >
                {approve.isPending ? <><Loader2 size={12} className="animate-spin" /> Recording…</> : <><ShieldCheck size={12} /> Approve deploy</>}
              </button>
            </div>
          </>
        )}

        {step === 3 && approval && (
          <>
            <div className="border border-border rounded-lg p-4 flex flex-col gap-3">
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-500" /> Approved by {approval.approver} · {fmt(approval.approved_at)}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Deploying takes the target's deploy lock, saves {approval.entries.length} Lens{approval.entries.length === 1 ? '' : 'es'}
                {approval.deletes.length ? `, deletes ${approval.deletes.length} target-only Lens${approval.deletes.length === 1 ? '' : 'es'}` : ''},
                then reads every saved Lens back to verify its content hash.
              </p>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Lock size={11} /> One deploy per target at a time — a concurrent deploy is refused.
              </div>
              <button
                disabled={execute.isPending}
                onClick={doExecute}
                className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors"
              >
                {execute.isPending ? <><Loader2 size={12} className="animate-spin" /> Deploying…</> : <><ArrowRight size={12} /> Deploy to {target}</>}
              </button>
            </div>
          </>
        )}

        {step === 4 && result && (
          <>
            <div className={cn('p-3 rounded border text-xs flex items-start gap-2',
              result.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-red-500/30 bg-red-500/10 text-red-500')}>
              {result.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
              <div>
                <p className="font-semibold">{result.ok ? 'Verified — the target matches the approved source' : 'Deploy finished with failures'}</p>
                <p className="opacity-80">{result.source} → {result.target} · {result.by} · {fmt(result.at)}</p>
                {result.errors?.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            </div>

            <div className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold">Per-Lens result</div>
              {result.entries.map(e => (
                <div key={e.name} className="px-3 py-2 border-b border-border/60 last:border-0 text-xs flex items-center gap-2">
                  {e.verified ? <CheckCircle2 size={12} className="text-emerald-500 shrink-0" /> : <XCircle size={12} className="text-red-500 shrink-0" />}
                  <span className="font-medium">{e.name}</span>
                  <span className="text-muted-foreground">{e.action}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">{e.error ?? shortHash(e.hash)}</span>
                </div>
              ))}
              {result.deletes.map(d => (
                <div key={`del-${d.name}`} className="px-3 py-2 border-b border-border/60 last:border-0 text-xs flex items-center gap-2">
                  {d.ok ? <CheckCircle2 size={12} className="text-emerald-500 shrink-0" /> : <XCircle size={12} className="text-red-500 shrink-0" />}
                  <Trash2 size={11} className="text-muted-foreground" />
                  <span className="font-medium">{d.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{d.ok ? 'deleted' : d.error}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button onClick={reset} className="px-3 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                Deploy another plan
              </button>
              <span className="text-[11px] text-muted-foreground">Recorded in the target model under Applications/Governance/LensDeploys.</span>
            </div>

            <HistoryPanel target={target} />
          </>
        )}
      </div>
    </div>
  )
}
