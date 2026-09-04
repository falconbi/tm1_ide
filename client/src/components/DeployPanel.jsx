import { useState, useEffect } from 'react'
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Info,
         ChevronRight, Package, Rocket, ShieldCheck, ArrowRight, RefreshCw } from 'lucide-react'
import { useServers, useDeployDiff, useDeployPackage, useDeployDriftCheck,
         useDeployRisk, useDeployExecute, useDeployApprove } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

// ── Constants ─────────────────────────────────────────────────────────────────

const OUTCOME = {
  MATCH:     { label: 'Modified',  cls: 'text-emerald-400', dot: 'bg-emerald-400',      packable: true  },
  NEW:       { label: 'New',       cls: 'text-blue-400',    dot: 'bg-blue-400',          packable: true  },
  DRIFT:     { label: 'Drift',     cls: 'text-amber-400',   dot: 'bg-amber-400',         packable: true  },
  UNCHANGED: { label: 'Unchanged', cls: 'text-muted-foreground', dot: 'bg-muted-foreground', packable: false },
  MISSING:   { label: 'Missing',   cls: 'text-red-400',     dot: 'bg-red-400',           packable: false },
  ERROR:     { label: 'Error',     cls: 'text-red-400',     dot: 'bg-red-400',           packable: false },
}

const RISK_STYLE = {
  BLOCKER: { cls: 'text-red-400',    row: 'bg-red-500/8',   Icon: XCircle,       label: 'BLOCKER' },
  WARNING: { cls: 'text-amber-400',  row: 'bg-amber-500/8', Icon: AlertTriangle, label: 'WARNING' },
  INFO:    { cls: 'text-muted-foreground', row: '', Icon: Info, label: 'INFO'    },
}

const DIFFABLE = new Set(['rules', 'process', 'subset', 'view'])

function objKey(o) {
  return `${o.object_type}::${o.object_name}::${o.detail ?? ''}`
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

// ── Screen 1: Select objects ──────────────────────────────────────────────────

function Screen1({ diffData, diffRunning, diffError, selected, setSelected, server, openTab, onPrepare, packaging }) {
  const allItems = diffData ? [
    ...(diffData.match     ?? []).map(o => ({ ...o, outcome: 'MATCH'     })),
    ...(diffData.new       ?? []).map(o => ({ ...o, outcome: 'NEW'       })),
    ...(diffData.drift     ?? []).map(o => ({ ...o, outcome: 'DRIFT'     })),
    ...(diffData.missing   ?? []).map(o => ({ ...o, outcome: 'MISSING'   })),
    ...(diffData.unchanged ?? []).map(o => ({ ...o, outcome: 'UNCHANGED' })),
  ] : []

  const packable = allItems.filter(o => OUTCOME[o.outcome]?.packable)
  const checkable = packable.filter(o => o.outcome !== 'DRIFT')  // MATCH + NEW only for select-all

  const allChecked = checkable.length > 0 && checkable.every(o => selected.has(objKey(o)))

  const toggleAll = () => {
    const keys = checkable.map(objKey)
    if (allChecked) {
      setSelected(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); keys.forEach(k => n.add(k)); return n })
    }
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary chips */}
      <div className="flex items-center gap-4 px-5 py-2.5 border-b border-border/50 text-xs text-muted-foreground shrink-0">
        {((diffData.match?.length ?? 0) + (diffData.new?.length ?? 0)) > 0 && (
          <span>
            <span className="text-foreground font-medium">
              {(diffData.match?.length ?? 0) + (diffData.new?.length ?? 0)}
            </span> changed
          </span>
        )}
        {(diffData.drift?.length ?? 0) > 0 && (
          <span className="text-amber-400">
            <span className="font-medium">{diffData.drift.length}</span> drift
          </span>
        )}
        {(diffData.unchanged?.length ?? 0) > 0 && (
          <span><span className="font-medium">{diffData.unchanged.length}</span> unchanged</span>
        )}
        {(diffData.missing?.length ?? 0) > 0 && (
          <span className="text-red-400">
            <span className="font-medium">{diffData.missing.length}</span> missing
          </span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border/50">
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
            ) : allItems.map(o => {
              const oc = OUTCOME[o.outcome] ?? OUTCOME.ERROR
              const k  = objKey(o)
              const clickable = DIFFABLE.has(o.object_type) && (o.outcome === 'MATCH' || o.outcome === 'DRIFT')
              return (
                <tr key={k} className={cn(
                  'border-b border-border/30 transition-colors',
                  oc.packable ? 'hover:bg-muted/30' : 'opacity-40',
                  o.outcome === 'DRIFT' && 'bg-amber-500/4',
                )}>
                  <td className="px-3 py-2">
                    {oc.packable && (
                      <input type="checkbox" checked={selected.has(k)} onChange={() => toggle(o)}
                        className="accent-primary cursor-pointer" />
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{o.object_type}</td>
                  <td
                    className={cn('px-3 py-2 font-medium', clickable && 'cursor-pointer hover:text-primary hover:underline')}
                    onClick={() => clickable && handleRowClick(o)}
                  >{o.object_name}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{o.detail ?? ''}</td>
                  <td className="px-3 py-2">
                    <span className={cn('inline-flex items-center gap-1.5', oc.cls)}>
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', oc.dot)} />
                      {oc.label}
                    </span>
                  </td>
                </tr>
              )
            })}
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

function Screen2({ servers, currentServer, target, setTarget, riskData, riskRunning, driftData, driftRunning,
                   notes, setNotes, username, onDeploy, deploying }) {
  const otherServers = (servers ?? []).filter(s => s.name !== currentServer)
  const riskItems    = riskData?.items ?? []
  const blockers     = riskItems.filter(r => r.level === 'BLOCKER')
  const driftedItems = driftData?.drifted ?? []
  const hasDrift     = driftedItems.length > 0
  const canDeploy    = target && !deploying && blockers.length === 0 && !hasDrift && !riskRunning && !driftRunning

  return (
    <div className="flex flex-col h-full overflow-auto">
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
              {hasDrift && (
                <div className="mb-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-amber-400 mb-2">
                    Target Drift Detected
                  </p>
                  {driftedItems.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-amber-500/8 rounded px-3 py-2 mb-1">
                      <AlertTriangle size={11} className="text-amber-400 shrink-0" />
                      <span className="text-muted-foreground">
                        {d.object_type} <span className="text-foreground font-medium">{d.object_name}</span> differs on target
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {riskItems.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Risk Analysis</p>
                  {riskItems.map((r, i) => {
                    const rs = RISK_STYLE[r.level] ?? RISK_STYLE.INFO
                    return (
                      <div key={i} className={cn('flex items-start gap-2 rounded px-3 py-2 mb-1 text-xs', rs.row)}>
                        <rs.Icon size={11} className={cn('mt-0.5 shrink-0', rs.cls)} />
                        <div>
                          <span className={cn('font-medium mr-1.5', rs.cls)}>{rs.label}</span>
                          <span className="text-muted-foreground">{r.message}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : riskData && !hasDrift ? (
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

function Screen3({ deployData, deployRunning, onReset }) {
  if (deployRunning) return (
    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-16">
      <Loader2 size={14} className="animate-spin" /> Deploying objects…
    </div>
  )

  if (!deployData) return null

  const results = deployData.results ?? []
  const nOk  = results.filter(r => r.status === 'ok').length
  const nErr = results.filter(r => r.status !== 'ok').length

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
                  {r.status === 'ok'
                    ? <CheckCircle2 size={13} className="text-emerald-400" />
                    : <XCircle size={13} className="text-red-400" />}
                </td>
                <td className="px-4 py-2 font-mono text-muted-foreground">{r.object_type}</td>
                <td className="px-4 py-2 font-medium">{r.object_name}</td>
                <td className="px-4 py-2 font-mono text-muted-foreground">{r.detail ?? ''}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.message ?? ''}</td>
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

  const [screen,  setScreen]  = useState(1)
  const [selected, setSelected] = useState(new Set())
  const [target,  setTarget]  = useState('')
  const [notes,   setNotes]   = useState('')

  const { data: servers } = useServers()
  const diffMut    = useDeployDiff()
  const packageMut = useDeployPackage()
  const driftMut   = useDeployDriftCheck()
  const riskMut    = useDeployRisk()
  const approveMut = useDeployApprove()
  const deployMut  = useDeployExecute()

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
      })
      setScreen(2)
    } catch { /* packageMut.error shown in banner */ }
  }

  async function handleDeploy() {
    const dir = packageMut.data?.outputDir
    if (!dir) return
    try {
      await approveMut.mutateAsync({
        source: server, target, approver: username || 'admin',
        notes, packaged: session.name, session: session.id, packageDir: dir,
      })
      await deployMut.mutateAsync({ packageDir: dir, target })
      setScreen(3)
    } catch { /* deployMut.error shown in banner */ }
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
    diffMut.mutate({ server, sessionId: session.id })
  }

  const anyError = packageMut.error || deployMut.error || approveMut.error

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ScreenHeader current={screen} />

      {screen === 1 && (
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
      )}

      {screen === 2 && (
        <Screen2
          servers={servers}
          currentServer={server}
          target={target}
          setTarget={setTarget}
          riskData={riskMut.data}
          riskRunning={riskMut.isPending}
          driftData={driftMut.data}
          driftRunning={driftMut.isPending}
          notes={notes}
          setNotes={setNotes}
          username={username}
          onDeploy={handleDeploy}
          deploying={deployMut.isPending || approveMut.isPending}
        />
      )}

      {screen === 3 && (
        <Screen3
          deployData={deployMut.data}
          deployRunning={deployMut.isPending}
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
