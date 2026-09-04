import { useState, useEffect, Fragment } from 'react'
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Info,
         ChevronRight, ChevronDown, Package, Rocket, ShieldCheck, ArrowRight, RefreshCw } from 'lucide-react'
import { useServers, useDeployDiff, useDeployPackage, useDeployDriftCheck,
         useDeployRisk, useDeployExecute, useDeployApprove,
         useDeployScopedSnapshot, useDeployArchive } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

// ── Constants ─────────────────────────────────────────────────────────────────

const OUTCOME = {
  MATCH:     { label: 'Modified',  cls: 'text-emerald-400',       dot: 'bg-emerald-400',       packable: true  },
  NEW:       { label: 'New',       cls: 'text-blue-400',          dot: 'bg-blue-400',          packable: true  },
  DRIFT:     { label: 'Drift',     cls: 'text-amber-400',         dot: 'bg-amber-400',         packable: true  },
  UNCHANGED: { label: 'Unchanged', cls: 'text-muted-foreground',  dot: 'bg-muted-foreground',  packable: false },
  MISSING:   { label: 'Missing',   cls: 'text-red-400',           dot: 'bg-red-400',           packable: false },
  ERROR:     { label: 'Error',     cls: 'text-red-400',           dot: 'bg-red-400',           packable: false },
}

const RISK_STYLE = {
  BLOCKER: { cls: 'text-red-400',          row: 'bg-red-500/8',   Icon: XCircle,       label: 'BLOCKER' },
  WARNING: { cls: 'text-amber-400',        row: 'bg-amber-500/8', Icon: AlertTriangle, label: 'WARNING' },
  INFO:    { cls: 'text-muted-foreground', row: '',               Icon: Info,          label: 'INFO'    },
}

const DIFFABLE = new Set(['rules', 'process', 'subset', 'view'])

function objKey(o) {
  return `${o.object_type}::${o.object_name}::${o.detail ?? ''}`
}

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return iso }
}

// ── Screen header ─────────────────────────────────────────────────────────────

const SCREENS = [
  { id: 1, label: 'Select',  Icon: Package    },
  { id: 2, label: 'Approve', Icon: ShieldCheck },
  { id: 3, label: 'Deploy',  Icon: Rocket     },
]

function ScreenHeader({ current }) {
  return (
    <div className="flex items-center gap-0 border-b border-border bg-muted/20 px-6 py-3 shrink-0">
      {SCREENS.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div className={cn(
            'flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors',
            current === s.id && 'text-foreground bg-muted',
            current >  s.id && 'text-emerald-400',
            current <  s.id && 'text-muted-foreground/50',
          )}>
            {current > s.id ? <CheckCircle2 size={11} /> : <s.Icon size={11} />}
            {s.label}
          </div>
          {i < SCREENS.length - 1 && (
            <ChevronRight size={12} className="text-muted-foreground/30 mx-1" />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Baseline banner ───────────────────────────────────────────────────────────

function BaselineBanner({ diffData }) {
  if (!diffData) return null
  if (!diffData.has_baseline) {
    return (
      <div className="flex items-start gap-2 px-5 py-2.5 bg-amber-500/8 border-b border-amber-500/20 text-xs text-amber-400 shrink-0">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        <span>
          No baseline seeded — every object shows as <span className="font-medium">New</span> and drift / risk checks are limited.
          Seed one from your production server first:
          <span className="font-mono text-amber-300/90 ml-1">tm1deploy seed --server &lt;prod&gt;</span>
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 px-5 py-2 border-b border-border/50 text-[11px] text-muted-foreground shrink-0">
      <Info size={11} className="shrink-0" />
      Baseline: <span className="text-foreground">{diffData.baseline_server ?? 'unknown'}</span>
      seeded {fmtDate(diffData.baseline_seeded_at)}
    </div>
  )
}

// ── Screen 1: Select objects ──────────────────────────────────────────────────

function DeltaLine({ o }) {
  if (o.elementDelta) {
    const { added = [], removed = [] } = o.elementDelta
    const trunc = arr => arr.slice(0, 6).join(', ') + (arr.length > 6 ? `, +${arr.length - 6} more` : '')
    return (
      <div className="text-[11px] text-muted-foreground/80 mt-0.5 space-x-2">
        {added.length   > 0 && <span className="text-emerald-400/80">+{added.length}: {trunc(added)}</span>}
        {removed.length > 0 && <span className="text-red-400/80">−{removed.length}: {trunc(removed)}</span>}
      </div>
    )
  }
  if (o.note) return <div className="text-[11px] text-muted-foreground/80 mt-0.5">{o.note}</div>
  return null
}

function Screen1({ diffData, diffRunning, diffError, selected, setSelected, server, openTab, onPrepare, packaging }) {
  const groups = diffData ? [
    { key: 'packable',    label: 'To deploy', items: [
      ...(diffData.match ?? []).map(o => ({ ...o, outcome: 'MATCH' })),
      ...(diffData.new   ?? []).map(o => ({ ...o, outcome: 'NEW'   })),
      ...(diffData.drift ?? []).map(o => ({ ...o, outcome: 'DRIFT' })),
    ]},
    { key: 'nonpackable', label: "Won't deploy", items: [
      ...(diffData.unchanged ?? []).map(o => ({ ...o, outcome: 'UNCHANGED' })),
      ...(diffData.missing   ?? []).map(o => ({ ...o, outcome: 'MISSING'   })),
      ...(diffData.error     ?? []).map(o => ({ ...o, outcome: 'ERROR'     })),
    ]},
  ] : []

  const allItems  = groups.flatMap(g => g.items)
  const packable  = allItems.filter(o => OUTCOME[o.outcome]?.packable)
  const checkable = packable.filter(o => o.outcome !== 'DRIFT')  // MATCH + NEW auto-selectable

  const allChecked = checkable.length > 0 && checkable.every(o => selected.has(objKey(o)))

  const toggleAll = () => {
    const keys = checkable.map(objKey)
    setSelected(prev => {
      const n = new Set(prev)
      if (allChecked) keys.forEach(k => n.delete(k))
      else            keys.forEach(k => n.add(k))
      return n
    })
  }

  const toggle = o => {
    const k = objKey(o)
    setSelected(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }

  const handleRowClick = async o => {
    if (!DIFFABLE.has(o.object_type)) return
    const params = new URLSearchParams({ server, type: o.object_type, name: o.object_name })
    if (o.detail) params.set('detail', o.detail)
    try {
      const data = await fetch(`/api/deploy/object-diff?${params}`, {
        headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' },
      }).then(r => r.json())
      openTab({
        id: `diff:deploy:${o.object_type}:${o.object_name}`,
        type: 'diff', label: `Diff: ${o.object_name}`,
        server, objectType: o.object_type,
        before: data.before, after: data.after,
      })
    } catch (e) { console.error('diff fetch failed', e) }
  }

  if (diffRunning) return (
    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-16">
      <Loader2 size={14} className="animate-spin" /> Comparing session changes…
    </div>
  )

  if (diffError) return (
    <div className="text-sm text-red-400 py-8 text-center">{diffError}</div>
  )

  if (!diffData) return null

  const nSelected = selected.size

  const renderRow = o => {
    const oc = OUTCOME[o.outcome] ?? OUTCOME.ERROR
    const k  = objKey(o)
    const clickable = DIFFABLE.has(o.object_type) && (o.outcome === 'MATCH' || o.outcome === 'DRIFT')
    return (
      <tr key={k} className={cn(
        'border-b border-border/30 transition-colors align-top',
        oc.packable ? 'hover:bg-muted/30' : 'opacity-50',
        o.outcome === 'DRIFT' && 'bg-amber-500/4',
      )}>
        <td className="px-3 py-2">
          {oc.packable && (
            <input type="checkbox" checked={selected.has(k)} onChange={() => toggle(o)}
              className="accent-primary cursor-pointer mt-0.5" />
          )}
        </td>
        <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{o.object_type}</td>
        <td className="px-3 py-2">
          <span
            className={cn('font-medium', clickable && 'cursor-pointer hover:text-primary hover:underline')}
            onClick={() => clickable && handleRowClick(o)}
          >{o.object_name}</span>
          <DeltaLine o={o} />
        </td>
        <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{o.detail ?? ''}</td>
        <td className="px-3 py-2 whitespace-nowrap">
          <span className={cn('inline-flex items-center gap-1.5', oc.cls)}>
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', oc.dot)} />
            {oc.label}
          </span>
        </td>
      </tr>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary chips */}
      <div className="flex items-center gap-4 px-5 py-2.5 border-b border-border/50 text-xs text-muted-foreground shrink-0">
        <span><span className="text-foreground font-medium">{packable.length}</span> to deploy</span>
        {(diffData.drift?.length ?? 0) > 0 && (
          <span className="text-amber-400"><span className="font-medium">{diffData.drift.length}</span> drift</span>
        )}
        {(diffData.unchanged?.length ?? 0) > 0 && (
          <span><span className="font-medium">{diffData.unchanged.length}</span> unchanged</span>
        )}
        {(diffData.missing?.length ?? 0) > 0 && (
          <span className="text-red-400"><span className="font-medium">{diffData.missing.length}</span> missing</span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border/50 z-10">
            <tr className="text-muted-foreground">
              <th className="w-8 px-3 py-2 text-left">
                {checkable.length > 0 && (
                  <input type="checkbox" checked={allChecked} onChange={toggleAll}
                    className="accent-primary cursor-pointer" />
                )}
              </th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Detail</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {allItems.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-muted-foreground py-8">No changes in this session</td></tr>
            ) : groups.filter(g => g.items.length > 0).map(g => (
              <Fragment key={g.key}>
                <tr className="bg-muted/20">
                  <td colSpan={5} className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {g.label} · {g.items.length}
                  </td>
                </tr>
                {g.items.map(renderRow)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/10 shrink-0">
        <span className="text-xs text-muted-foreground">
          {nSelected === 0 ? 'No objects selected'
            : `${nSelected} object${nSelected !== 1 ? 's' : ''} selected`}
        </span>
        <button
          disabled={nSelected === 0 || packaging}
          onClick={onPrepare}
          className={cn(
            'flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium transition-colors',
            nSelected > 0 && !packaging
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {packaging
            ? <><Loader2 size={13} className="animate-spin" /> Building…</>
            : <><Package size={13} /> Prepare {nSelected > 0 ? nSelected : ''} selected <ArrowRight size={13} /></>}
        </button>
      </div>
    </div>
  )
}

// ── Screen 2: Risk & Approve ──────────────────────────────────────────────────

function RiskGroup({ title, items, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!items.length) return null
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {title} · {items.length}
      </button>
      {open && items.map((r, i) => {
        const rs = RISK_STYLE[r.level] ?? RISK_STYLE.INFO
        return (
          <div key={i} className={cn('flex items-start gap-2 rounded px-3 py-2 mb-1 text-xs', rs.row)}>
            <rs.Icon size={11} className={cn('mt-0.5 shrink-0', rs.cls)} />
            <div>
              <span className={cn('font-medium mr-1.5', rs.cls)}>{r.type} {r.name}</span>
              <span className="text-muted-foreground">{r.message}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Screen2({ servers, currentServer, target, setTarget, packageData,
                   riskData, riskRunning, driftData, driftRunning,
                   notes, setNotes, username, onDeploy, deploying, baselineSeededAt }) {
  const otherServers = (servers ?? []).filter(s => s.name !== currentServer)

  const blockers = riskData?.blockers ?? []
  const warnings = riskData?.warnings ?? []
  const infos    = riskData?.infos    ?? []

  const driftSkipped = driftData?.skipped
  const driftedItems = driftData?.drifted ?? []
  const hasDrift     = driftedItems.length > 0

  const objects = packageData?.manifest?.objects ?? []
  const skipped = packageData?.manifest?.skipped ?? []

  const checksReady = !!riskData && !!driftData && !riskRunning && !driftRunning
  const canDeploy   = target && !deploying && checksReady && blockers.length === 0 && !hasDrift

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Package summary */}
      <div className="px-5 py-3 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <span className="text-foreground font-medium">{currentServer}</span>
          <ArrowRight size={12} />
          <span className={cn('font-medium', target ? 'text-foreground' : 'text-muted-foreground/60')}>
            {target || 'select target'}
          </span>
          <span className="ml-auto">{objects.length} object{objects.length !== 1 ? 's' : ''} in package</span>
        </div>
        {objects.length > 0 && (
          <div className="max-h-32 overflow-auto rounded border border-border/50 divide-y divide-border/30">
            {objects.map((o, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1 text-[11px]">
                <span className="font-mono text-muted-foreground w-20 shrink-0">{o.type}</span>
                <span className="font-medium truncate">{o.name}</span>
                {o.detail && <span className="font-mono text-muted-foreground/70 truncate">{o.detail}</span>}
                <span className="ml-auto text-muted-foreground/70">{(o.outcome ?? '').toLowerCase()}</span>
              </div>
            ))}
          </div>
        )}
        {skipped.length > 0 && (
          <p className="text-[11px] text-muted-foreground/70 mt-1.5">{skipped.length} object(s) skipped — see manifest</p>
        )}
      </div>

      {/* Target selector */}
      <div className="px-5 py-4 border-b border-border/50 shrink-0">
        <label className="block text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
          Deploy Target
        </label>
        <select
          value={target}
          onChange={e => setTarget(e.target.value)}
          className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Select target server…</option>
          {otherServers.map(s => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Risk / drift */}
      {target && (
        <div className="px-5 py-4 border-b border-border/50 flex-1">
          {(riskRunning || driftRunning) ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 size={13} className="animate-spin" />
              Checking {driftRunning ? 'target drift' : 'risk'}…
            </div>
          ) : (
            <>
              {driftSkipped && (
                <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Info size={11} /> Drift check skipped — {driftData?.reason ?? 'no baseline'}
                </p>
              )}

              {hasDrift && (
                <div className="mb-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-amber-400 mb-2">
                    Target drift — resolve before deploying
                  </p>
                  {driftedItems.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs bg-amber-500/8 rounded px-3 py-2 mb-1">
                      <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">
                        <span className="font-mono">{d.type}</span>{' '}
                        <span className="text-foreground font-medium">{d.name}</span>
                        {d.detail ? <span className="font-mono text-muted-foreground/70"> ({d.detail})</span> : null}
                        {d.note ? <> — {d.note}</> : <> differs on target since baseline</>}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {(blockers.length + warnings.length + infos.length) > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Risk Analysis</p>
                  <RiskGroup title="Blockers"  items={blockers} defaultOpen />
                  <RiskGroup title="Warnings"  items={warnings} defaultOpen />
                  <RiskGroup title="Info"      items={infos}    defaultOpen={false} />
                </div>
              ) : checksReady && !hasDrift ? (
                <div className="flex items-center gap-2 text-sm text-emerald-400 py-2">
                  <CheckCircle2 size={13} /> No risk items — safe to deploy
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {/* Approver / Notes */}
      <div className="px-5 py-4 border-b border-border/50 space-y-4 shrink-0">
        <div>
          <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wider">Approver</p>
          <p className="text-sm font-medium text-foreground">{username || 'admin'}</p>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Deployment notes…"
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center px-5 py-3 bg-muted/10 gap-3 shrink-0">
        {blockers.length > 0 && (
          <span className="text-xs text-red-400 flex-1">
            {blockers.length} blocker{blockers.length !== 1 ? 's' : ''} must be resolved first
          </span>
        )}
        {!blockers.length && hasDrift && (
          <span className="text-xs text-amber-400 flex-1">Resolve target drift before deploying</span>
        )}
        {!blockers.length && !hasDrift && <span className="flex-1" />}
        <button
          disabled={!canDeploy}
          onClick={onDeploy}
          className={cn(
            'flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium transition-colors',
            canDeploy
              ? 'bg-emerald-700 text-white hover:bg-emerald-600'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {deploying
            ? <><Loader2 size={13} className="animate-spin" /> Deploying…</>
            : <><Rocket size={13} /> Approve &amp; Deploy to {target || '…'} <ArrowRight size={13} /></>}
        </button>
      </div>
    </div>
  )
}

// ── Screen 3: Results ─────────────────────────────────────────────────────────

function Screen3({ deployData, deployRunning, archiving, onReset }) {
  if (deployRunning) return (
    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-16">
      <Loader2 size={14} className="animate-spin" /> Deploying objects…
    </div>
  )

  if (!deployData) return null

  if (deployData.aborted) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <XCircle size={28} className="text-red-400" />
          <p className="text-sm font-medium text-red-400">Deploy aborted</p>
          <p className="text-xs text-muted-foreground max-w-md">{deployData.reason ?? 'Risk check failed'}</p>
        </div>
        <div className="flex justify-end px-5 py-3 border-t border-border bg-muted/10 shrink-0">
          <button onClick={onReset}
            className="flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors">
            <RefreshCw size={13} /> New Deploy
          </button>
        </div>
      </div>
    )
  }

  const results = deployData.results ?? []
  const nOk  = results.filter(r => r.ok).length
  const nErr = results.filter(r => !r.ok).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border/50 shrink-0">
        {nOk > 0 && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-400">
            <CheckCircle2 size={14} /> {nOk} deployed
          </span>
        )}
        {nErr > 0 && (
          <span className="flex items-center gap-1.5 text-sm text-red-400">
            <XCircle size={14} /> {nErr} failed
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {deployData.source_server} <ArrowRight size={10} className="inline" /> {deployData.target_server}
          {' · '}{fmtDate(deployData.deployed_at)}
          {archiving && <> · <Loader2 size={10} className="inline animate-spin" /> archiving</>}
        </span>
      </div>

      {/* Per-object results */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border/50">
            <tr className="text-muted-foreground">
              <th className="w-8 px-4 py-2 text-left"></th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Detail</th>
              <th className="px-4 py-2 text-left font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-b border-border/30">
                <td className="px-4 py-2">
                  {r.ok
                    ? <CheckCircle2 size={13} className="text-emerald-400" />
                    : <XCircle size={13} className="text-red-400" />}
                </td>
                <td className="px-4 py-2 font-mono text-muted-foreground">{r.type}</td>
                <td className="px-4 py-2 font-medium">{r.name}</td>
                <td className="px-4 py-2 font-mono text-muted-foreground">{r.detail ?? ''}</td>
                <td className={cn('px-4 py-2', r.ok ? 'text-muted-foreground' : 'text-red-400')}>
                  {r.ok ? 'deployed' : (r.error ?? 'failed')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex justify-end px-5 py-3 border-t border-border bg-muted/10 shrink-0">
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
        >
          <RefreshCw size={13} /> New Deploy
        </button>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DeployPanel({ tab }) {
  const { openTab }  = useStore()
  const username     = useStore(s => s.username)
  const { session, server } = tab

  const [screen,   setScreen]   = useState(1)
  const [selected, setSelected] = useState(new Set())
  const [target,   setTarget]   = useState('')
  const [notes,    setNotes]    = useState('')

  const { data: servers } = useServers()
  const diffMut     = useDeployDiff()
  const packageMut  = useDeployPackage()
  const driftMut    = useDeployDriftCheck()
  const riskMut     = useDeployRisk()
  const approveMut  = useDeployApprove()
  const deployMut   = useDeployExecute()
  const snapshotMut = useDeployScopedSnapshot()
  const archiveMut  = useDeployArchive()

  // Auto-run diff on mount
  useEffect(() => {
    diffMut.mutate({ server, sessionId: session.id })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-select MATCH + NEW when diff resolves
  useEffect(() => {
    const d = diffMut.data
    if (!d) return
    const keys = new Set()
    ;[...(d.match ?? []), ...(d.new ?? [])].forEach(o => keys.add(objKey(o)))
    setSelected(keys)
  }, [diffMut.data])

  // Auto-run drift + risk when target changes (screen 2)
  useEffect(() => {
    const dir = packageMut.data?.outputDir
    if (screen !== 2 || !target || !dir) return
    driftMut.mutate({ packageDir: dir, target })
    riskMut.mutate({ packageDir: dir, target })
  }, [target, screen]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePrepare() {
    const selectedList = [...selected].map(k => {
      const [object_type, object_name, detail] = k.split('::')
      return { object_type, object_name, detail: detail || undefined }
    })
    try {
      await packageMut.mutateAsync({
        server, sessionId: session.id, sessionName: session.name,
        selectedObjects: selectedList,
        // any selected object that the diff classifies as DRIFT is only packaged
        // if it is also force-included; harmless for non-drift objects
        forceInclude: selectedList,
      })
      setScreen(2)
    } catch { /* packageMut.error shown in banner */ }
  }

  async function handleDeploy() {
    const dir      = packageMut.data?.outputDir
    const manifest = packageMut.data?.manifest
    if (!dir) return
    try {
      // 1. Snapshot the target as it stands, before we touch it (best effort)
      let preSnapshot = null
      try { preSnapshot = await snapshotMut.mutateAsync({ packageDir: dir, target }) } catch { /* non-fatal */ }

      // 2. Record the approval
      const approval = await approveMut.mutateAsync({
        source: server, target, approver: username || 'admin',
        notes, packaged: session.name, session: session.id, packageDir: dir,
      })

      // 3. Deploy
      const deployResult = await deployMut.mutateAsync({ packageDir: dir, target })
      setScreen(3)

      // 4. Snapshot the target again + write the history archive (best effort)
      let postSnapshot = null
      try { postSnapshot = await snapshotMut.mutateAsync({ packageDir: dir, target }) } catch { /* non-fatal */ }
      try {
        await archiveMut.mutateAsync({
          approval, deployResult, manifest,
          source: server, target, deployer: username || 'admin',
          preSnapshot, postSnapshot,
        })
      } catch { /* non-fatal — deploy already happened */ }
    } catch { /* deployMut / approveMut error shown in banner */ }
  }

  function handleReset() {
    setScreen(1)
    setSelected(new Set())
    setTarget('')
    setNotes('')
    packageMut.reset()
    deployMut.reset()
    driftMut.reset()
    riskMut.reset()
    snapshotMut.reset()
    archiveMut.reset()
    diffMut.mutate({ server, sessionId: session.id })
  }

  const anyError = packageMut.error || deployMut.error || approveMut.error

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ScreenHeader current={screen} />

      {screen === 1 && (
        <>
          <BaselineBanner diffData={diffMut.data} />
          <Screen1
            diffData={diffMut.data}
            diffRunning={diffMut.isPending}
            diffError={diffMut.error?.message}
            selected={selected}
            setSelected={setSelected}
            server={server}
            openTab={openTab}
            onPrepare={handlePrepare}
            packaging={packageMut.isPending}
          />
        </>
      )}

      {screen === 2 && (
        <Screen2
          servers={servers}
          currentServer={server}
          target={target}
          setTarget={setTarget}
          packageData={packageMut.data}
          riskData={riskMut.data}
          riskRunning={riskMut.isPending}
          driftData={driftMut.data}
          driftRunning={driftMut.isPending}
          notes={notes}
          setNotes={setNotes}
          username={username}
          onDeploy={handleDeploy}
          deploying={deployMut.isPending || approveMut.isPending || snapshotMut.isPending}
          baselineSeededAt={diffMut.data?.baseline_seeded_at}
        />
      )}

      {screen === 3 && (
        <Screen3
          deployData={deployMut.data}
          deployRunning={deployMut.isPending}
          archiving={snapshotMut.isPending || archiveMut.isPending}
          onReset={handleReset}
        />
      )}

      {anyError && (
        <div className="shrink-0 px-5 py-2 bg-red-500/10 border-t border-red-500/20 text-xs text-red-400">
          {anyError.message}
        </div>
      )}
    </div>
  )
}
