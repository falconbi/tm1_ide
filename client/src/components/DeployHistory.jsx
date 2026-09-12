import { useState, Fragment } from 'react'
import { useDeployArchives } from '@/hooks/useApi'
import { Loader2, ChevronDown, ChevronRight, CheckCircle2, XCircle, UserCheck, ArrowRight, Diff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

function snapshotText(obj, type) {
  if (!obj) return '(not on target)'
  if (obj.error) return `Error: ${obj.error}`
  switch (type) {
    case 'rules':     return obj.rules ?? ''
    case 'process':   return [
      `#Prolog\n${obj.PrologProcedure ?? ''}`,
      `#Metadata\n${obj.MetadataProcedure ?? ''}`,
      `#Data\n${obj.DataProcedure ?? ''}`,
      `#Epilog\n${obj.EpilogProcedure ?? ''}`,
    ].join('\n\n')
    case 'subset':    return obj.expression ?? (obj.elements ?? []).join('\n')
    case 'view':          return obj.MDX ?? JSON.stringify(obj.axes ?? {}, null, 2)
    case 'dimension':     return [
      `Elements (${obj.elementCount ?? '?'}): ${(obj.elements ?? []).join(', ')}`,
      `Edges (${obj.edgeCount ?? '?'}): ${(obj.edges ?? []).join(', ')}`,
    ].join('\n')
    case 'attribute':     return `${obj.Name}: ${obj.Type}`
    case 'picklist-cube': return Object.entries(obj.cells ?? {}).map(([k, v]) => `${k} = ${v}`).join('\n')
    default:          return JSON.stringify(obj, null, 2)
  }
}

const DIFFABLE = new Set(['rules', 'process', 'subset', 'view', 'picklist-cube', 'dimension'])

function mergeKey(o) {
  return `${o.type}::${o.name}${o.detail ? `::${o.detail}` : ''}`
}

// Merge Package Contents (manifest.objects), Deploy Results, and the Target
// State pre/post snapshot into one row per object -- packaged / deployed /
// verified read together instead of three separate lists you cross-reference
// by eye.
function mergeArchiveRows(data) {
  const manifestObjs = data?.manifest?.objects ?? []
  const deployResults = data?.deploy?.results ?? []
  const pre  = data?.preSnapshot?.objects  ?? {}
  const post = data?.postSnapshot?.objects ?? {}
  const snapshotAvailable = !!(data?.preSnapshot && data?.postSnapshot)

  const rows = new Map()
  const row = (key, seed) => { let r = rows.get(key); if (!r) { r = seed; rows.set(key, r) } return r }

  for (const o of manifestObjs) {
    const r = row(mergeKey(o), { key: mergeKey(o), type: o.type, name: o.name, detail: o.detail })
    r.packaged = true
    r.change = o.change
    r.outcome = o.outcome
    r.elementDelta = o.elementDelta
  }
  for (const d of deployResults) {
    const r = row(mergeKey(d), { key: mergeKey(d), type: d.type, name: d.name, detail: d.detail })
    r.deployed = true
    r.deployOk = d.ok
    r.deployError = d.error
  }
  if (snapshotAvailable) {
    for (const key of new Set([...Object.keys(pre), ...Object.keys(post)])) {
      const [type, name, detail] = key.split('::')
      const r = row(key, { key, type, name, detail })
      const beforeText = snapshotText(pre[key],  type)
      const afterText  = snapshotText(post[key], type)
      const changed = beforeText !== afterText
      r.verified = true
      r.verifyState = !pre[key] ? 'created' : !post[key] ? 'removed' : changed ? 'changed' : 'unchanged'
      r.canDiff = DIFFABLE.has(type) && changed
      r.beforeText = beforeText
      r.afterText = afterText
    }
  }
  return {
    rows: [...rows.values()],
    snapshotAvailable,
    target: data?.preSnapshot?.target ?? data?.postSnapshot?.target,
  }
}

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function ArchiveRow({ a, onOpenDiff }) {
  const [open, setOpen] = useState(false)

  const deployed = a.deployStats?.deployed ?? 0
  const failed   = a.deployStats?.failed   ?? 0
  const dryRun   = a.deployStats?.dry_run  ?? false

  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full grid grid-cols-[20px_1fr_140px_100px_80px] items-center px-4 py-2.5 hover:bg-muted/30 text-left transition-colors gap-3"
      >
        {open
          ? <ChevronDown size={11} className="text-muted-foreground shrink-0" />
          : <ChevronRight size={11} className="text-muted-foreground shrink-0" />}

        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-foreground truncate">{a.source}</span>
            <ArrowRight size={10} className="text-muted-foreground shrink-0" />
            <span className="text-foreground truncate">{a.target}</span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{fmt(a.archived_at)}</div>
        </div>

        <div className="text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <UserCheck size={9} className="text-emerald-400" />
            {a.approval?.approver ?? '—'}
          </div>
          <div className="mt-0.5 text-muted-foreground/60">{fmt(a.approval?.approved_at)}</div>
        </div>

        <div className="text-[10px]">
          {dryRun
            ? <span className="text-muted-foreground">Dry run</span>
            : <>
                <span className="text-emerald-400">{deployed} deployed</span>
                {failed > 0 && <span className="text-red-400 ml-1">{failed} failed</span>}
              </>}
        </div>

        <div className="text-[10px] text-muted-foreground text-right">
          {a.deployer}
        </div>
      </button>

      {open && <ArchiveDetail id={a.id} approval={a.approval} deployStats={a.deployStats} onOpenDiff={onOpenDiff} />}
    </div>
  )
}

function ArchiveDetail({ id, approval, deployStats, onOpenDiff }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const storeOpenTab = useStore(s => s.openTab)
  const openTab = onOpenDiff ?? storeOpenTab

  const load = async () => {
    if (data || loading) return
    setLoading(true)
    try {
      const token = localStorage.getItem('tm1-token') ?? ''
      const r = await fetch(`/api/deploy/archives/${encodeURIComponent(id)}`, { headers: { 'x-ide-token': token } })
      setData(r.ok ? await r.json() : null)
      if (!r.ok) setErr('Failed to load archive')
    } catch { setErr('Network error') }
    finally { setLoading(false) }
  }

  if (!data && !loading && !err) load()

  return (
    <div className="px-8 pb-4 flex flex-col gap-4 bg-muted/10">
      {/* Approval block */}
      <div className="flex flex-col gap-1 pt-2">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Approval</div>
        <div className="text-xs flex items-center gap-2">
          <UserCheck size={11} className="text-emerald-400" />
          <span className="font-semibold">{approval?.approver}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{fmt(approval?.approved_at)}</span>
        </div>
        {approval?.notes && (
          <p className="text-[11px] text-muted-foreground italic">"{approval.notes}"</p>
        )}
      </div>

      {/* Merged: packaged / deployed / verified, one row per object */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 size={11} className="animate-spin" /> Loading…
        </div>
      )}
      {err && <div className="text-xs text-red-400">{err}</div>}
      {data && (() => {
        const { rows, snapshotAvailable, target } = mergeArchiveRows(data)
        if (!rows.length) return null
        const GRID = 'grid-cols-[54px_1fr_64px_84px_84px_84px_28px]'
        return (
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Objects</div>
            <div className="text-[10px] text-muted-foreground/60 mb-1.5">
              {snapshotAvailable
                ? <>Verified column captured from <span className="font-mono">{target}</span> before and after deploy</>
                : <span className="italic">Verified unavailable for this deploy — pre/post snapshot capture did not complete</span>}
            </div>
            <div className="border border-border rounded overflow-hidden">
              <div className={cn('grid text-[10px] font-medium text-muted-foreground bg-muted/30 px-3 py-1.5 border-b border-border', GRID)}>
                <span>TYPE</span><span>NAME</span><span>CHANGE</span><span>PACKAGED</span><span>DEPLOYED</span><span>VERIFIED</span><span />
              </div>
              <div className="max-h-[320px] overflow-auto">
                {rows.map(r => {
                  const delta    = r.type === 'dimension' ? r.elementDelta : null
                  const hasChips = !!(delta && (delta.added.length || delta.removed.length))
                  const MAX = 20
                  return (
                    <Fragment key={r.key}>
                      <div className={cn('grid items-center px-3 py-1 text-[10px] hover:bg-muted/20', GRID, !hasChips && 'border-b border-border/40')}>
                        <span className="text-muted-foreground">{r.type}</span>
                        {/* detail means "parent dimension/cube" for subset/view/attribute rows,
                            but for a dimension row it's a change-log leftover (how many elements/
                            edges that ONE logged write touched) -- not the real delta, which the
                            chips below already show. Not meaningful to display, so suppressed here. */}
                        <span className="font-mono truncate pr-2">{r.name}{r.detail && r.type !== 'dimension' ? ` [${r.detail}]` : ''}</span>
                        <span className={cn(
                          r.change === 'owns'     && 'text-blue-400',
                          r.change === 'modifies' && 'text-emerald-400',
                          r.change === 'ref'      && 'text-muted-foreground',
                        )}>{r.change ?? '—'}</span>
                        <span className="text-muted-foreground truncate" title={r.packaged ? r.outcome : undefined}>
                          {r.packaged ? r.outcome : '—'}
                        </span>
                        <span className={cn('flex items-center gap-1 truncate', r.deployed && !r.deployOk && 'text-red-400')} title={r.deployError}>
                          {r.deployed == null ? '—' : r.deployOk
                            ? <><CheckCircle2 size={9} className="text-emerald-400 shrink-0" /> deployed</>
                            : <><XCircle size={9} className="text-red-400 shrink-0" /> failed</>}
                        </span>
                        <span className={cn(
                          !snapshotAvailable || r.verified == null ? 'text-muted-foreground' :
                          r.verifyState === 'unchanged' ? 'text-emerald-400' : 'text-amber-400 font-medium',
                        )}>
                          {!snapshotAvailable || r.verified == null ? '—' : r.verifyState}
                        </span>
                        {r.canDiff ? (
                          <button
                            onClick={() => openTab({
                              id:     `snap-diff:${id}:${r.key}`,
                              type:   'diff',
                              label:  `Δ ${r.name}`,
                              server: data.source,
                              before: r.beforeText,
                              after:  r.afterText,
                            })}
                            className="flex items-center justify-center text-emerald-400 hover:text-emerald-300"
                            title="View diff"
                          >
                            <Diff size={10} />
                          </button>
                        ) : <span />}
                      </div>
                      {hasChips && (
                        <div className="px-4 pb-1.5 pt-0.5 flex flex-wrap gap-1 border-b border-border/40">
                          {delta.added.slice(0, MAX).map(n => (
                            <span key={n} className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded font-mono">+{n}</span>
                          ))}
                          {delta.added.length > MAX && (
                            <span className="text-[9px] text-emerald-400/60 px-1 py-0.5">+{delta.added.length - MAX} more</span>
                          )}
                          {delta.removed.slice(0, MAX).map(n => (
                            <span key={n} className="text-[9px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded font-mono">-{n}</span>
                          ))}
                          {delta.removed.length > MAX && (
                            <span className="text-[9px] text-red-400/60 px-1 py-0.5">+{delta.removed.length - MAX} more</span>
                          )}
                        </div>
                      )}
                    </Fragment>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default function DeployHistory({ onOpenDiff }) {
  const { data: archives, isLoading, error } = useDeployArchives()

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-border shrink-0">
        <div className="text-sm font-semibold">Deploy History</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">All approved deployments — permanent record</div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
            <Loader2 size={14} className="animate-spin" /> Loading archives…
          </div>
        )}
        {error && (
          <div className="text-sm text-red-400 py-8 text-center">{error.message}</div>
        )}
        {archives && archives.length === 0 && (
          <div className="text-sm text-muted-foreground py-12 text-center">No deploy archives yet.</div>
        )}
        {archives && archives.length > 0 && (
          <div className="border border-border rounded m-4 overflow-hidden">
            <div className="grid grid-cols-[20px_1fr_140px_100px_80px] text-[10px] font-medium text-muted-foreground bg-muted/30 px-4 py-1.5 border-b border-border gap-3">
              <span />
              <span>SOURCE → TARGET</span>
              <span>APPROVED BY</span>
              <span>RESULT</span>
              <span className="text-right">DEPLOYER</span>
            </div>
            {archives.map(a => <ArchiveRow key={a.id} a={a} onOpenDiff={onOpenDiff} />)}
          </div>
        )}
      </div>
    </div>
  )
}
