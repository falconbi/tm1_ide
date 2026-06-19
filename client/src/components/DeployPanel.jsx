import { useState, useEffect } from 'react'
import { X, Loader2, ChevronRight, ChevronDown, CheckCircle2, XCircle, AlertTriangle, Info,
         Package, Rocket, ShieldCheck, GitCompare, ArrowRight, Database, Diff, UserCheck, Clock, History } from 'lucide-react'
import { useServers } from '@/hooks/useApi'
import { useDeploySeed, useDeployDiff, useDeployPackage, useDeployRisk, useDeployExecute,
         useDeployApprove, useDeployArchive } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

// ── Helpers ───────────────────────────────────────────────────────────────────

const OUTCOME_STYLE = {
  MATCH:     { label: 'Match',     cls: 'text-emerald-400', dot: 'bg-emerald-400' },
  NEW:       { label: 'New',       cls: 'text-blue-400',    dot: 'bg-blue-400'    },
  UNCHANGED: { label: 'Unchanged', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  DRIFT:     { label: 'Drift',     cls: 'text-amber-400',   dot: 'bg-amber-400'   },
  MISSING:   { label: 'Missing',   cls: 'text-red-400',     dot: 'bg-red-400'     },
  ERROR:     { label: 'Error',     cls: 'text-red-400',     dot: 'bg-red-400'     },
}

const RISK_STYLE = {
  BLOCKER: { cls: 'text-red-400',              row: 'bg-red-500/8',    icon: XCircle,        label: 'BLOCKER' },
  WARNING: { cls: 'text-amber-400',            row: 'bg-amber-500/8',  icon: AlertTriangle,  label: 'WARNING' },
  INFO:    { cls: 'text-muted-foreground',     row: '',                icon: Info,           label: 'INFO'    },
}

const STEPS = [
  { id: 1, label: 'Diff',    icon: GitCompare  },
  { id: 2, label: 'Package', icon: Package     },
  { id: 3, label: 'Risk',    icon: ShieldCheck },
  { id: 4, label: 'Approve', icon: UserCheck   },
  { id: 5, label: 'Deploy',  icon: Rocket      },
]

function StepBar({ step, status }) {
  return (
    <div className="flex items-center gap-0 border-b border-border bg-muted/20 px-6 py-3">
      {STEPS.map((s, i) => {
        const st  = status[s.id]
        const Icon = s.icon
        const isActive  = step === s.id
        const isDone    = st === 'done'
        const isError   = st === 'error'
        const isPending = !isActive && !isDone && !isError

        return (
          <div key={s.id} className="flex items-center">
            <div className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors',
              isActive  && 'text-foreground bg-muted',
              isDone    && 'text-emerald-400',
              isError   && 'text-red-400',
              isPending && 'text-muted-foreground/50',
            )}>
              {st === 'running' ? <Loader2 size={11} className="animate-spin" />
               : isDone         ? <CheckCircle2 size={11} />
               : isError        ? <XCircle size={11} />
               : <Icon size={11} />}
              {s.label}
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight size={12} className="text-muted-foreground/30 mx-1" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1: Diff ──────────────────────────────────────────────────────────────

const DIFFABLE_TYPES = new Set(['rules', 'process', 'subset', 'view'])
const DIFFABLE_OUTCOMES = new Set(['MATCH', 'NEW'])

function StepDiff({ result, error, running, onSeed, seeding, seedResult, server, openTab }) {
  const [loadingDiff, setLoadingDiff] = useState(null)

  const handleRowClick = async (r) => {
    if (!DIFFABLE_OUTCOMES.has(r.outcome) || !DIFFABLE_TYPES.has(r.object_type)) return
    const key = `${r.object_type}:${r.object_name}`
    setLoadingDiff(key)
    try {
      const params = new URLSearchParams({ server, type: r.object_type, name: r.object_name })
      if (r.detail) params.set('detail', r.detail)
      const data = await fetch(`/api/deploy/object-diff?${params}`).then(res => res.json())
      openTab({
        id:         `diff:deploy:${r.object_type}:${r.object_name}`,
        type:       'diff',
        label:      `Diff: ${r.object_name}`,
        server,
        objectType: r.object_type,
        before:     data.before,
        after:      data.after,
      })
    } catch (e) {
      console.error('diff fetch failed', e)
    } finally {
      setLoadingDiff(null)
    }
  }

  if (running) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
      <Loader2 size={14} className="animate-spin" /> Comparing session changes against server and baseline…
    </div>
  )

  if (error) return (
    <div className="text-sm text-red-400 py-8 text-center">{error}</div>
  )

  if (!result) return null

  const counts = {
    packable:  (result.match?.length ?? 0) + (result.new?.length ?? 0),
    drift:     result.drift?.length    ?? 0,
    missing:   result.missing?.length  ?? 0,
    unchanged: result.unchanged?.length ?? 0,
  }

  const ORDER = ['DRIFT', 'MISSING', 'ERROR', 'MATCH', 'NEW', 'UNCHANGED']
  const sorted = [...(result.results ?? [])].sort((a, b) =>
    ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome)
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Baseline info */}
      {result.has_baseline ? (
        <div className="text-[11px] text-muted-foreground bg-muted/30 rounded px-3 py-1.5 flex items-center gap-2">
          <Database size={10} className="shrink-0" />
          Baseline seeded {result.baseline_seeded_at?.slice(0,10)} from <span className="font-mono">{result.baseline_server}</span>
        </div>
      ) : seedResult ? (
        <div className="text-[11px] text-emerald-400 bg-emerald-500/10 rounded px-3 py-1.5 flex items-center gap-2">
          <CheckCircle2 size={10} className="shrink-0" />
          Baseline seeded — {seedResult.counts?.cubes} cubes, {seedResult.counts?.dimensions} dims, {seedResult.counts?.processes} processes. Re-run diff to compare.
        </div>
      ) : (
        <div className="flex items-center gap-3 text-[11px] text-amber-400 bg-amber-500/10 rounded px-3 py-1.5">
          <AlertTriangle size={10} className="shrink-0" />
          <span className="flex-1">No baseline found — all objects show as NEW. Seed the source server to enable accurate diff.</span>
          <button
            onClick={onSeed}
            disabled={seeding}
            className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-medium transition-colors disabled:opacity-50 shrink-0"
          >
            {seeding ? <Loader2 size={9} className="animate-spin" /> : <Database size={9} />}
            {seeding ? 'Seeding…' : 'Seed now'}
          </button>
        </div>
      )}

      {/* Summary chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {counts.packable > 0 && <Chip cls="bg-emerald-500/15 text-emerald-400">{counts.packable} ready</Chip>}
        {counts.drift    > 0 && <Chip cls="bg-amber-500/15 text-amber-400">{counts.drift} drift</Chip>}
        {counts.missing  > 0 && <Chip cls="bg-red-500/15 text-red-400">{counts.missing} missing</Chip>}
        {counts.unchanged > 0 && <Chip cls="bg-muted/50 text-muted-foreground">{counts.unchanged} unchanged</Chip>}
      </div>

      {/* Results table */}
      <div className="border border-border rounded overflow-hidden">
        <div className="grid grid-cols-[90px_90px_1fr_1fr_20px] text-[10px] font-medium text-muted-foreground bg-muted/30 px-3 py-1.5 border-b border-border">
          <span>OUTCOME</span><span>TYPE</span><span>NAME</span><span>NOTE</span><span />
        </div>
        <div className="overflow-auto max-h-[320px]">
          {sorted.map((r, i) => {
            const s          = OUTCOME_STYLE[r.outcome] ?? OUTCOME_STYLE.ERROR
            const name       = r.object_name + (r.detail ? ` [${r.detail}]` : '')
            const isDiffable = DIFFABLE_OUTCOMES.has(r.outcome) && DIFFABLE_TYPES.has(r.object_type)
            const rowKey     = `${r.object_type}:${r.object_name}`
            return (
              <div
                key={i}
                onClick={() => isDiffable && handleRowClick(r)}
                className={cn('grid grid-cols-[90px_90px_1fr_1fr_20px] px-3 py-1 border-b border-border/40 last:border-0 hover:bg-muted/20 group', isDiffable && 'cursor-pointer')}
              >
                <span className={cn('text-[10px] flex items-center gap-1', s.cls)}>
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', s.dot)} />
                  {s.label}
                </span>
                <span className="text-[10px] text-muted-foreground">{r.object_type}</span>
                <span className="text-[10px] font-mono truncate pr-2">{name}</span>
                <span className="text-[10px] text-muted-foreground/70 truncate">{r.note}</span>
                <span className="flex items-center justify-center">
                  {isDiffable && (loadingDiff === rowKey
                    ? <Loader2 size={9} className="animate-spin text-muted-foreground" />
                    : <Diff size={9} className="opacity-0 group-hover:opacity-100 text-muted-foreground transition-opacity" />
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {counts.drift > 0 || counts.missing > 0 ? (
        <p className="text-[11px] text-amber-400">
          ⚠ Drift/missing objects will be skipped during packaging — only MATCH and NEW objects are included.
        </p>
      ) : null}
    </div>
  )
}

// ── Control Object Disclosure Panel ───────────────────────────────────────────

function ControlObjectPanel({ manifest }) {
  const [open, setOpen] = useState(false)
  const objects = manifest?.objects ?? []

  const dims = [...new Set([
    ...objects.filter(o => o.type === 'dimension').map(o => o.name),
    ...objects.filter(o => o.type === 'attribute').map(o => o.detail).filter(Boolean),
  ])]
  const cubes = [...new Set(objects.filter(o => o.type === 'rules').map(o => o.name))]
  const procs = [...new Set(objects.filter(o => o.type === 'process').map(o => o.name))]

  const attrsByDim = {}
  objects.filter(o => o.type === 'attribute').forEach(o => {
    if (!o.detail) return
    if (!attrsByDim[o.detail]) attrsByDim[o.detail] = []
    attrsByDim[o.detail].push(o.name)
  })

  if (!dims.length && !cubes.length && !procs.length) return null

  const summary = [
    dims.length  && `${dims.length} dim${dims.length  !== 1 ? 's' : ''}`,
    cubes.length && `${cubes.length} cube${cubes.length !== 1 ? 's' : ''}`,
    procs.length && `${procs.length} process${procs.length !== 1 ? 'es' : ''}`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="border border-border rounded overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        Control Object Changes
        <span className="ml-auto text-[10px] text-muted-foreground/50">{summary}</span>
      </button>

      {open && (
        <div className="border-t border-border">
          {dims.map(dim => (
            <div key={dim} className="px-3 py-2 border-b border-border/40 last:border-0">
              <div className="text-[10px] font-mono font-semibold text-foreground mb-1.5">{dim}</div>
              <div className="flex flex-col gap-1">
                {attrsByDim[dim]?.length > 0 && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
                    <span className="text-muted-foreground font-mono">{'}'+'ElementAttributes'}</span>
                    <span className="text-muted-foreground/60">— {attrsByDim[dim].length} def{attrsByDim[dim].length !== 1 ? 's' : ''} captured</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[10px]">
                  <AlertTriangle size={10} className="text-amber-400 shrink-0" />
                  <span className="text-muted-foreground font-mono">{'}'+'ElementFormats'}</span>
                  <span className="text-muted-foreground/60">— not captured (gap)</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <Info size={10} className="text-muted-foreground/40 shrink-0" />
                  <span className="text-muted-foreground font-mono">{'}'+'ElementSecurity'}</span>
                  <span className="text-muted-foreground/60">— disclosure only, not packaged</span>
                </div>
              </div>
            </div>
          ))}
          {cubes.map(cube => (
            <div key={cube} className="px-3 py-2 border-b border-border/40 last:border-0">
              <div className="text-[10px] font-mono font-semibold text-foreground mb-1.5">{cube}</div>
              <div className="flex items-center gap-2 text-[10px]">
                <Info size={10} className="text-muted-foreground/40 shrink-0" />
                <span className="text-muted-foreground font-mono">{'}'+'CubeSecurity'}</span>
                <span className="text-muted-foreground/60">— disclosure only, not packaged</span>
              </div>
            </div>
          ))}
          {procs.map(proc => (
            <div key={proc} className="px-3 py-2 border-b border-border/40 last:border-0">
              <div className="text-[10px] font-mono font-semibold text-foreground mb-1.5">{proc}</div>
              <div className="flex items-center gap-2 text-[10px]">
                <Info size={10} className="text-muted-foreground/40 shrink-0" />
                <span className="text-muted-foreground font-mono">{'}'+'ProcessSecurity'}</span>
                <span className="text-muted-foreground/60">— disclosure only, not packaged</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Step 2: Package ───────────────────────────────────────────────────────────

function StepPackage({ diffResult, result, error, running, onBuild }) {
  const [selectedDrift, setSelectedDrift] = useState(new Set())

  if (!diffResult) return <p className="text-sm text-muted-foreground">Complete the diff step first.</p>

  const packable  = [...(diffResult.match ?? []), ...(diffResult.new ?? [])]
  const driftItems = diffResult.drift ?? []

  const toggleDrift = (item) => {
    const key = `${item.object_type}::${item.object_name}::${item.detail ?? ''}`
    setSelectedDrift(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  const driftKey = (item) => `${item.object_type}::${item.object_name}::${item.detail ?? ''}`

  if (running) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
      <Loader2 size={14} className="animate-spin" /> Fetching objects from server and building package…
    </div>
  )

  if (result) return (
    <div className="flex flex-col gap-4">
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded px-4 py-3 text-sm text-emerald-400 flex items-center gap-2">
        <CheckCircle2 size={14} /> Package built — {result.packaged} object(s)
      </div>
      <div className="text-[11px] text-muted-foreground font-mono bg-muted/20 rounded px-3 py-2 break-all">
        {result.outputDir}
      </div>
      {result.skipped > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {result.skipped} object(s) skipped (drift/missing/unchanged).
        </p>
      )}
      <div className="border border-border rounded overflow-hidden">
        <div className="grid grid-cols-[70px_70px_1fr_140px] text-[10px] font-medium text-muted-foreground bg-muted/30 px-3 py-1.5 border-b border-border">
          <span>CHANGE</span><span>TYPE</span><span>NAME</span><span>FILE</span>
        </div>
        <div className="overflow-auto max-h-[260px]">
          {(result.manifest?.objects ?? []).map((o, i) => {
            const isOwns = o.outcome === 'NEW'
            const isMod  = o.outcome === 'MATCH'
            const isRef  = o.outcome === 'REFERENCED'
            return (
              <div key={i} className="grid grid-cols-[70px_70px_1fr_140px] px-3 py-1 border-b border-border/40 last:border-0 hover:bg-muted/20 items-center">
                <span className={`text-[10px] font-medium ${isOwns ? 'text-blue-400' : isMod ? 'text-emerald-400' : 'text-muted-foreground/50'}`}>
                  {isOwns ? 'owns' : isMod ? 'modifies' : isRef ? 'ref' : o.outcome?.toLowerCase()}
                </span>
                <span className="text-[10px] text-muted-foreground">{o.type}</span>
                <span className="text-[10px] font-mono truncate pr-2">
                  {o.name}{o.detail ? ` [${o.detail}]` : ''}
                </span>
                <span className="text-[10px] text-muted-foreground/60 font-mono truncate">{o.file}</span>
              </div>
            )
          })}
        </div>
      </div>
      <ControlObjectPanel manifest={result.manifest} />
    </div>
  )

  if (error) return <div className="text-sm text-red-400 py-8 text-center">{error}</div>

  const ownsItems     = packable.filter(r => r.outcome === 'NEW')
  const modifiesItems = packable.filter(r => r.outcome === 'MATCH')

  const ObjectTable = ({ items, accent }) => (
    <div className="border rounded overflow-hidden" style={{ borderColor: accent === 'blue' ? 'rgb(96 165 250 / 0.3)' : 'rgb(52 211 153 / 0.3)' }}>
      <div className={`grid grid-cols-[80px_1fr_1fr] text-[10px] font-medium text-muted-foreground px-3 py-1.5 border-b ${accent === 'blue' ? 'bg-blue-500/5 border-blue-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
        <span>TYPE</span><span>NAME</span><span>NOTE</span>
      </div>
      {items.map((r, i) => (
        <div key={i} className="grid grid-cols-[80px_1fr_1fr] px-3 py-1 border-b border-border/40 last:border-0 text-[10px] hover:bg-muted/20">
          <span className="text-muted-foreground">{r.object_type}</span>
          <span className="font-mono truncate pr-2">{r.object_name}{r.detail ? ` [${r.detail}]` : ''}</span>
          <span className="text-muted-foreground/60 truncate">{r.note}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Owns — NEW objects */}
      {ownsItems.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">Owns</span>
            <span className="text-[10px] text-muted-foreground">— {ownsItems.length} new object{ownsItems.length !== 1 ? 's' : ''}, created on target</span>
          </div>
          <ObjectTable items={ownsItems} accent="blue" />
        </div>
      )}

      {/* Modifies — MATCH objects */}
      {modifiesItems.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Modifies</span>
            <span className="text-[10px] text-muted-foreground">— {modifiesItems.length} existing object{modifiesItems.length !== 1 ? 's' : ''}, updated on target</span>
          </div>
          <ObjectTable items={modifiesItems} accent="emerald" />
        </div>
      )}

      {/* Drift objects — user can opt in */}
      {driftItems.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={11} className="text-amber-400 shrink-0" />
            <p className="text-xs text-amber-400 font-medium">
              {driftItems.length} drifted object(s) — changed on the server but not in a change set.
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            Select any you want to include in this package. These will be fetched as-is from Dev.
          </p>
          <div className="border border-amber-500/30 rounded overflow-hidden">
            <div className="grid grid-cols-[24px_80px_1fr_1fr] text-[10px] font-medium text-muted-foreground bg-amber-500/8 px-3 py-1.5 border-b border-amber-500/20">
              <span />
              <span>TYPE</span><span>NAME</span><span>NOTE</span>
            </div>
            {driftItems.map((r, i) => (
              <label key={i} className="grid grid-cols-[24px_80px_1fr_1fr] px-3 py-1.5 border-b border-border/40 last:border-0 text-[10px] hover:bg-amber-500/5 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={selectedDrift.has(driftKey(r))}
                  onChange={() => toggleDrift(r)}
                  className="rounded"
                />
                <span className="text-muted-foreground">{r.object_type}</span>
                <span className="font-mono truncate pr-2">{r.object_name}{r.detail ? ` [${r.detail}]` : ''}</span>
                <span className="text-muted-foreground/60 truncate">{r.note}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => onBuild([...driftItems.filter(r => selectedDrift.has(driftKey(r)))])}
        className="self-start flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded hover:bg-primary/90 transition-colors"
      >
        <Package size={13} />
        Build Package{selectedDrift.size > 0 ? ` (+${selectedDrift.size} drift)` : ''}
      </button>
    </div>
  )
}

// ── Step 3: Risk ──────────────────────────────────────────────────────────────

function StepRisk({ packageResult, servers, target, onTargetChange, result, error, running, onRun }) {
  if (!packageResult) return <p className="text-sm text-muted-foreground">Build a package first.</p>

  const serverList = (servers?.value ?? servers ?? []).map(s => s.name ?? s).filter(Boolean)

  return (
    <div className="flex flex-col gap-4">
      {/* Target server selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground w-32 shrink-0">Target server</label>
        <select
          value={target}
          onChange={e => onTargetChange(e.target.value)}
          className="flex-1 bg-muted border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">— select target —</option>
          {serverList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {!running && !result && (
          <button
            onClick={onRun}
            disabled={!target}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
          >
            <ShieldCheck size={13} /> Run Risk Check
          </button>
        )}
      </div>

      {running && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 size={14} className="animate-spin" /> Analyzing {packageResult.packaged} objects against {target}…
        </div>
      )}

      {error && <div className="text-sm text-red-400">{error}</div>}

      {result && (
        <>
          {/* Safe / not safe banner */}
          {result.safe_to_deploy ? (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded px-4 py-2.5 text-sm text-emerald-400">
              <CheckCircle2 size={14} />
              {result.warnings.length > 0
                ? `Safe to deploy — ${result.warnings.length} warning(s) to review`
                : 'Clear — no blockers or warnings'}
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded px-4 py-2.5 text-sm text-red-400">
              <XCircle size={14} />
              Not safe to deploy — {result.blockers.length} blocker(s) must be resolved
            </div>
          )}

          {/* Risk items */}
          {['BLOCKER', 'WARNING', 'INFO'].map(level => {
            const items = result.all.filter(r => r.level === level)
            if (!items.length) return null
            const st = RISK_STYLE[level]
            const Icon = st.icon
            return (
              <div key={level}>
                <div className={cn('text-[10px] font-semibold mb-1', st.cls)}>
                  {st.label} ({items.length})
                </div>
                <div className="border border-border rounded overflow-hidden">
                  {items.map((r, i) => {
                    const name = r.name + (r.detail ? ` [${r.detail}]` : '')
                    return (
                      <div key={i} className={cn(
                        'grid grid-cols-[24px_80px_80px_180px_1fr] items-start px-2 py-1.5 border-b border-border/40 last:border-0 text-[10px]',
                        st.row
                      )}>
                        <Icon size={10} className={cn('mt-0.5 shrink-0', st.cls)} />
                        <span className="text-muted-foreground">{r.check}</span>
                        <span className="text-muted-foreground">{r.type}</span>
                        <span className="font-mono truncate pr-1">{name}</span>
                        <span className="text-muted-foreground/80 leading-tight">{r.message}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// ── Step 4: Approve ───────────────────────────────────────────────────────────

function StepApprove({ packageResult, riskResult, source, target, defaultApprover, result, running, error, onApprove }) {
  const [approver, setApprover] = useState(defaultApprover ?? '')
  const [notes,    setNotes]    = useState('')

  if (!riskResult) return <p className="text-sm text-muted-foreground">Complete the risk check first.</p>

  if (result) return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded px-4 py-3 text-sm text-emerald-400">
        <CheckCircle2 size={14} />
        Approved by <span className="font-semibold mx-1">{result.approver}</span>
        at {new Date(result.approved_at).toLocaleString()}
      </div>
      {result.notes && (
        <p className="text-[11px] text-muted-foreground italic px-1">"{result.notes}"</p>
      )}
    </div>
  )

  if (running) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
      <Loader2 size={14} className="animate-spin" /> Recording approval…
    </div>
  )

  if (error) return <div className="text-sm text-red-400 py-4">{error}</div>

  return (
    <div className="flex flex-col gap-5">
      {/* Summary */}
      <div className="flex flex-col gap-3 bg-muted/20 rounded p-4">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Deployment Summary</div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div><span className="text-muted-foreground">Source  </span><span className="font-mono">{source}</span></div>
          <div><span className="text-muted-foreground">Target  </span><span className="font-mono">{target}</span></div>
          <div><span className="text-muted-foreground">Objects </span><span>{packageResult?.packaged}</span></div>
          <div><span className="text-muted-foreground">Risk    </span>
            {riskResult.safe_to_deploy
              ? <span className="text-emerald-400">Clear</span>
              : <span className="text-amber-400">{riskResult.warnings.length} warning(s)</span>}
          </div>
        </div>
      </div>

      {/* Approver */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Approver name</label>
        <input
          value={approver}
          onChange={e => setApprover(e.target.value)}
          placeholder="Your name"
          className="bg-muted border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Notes <span className="text-muted-foreground/50">(optional)</span></label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Tested in staging, safe to deploy…"
          rows={3}
          className="bg-muted border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
      </div>

      <button
        onClick={() => onApprove(approver.trim(), notes.trim())}
        disabled={!approver.trim()}
        className="self-start flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded hover:bg-primary/90 disabled:opacity-40 transition-colors"
      >
        <UserCheck size={13} /> Approve & Proceed to Deploy
      </button>
    </div>
  )
}

// ── Step 5: Deploy ────────────────────────────────────────────────────────────

function StepDeploy({ packageResult, riskResult, target, approval, result, error, running, onDeploy }) {
  const [dryRun,    setDryRun]    = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  if (!riskResult) return <p className="text-sm text-muted-foreground">Complete the risk check first.</p>

  const blocked = !riskResult.safe_to_deploy || !approval

  if (running) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
      <Loader2 size={14} className="animate-spin" />
      {dryRun ? 'Running dry-run…' : `Deploying to ${target}…`}
    </div>
  )

  if (result && !result.aborted) return (
    <div className="flex flex-col gap-4">
      {result.dry_run && (
        <div className="flex items-center justify-between bg-muted/30 rounded px-3 py-2">
          <span className="text-xs text-muted-foreground">Dry run — no changes were made</span>
          <button
            onClick={() => onDeploy(false)}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white transition-colors"
          >
            <Rocket size={11} /> Deploy for Real
          </button>
        </div>
      )}
      <div className={cn(
        'flex items-center gap-2 rounded px-4 py-2.5 text-sm',
        result.failed > 0
          ? 'bg-red-500/10 border border-red-500/30 text-red-400'
          : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400',
      )}>
        {result.failed > 0 ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
        {result.dry_run
          ? `${packageResult.packaged} object(s) would be deployed to ${target}`
          : `Deployed ${result.deployed ?? 0} · Failed ${result.failed ?? 0}`}
      </div>
      <div className="border border-border rounded overflow-hidden">
        {(result.results ?? []).map((r, i) => {
          const name = r.name + (r.detail ? ` [${r.detail}]` : '')
          return (
            <div key={i} className="flex items-center gap-3 px-3 py-1.5 border-b border-border/40 last:border-0 text-[10px] hover:bg-muted/20">
              {r.ok
                ? <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
                : <XCircle     size={10} className="text-red-400 shrink-0" />}
              <span className="text-muted-foreground w-16 shrink-0">{r.type}</span>
              <span className="font-mono flex-1 truncate">{name}</span>
              {!r.ok && <span className="text-red-400/80 truncate">{r.error}</span>}
            </div>
          )
        })}
        {result.dry_run && (result.risk?.all ?? []).length === 0 && (
          <div className="px-3 py-2 text-[10px] text-muted-foreground italic">
            Dry run complete — object list above reflects what would be deployed.
          </div>
        )}
      </div>
    </div>
  )

  if (error) return <div className="text-sm text-red-400 py-8 text-center">{error}</div>

  return (
    <div className="flex flex-col gap-5">
      {approval && (
        <div className="flex items-center gap-2 bg-muted/30 border border-border rounded px-3 py-2 text-[11px] text-muted-foreground">
          <UserCheck size={11} className="text-emerald-400 shrink-0" />
          Approved by <span className="font-semibold text-foreground mx-1">{approval.approver}</span>
          · {new Date(approval.approved_at).toLocaleString()}
          {approval.notes && <span className="italic ml-1">"{approval.notes}"</span>}
        </div>
      )}
      {blocked && !approval && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded px-4 py-2.5 text-sm text-red-400">
          <XCircle size={14} /> Approval required before deploying
        </div>
      )}
      {blocked && approval && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded px-4 py-2.5 text-sm text-red-400">
          <XCircle size={14} /> Blocked — resolve {riskResult.blockers.length} blocker(s) in the risk report before deploying
        </div>
      )}

      {riskResult.warnings.length > 0 && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded px-4 py-2.5 text-sm text-amber-400">
          <AlertTriangle size={14} /> {riskResult.warnings.length} warning(s) — review the risk report above
        </div>
      )}

      <div className="flex flex-col gap-3 bg-muted/20 rounded p-4">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div><span className="text-muted-foreground">Source  </span><span className="font-mono">{packageResult?.manifest?._meta?.server}</span></div>
          <div><span className="text-muted-foreground">Target  </span><span className="font-mono">{target}</span></div>
          <div><span className="text-muted-foreground">Objects </span><span>{packageResult?.packaged}</span></div>
          <div><span className="text-muted-foreground">Session </span><span className="font-mono">{packageResult?.manifest?._meta?.session}</span></div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input type="checkbox" checked={dryRun} onChange={e => { setDryRun(e.target.checked); setConfirmed(false) }}
          className="rounded" />
        <span>Dry run — analyse without making changes</span>
      </label>

      {!dryRun && (
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none text-amber-400">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
            className="rounded" />
          <span>I understand this will modify <span className="font-mono">{target}</span></span>
        </label>
      )}

      <button
        onClick={() => onDeploy(dryRun)}
        disabled={blocked || (!dryRun && !confirmed)}
        className={cn(
          'flex items-center gap-2 px-4 py-2 text-sm rounded transition-colors self-start',
          dryRun
            ? 'bg-muted text-foreground hover:bg-muted/80 disabled:opacity-40'
            : 'bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40',
        )}
      >
        <Rocket size={13} />
        {dryRun ? 'Run Dry-Run' : `Deploy to ${target}`}
      </button>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Chip({ children, cls }) {
  return <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', cls)}>{children}</span>
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function DeployPanel({ tab }) {
  const { openTab, closeTab } = useStore()
  const username = useStore(s => s.username)
  const { session, server } = tab
  const [step,   setStep]   = useState(1)
  const [status, setStatus] = useState({ 1: 'idle', 2: 'idle', 3: 'idle', 4: 'idle', 5: 'idle' })
  const [target, setTarget] = useState('')

  const { data: servers } = useServers()

  const seedMut    = useDeploySeed()
  const diffMut    = useDeployDiff()
  const packageMut = useDeployPackage()
  const riskMut    = useDeployRisk()
  const approveMut = useDeployApprove()
  const archiveMut = useDeployArchive()
  const deployMut  = useDeployExecute()

  const setStepStatus = (s, v) => setStatus(prev => ({ ...prev, [s]: v }))

  // Auto-run diff on mount
  useEffect(() => {
    runDiff()
  }, [])

  async function runDiff() {
    setStepStatus(1, 'running')
    try {
      await diffMut.mutateAsync({ server, sessionId: session.id })
      setStepStatus(1, 'done')
    } catch {
      setStepStatus(1, 'error')
    }
  }

  async function runPackage(forceInclude = []) {
    setStepStatus(2, 'running')
    try {
      await packageMut.mutateAsync({ server, sessionId: session.id, sessionName: session.name, forceInclude })
      setStepStatus(2, 'done')
      setStep(3)
    } catch {
      setStepStatus(2, 'error')
    }
  }

  async function runRisk() {
    if (!packageMut.data?.outputDir || !target) return
    setStepStatus(3, 'running')
    try {
      await riskMut.mutateAsync({ packageDir: packageMut.data.outputDir, target })
      setStepStatus(3, 'done')
      setStep(4)
    } catch {
      setStepStatus(3, 'error')
    }
  }

  async function runApprove(approver, notes) {
    if (!packageMut.data?.outputDir || !target) return
    setStepStatus(4, 'running')
    try {
      await approveMut.mutateAsync({
        source: server, target, approver, notes,
        packaged: packageMut.data?.packaged,
        session: session.name,
        packageDir: packageMut.data?.outputDir,
      })
      setStepStatus(4, 'done')
      setStep(5)
    } catch {
      setStepStatus(4, 'error')
    }
  }

  async function runDeploy(dryRun) {
    if (!packageMut.data?.outputDir || !target) return
    setStepStatus(5, 'running')
    const token = localStorage.getItem('tm1-token') ?? ''
    const snapHeaders = { 'Content-Type': 'application/json', 'x-ide-token': token }
    const snapBody    = JSON.stringify({ packageDir: packageMut.data.outputDir, target })
    const takeSnap    = () => fetch('/api/deploy/scoped-snapshot', { method: 'POST', headers: snapHeaders, body: snapBody })
                               .then(r => r.ok ? r.json() : null).catch(() => null)
    try {
      const preSnapshot = dryRun ? null : await takeSnap()
      const result = await deployMut.mutateAsync({ packageDir: packageMut.data.outputDir, target, dryRun })
      if (!dryRun && !result.aborted) {
        const postSnapshot = await takeSnap()
        await archiveMut.mutateAsync({
          approval: approveMut.data,
          deployResult: result,
          manifest: packageMut.data?.manifest,
          source: server,
          target,
          deployer: approveMut.data?.approver ?? username,
          preSnapshot,
          postSnapshot,
        }).catch(() => {})
      }
      setStepStatus(5, 'done')
    } catch {
      setStepStatus(5, 'error')
    }
  }

  const diffResult    = diffMut.data
  const packageResult = packageMut.data
  const riskResult    = riskMut.data
  const approveResult = approveMut.data
  const deployResult  = deployMut.data

  const canAdvance1 = status[1] === 'done' && ((diffResult?.match?.length ?? 0) + (diffResult?.new?.length ?? 0)) > 0
  const canAdvance2 = status[2] === 'done'
  const canAdvance3 = status[3] === 'done'
  const canAdvance4 = status[4] === 'done'

  return (
    <div className="flex flex-col h-full">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <Rocket size={13} className="text-muted-foreground" />
              Deploy — <span className="font-mono">{session.name}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Source: <span className="font-mono">{server}</span>
              {' · '}{session.entry_count ?? '?'} changes
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => openTab({ id: 'deploy-history', type: 'deploy-history', label: 'Deploy History' })}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Deploy History"
            >
              <History size={14} />
            </button>
            <button onClick={() => closeTab(tab.id)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Steps */}
        <StepBar step={step} status={status} />

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {step === 1 && (
            <StepDiff
              result={diffResult}
              error={diffMut.error?.message}
              running={status[1] === 'running'}
              onSeed={() => seedMut.mutate({ server })}
              seeding={seedMut.isPending}
              seedResult={seedMut.data}
              server={server}
              openTab={openTab}
            />
          )}
          {step === 2 && (
            <StepPackage
              diffResult={diffResult}
              result={packageResult}
              error={packageMut.error?.message}
              running={status[2] === 'running'}
              onBuild={runPackage}
            />
          )}
          {step === 3 && (
            <StepRisk
              packageResult={packageResult}
              servers={servers}
              target={target}
              onTargetChange={setTarget}
              result={riskResult}
              error={riskMut.error?.message}
              running={status[3] === 'running'}
              onRun={runRisk}
            />
          )}
          {step === 4 && (
            <StepApprove
              packageResult={packageResult}
              riskResult={riskResult}
              source={server}
              target={target}
              defaultApprover={username ?? ''}
              result={approveResult}
              error={approveMut.error?.message}
              running={status[4] === 'running'}
              onApprove={runApprove}
            />
          )}
          {step === 5 && (
            <StepDeploy
              packageResult={packageResult}
              riskResult={riskResult}
              target={target}
              approval={approveResult}
              result={deployResult}
              error={deployMut.error?.message}
              running={status[5] === 'running'}
              onDeploy={runDeploy}
            />
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/10 shrink-0">
          <button
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            ← Back
          </button>

          <div className="flex items-center gap-2">
            {step === 1 && (
              <>
                <button
                  onClick={runDiff}
                  disabled={status[1] === 'running'}
                  className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors disabled:opacity-40"
                >
                  {status[1] === 'running' ? 'Running…' : '↻ Re-run diff'}
                </button>
                <button
                  onClick={() => setStep(2)}
                  disabled={!canAdvance1}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  Package <ArrowRight size={11} />
                </button>
              </>
            )}
            {step === 2 && canAdvance2 && (
              <button
                onClick={() => setStep(3)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Risk Check <ArrowRight size={11} />
              </button>
            )}
            {step === 3 && canAdvance3 && (
              <button
                onClick={() => setStep(4)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Approve <ArrowRight size={11} />
              </button>
            )}
            {step === 4 && canAdvance4 && (
              <button
                onClick={() => setStep(5)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Deploy <ArrowRight size={11} />
              </button>
            )}
          </div>
        </div>
    </div>
  )
}
