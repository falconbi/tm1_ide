import { useState } from 'react'
import { useDeployArchives } from '@/hooks/useApi'
import { Loader2, ChevronDown, ChevronRight, CheckCircle2, XCircle, UserCheck, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

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
              {(data.manifest.objects ?? []).map((o, i) => (
                <div key={i} className="grid grid-cols-[70px_70px_1fr_100px] px-3 py-1 border-b border-border/40 last:border-0 text-[10px] hover:bg-muted/20">
                  <span className={cn(
                    o.change === 'owns'     && 'text-blue-400',
                    o.change === 'modifies' && 'text-emerald-400',
                    o.change === 'ref'      && 'text-muted-foreground',
                  )}>{o.change ?? '—'}</span>
                  <span className="text-muted-foreground">{o.type}</span>
                  <span className="font-mono truncate pr-2">{o.name}{o.detail ? ` [${o.detail}]` : ''}</span>
                  <span className="text-muted-foreground">{o.outcome}</span>
                </div>
              ))}
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
