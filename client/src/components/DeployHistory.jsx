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
    case 'dimension':     return `Elements: ${obj.elementCount ?? '?'}\nEdges: ${obj.edgeCount ?? '?'}`
    case 'attribute':     return `${obj.Name}: ${obj.Type}`
    case 'picklist-cube': return Object.entries(obj.cells ?? {}).map(([k, v]) => `${k} = ${v}`).join('\n')
    default:          return JSON.stringify(obj, null, 2)
  }
}

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function ArchiveRow({ a }) {
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

      {open && <ArchiveDetail id={a.id} approval={a.approval} deployStats={a.deployStats} />}
    </div>
  )
}

function ArchiveDetail({ id, approval, deployStats }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const openTab = useStore(s => s.openTab)

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

      {/* Manifest */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 size={11} className="animate-spin" /> Loading…
        </div>
      )}
      {err && <div className="text-xs text-red-400">{err}</div>}
      {data?.manifest && (
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Package Contents</div>
          <div className="border border-border rounded overflow-hidden">
            <div className="grid grid-cols-[70px_70px_1fr_100px] text-[10px] font-medium text-muted-foreground bg-muted/30 px-3 py-1.5 border-b border-border">
              <span>CHANGE</span><span>TYPE</span><span>NAME</span><span>OUTCOME</span>
            </div>
            <div className="max-h-[240px] overflow-auto">
              {(data.manifest.objects ?? []).map((o, i) => {
                const delta    = o.type === 'dimension' ? o.elementDelta : null
                const hasChips = delta && (delta.added.length || delta.removed.length)
                const MAX = 20
                return (
                  <Fragment key={i}>
                    <div className={cn('grid grid-cols-[70px_70px_1fr_100px] px-3 py-1 text-[10px] hover:bg-muted/20', !hasChips && 'border-b border-border/40')}>
                      <span className={cn(
                        o.change === 'owns'     && 'text-blue-400',
                        o.change === 'modifies' && 'text-emerald-400',
                        o.change === 'ref'      && 'text-muted-foreground',
                      )}>{o.change ?? '—'}</span>
                      <span className="text-muted-foreground">{o.type}</span>
                      <span className="font-mono truncate pr-2">{o.name}{o.detail ? ` [${o.detail}]` : ''}</span>
                      <span className="text-muted-foreground">{o.outcome}</span>
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
      )}

      {/* Deploy results */}
      {data?.deploy?.results && (
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Deploy Results</div>
          <div className="border border-border rounded overflow-hidden">
            <div className="max-h-[200px] overflow-auto">
              {data.deploy.results.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-1 border-b border-border/40 last:border-0 text-[10px] hover:bg-muted/20">
                  {r.ok
                    ? <CheckCircle2 size={9} className="text-emerald-400 shrink-0" />
                    : <XCircle      size={9} className="text-red-400 shrink-0" />}
                  <span className="text-muted-foreground w-14 shrink-0">{r.type}</span>
                  <span className="font-mono flex-1 truncate">{r.name}{r.detail ? ` [${r.detail}]` : ''}</span>
                  {!r.ok && <span className="text-red-400/70 truncate">{r.error}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Pre/Post snapshot diff */}
      {data?.preSnapshot && data?.postSnapshot && (() => {
        const pre  = data.preSnapshot.objects  ?? {}
        const post = data.postSnapshot.objects ?? {}
        const DIFFABLE = new Set(['rules', 'process', 'subset', 'view', 'picklist-cube'])
        const keys = [...new Set([...Object.keys(pre), ...Object.keys(post)])]
        if (!keys.length) return null
        return (
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Target State — Pre/Post
            </div>
            <div className="text-[10px] text-muted-foreground/60 mb-1.5">
              Captured from <span className="font-mono">{data.preSnapshot.target}</span> before and after deploy
            </div>
            <div className="border border-border rounded overflow-hidden">
              <div className="grid grid-cols-[70px_1fr_80px_28px] text-[10px] font-medium text-muted-foreground bg-muted/30 px-3 py-1.5 border-b border-border">
                <span>TYPE</span><span>NAME</span><span>CHANGE</span><span />
              </div>
              <div className="max-h-[240px] overflow-auto">
                {keys.map((key, i) => {
                  const [type, name, detail] = key.split('::')
                  const beforeText = snapshotText(pre[key],  type)
                  const afterText  = snapshotText(post[key], type)
                  const changed    = beforeText !== afterText
                  const canDiff    = DIFFABLE.has(type)
                  const label      = name + (detail ? ` [${detail}]` : '')
                  return (
                    <div key={i} className="grid grid-cols-[70px_1fr_80px_28px] px-3 py-1.5 border-b border-border/40 last:border-0 text-[10px] hover:bg-muted/20 items-center group">
                      <span className="text-muted-foreground">{type}</span>
                      <span className="font-mono truncate pr-2">{label}</span>
                      <span className={changed ? 'text-amber-400 font-medium' : 'text-emerald-400'}>
                        {!pre[key] ? 'created' : !post[key] ? 'removed' : changed ? 'changed' : 'unchanged'}
                      </span>
                      {canDiff && changed ? (
                        <button
                          onClick={() => openTab({
                            id:     `snap-diff:${id}:${key}`,
                            type:   'diff',
                            label:  `Δ ${name}`,
                            server: data.source,
                            before: beforeText,
                            after:  afterText,
                          })}
                          className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          title="View diff"
                        >
                          <Diff size={10} className="text-emerald-500/70 hover:text-emerald-400" />
                        </button>
                      ) : <span />}
                    </div>
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

export default function DeployHistory() {
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
            {archives.map(a => <ArchiveRow key={a.id} a={a} />)}
          </div>
        )}
      </div>
    </div>
  )
}
