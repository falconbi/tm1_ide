import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, RotateCcw, ServerCog, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { request, authHeader } from '@/lib/api'
import { useServers } from '@/hooks/useApi'
import { cn } from '@/lib/utils'

// Deploy administration — the three deliberate resets around the normal flow.
// Each says what it does, shows what it will affect, and waits for a second
// click before sending anything. The server refuses on its own terms; this
// screen shows that refusal as it is, it never tries to pre-empt it.

const headers = () => ({ 'Content-Type': 'application/json', ...authHeader() })

async function post(route, body) {
  const r = await request(route, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.error) {
    const err = new Error(d.error || r.statusText)
    err.body = d
    throw err
  }
  return d
}

function Card({ icon: Icon, title, children }) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <p className="text-xs font-semibold flex items-center gap-1.5"><Icon size={13} /> {title}</p>
      {children}
    </div>
  )
}

function Note({ tone = 'muted', children }) {
  return (
    <div className={cn('rounded px-2.5 py-2 text-[11px] space-y-1',
      tone === 'ok' ? 'border border-emerald-600/30 bg-emerald-600/5 text-emerald-700'
        : tone === 'warn' ? 'border border-amber-600/40 bg-amber-500/5 text-amber-700'
          : 'border border-border bg-muted/30 text-muted-foreground')}>
      {children}
    </div>
  )
}

function RecloneTest({ currentServer }) {
  const qc = useQueryClient()
  const { data: serversData } = useServers()
  const servers = (serversData?.value ?? serversData ?? []).map(s => s?.name ?? s).filter(Boolean)
  const fallback = servers.find(n => /TEST/i.test(n) && n !== currentServer) || servers.find(n => n !== currentServer) || ''
  const [picked, setPicked] = useState('')
  const testServer = picked || fallback
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const cycle = useQuery({
    queryKey: ['test-cycle', testServer],
    enabled: !!testServer,
    staleTime: 10_000,
    queryFn: async () => {
      const r = await request(`/api/deploy/test-cycle?server=${encodeURIComponent(testServer)}`, { headers: authHeader() })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      return d
    },
  })
  const sets = cycle.data?.sets ?? []

  const run = async () => {
    setBusy(true); setError(null); setResult(null)
    try {
      const d = await post('/api/deploy/reclone-test', { server: testServer })
      setResult(d)
      setConfirming(false)
      qc.invalidateQueries({ queryKey: ['test-cycle', testServer] })
      qc.invalidateQueries({ queryKey: ['work-sessions'] })
      qc.invalidateQueries({ queryKey: ['deploy-baseline'] })
    } catch (e) { setError(e.message); setConfirming(false) }
    finally { setBusy(false) }
  }

  return (
    <Card icon={RefreshCw} title="TEST was re-cloned from PROD">
      <p className="text-[11px] text-muted-foreground">
        Use this after TEST has been rebuilt from PROD outside the IDE. TEST will write its own
        objects to Git as TEST Last Deployed; the IDE records that, writes the attributes branch,
        and starts a new TEST cycle. Any TEST deploy that never reached another server is
        superseded and has to be deployed to TEST again.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">TEST server</span>
        <select
          value={testServer}
          onChange={e => { setPicked(e.target.value); setResult(null); setError(null); setConfirming(false) }}
          className="bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {servers.filter(n => n !== currentServer).map(n => <option key={n} value={n} className="bg-background">{n}</option>)}
          {servers.filter(n => n !== currentServer).length === 0 && <option value="">(no other servers)</option>}
        </select>
      </div>
      {testServer && (
        <Note tone={sets.length ? 'warn' : 'muted'}>
          <p className="font-medium">{sets.length ? 'These TEST deploys will be superseded:' : 'No TEST deploy in the current cycle yet.'}</p>
          {sets.length > 0 && <p>{sets.map(s => s.name).join(' · ')}</p>}
          {cycle.data?.open === false && <p>A change set in this cycle already reached another server, so the cycle is closed.</p>}
        </Note>
      )}
      {!confirming && (
        <button
          onClick={() => setConfirming(true)}
          disabled={!testServer || busy}
          className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-foreground hover:bg-muted disabled:opacity-40"
        >
          <RefreshCw size={12} /> Re-clone TEST…
        </button>
      )}
      {confirming && (
        <Note tone="warn">
          <p>This will write <span className="font-medium">{testServer}</span>'s own objects to Git and mark its current TEST deploys superseded. Only do this if TEST really was re-cloned from PROD.</p>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={run} disabled={busy} className="px-2.5 py-1 rounded bg-amber-600 text-white text-[11px] hover:bg-amber-500 disabled:opacity-40">
              {busy ? 'Working…' : `Yes, ${testServer} was re-cloned`}
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </Note>
      )}
      {busy && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Working — TEST may take a moment to write its objects.</p>}
      {error && <Note tone="warn"><p className="flex items-center gap-1"><AlertTriangle size={11} /> {error}</p></Note>}
      {result?.ok && (
        <Note tone="ok">
          <p className="flex items-center gap-1"><CheckCircle2 size={11} /> {result.note}</p>
          <p>Commit <span className="font-mono">{String(result.commit ?? '').slice(0, 10)}</span>{result.attrsError ? ` · attributes branch not written: ${result.attrsError}` : ''}</p>
          {result.superseded?.length ? <p>Superseded: {result.superseded.length} TEST deploy{result.superseded.length === 1 ? '' : 's'}.</p> : null}
        </Note>
      )}
    </Card>
  )
}

function StartAgain({ server }) {
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [blocked, setBlocked] = useState(null)

  const run = async () => {
    setBusy(true); setError(null); setResult(null); setBlocked(null)
    try {
      const d = await post('/api/deploy/start-again', { server })
      setResult(d)
      setConfirming(false)
      qc.invalidateQueries({ queryKey: ['work-sessions'] })
      qc.invalidateQueries({ queryKey: ['deploy-baseline'] })
    } catch (e) {
      setError(e.message)
      setBlocked(Array.isArray(e.body?.blocked) ? e.body.blocked : null)
      setConfirming(false)
    } finally { setBusy(false) }
  }

  return (
    <Card icon={RotateCcw} title="Start again with a new repository">
      <p className="text-[11px] text-muted-foreground">
        Clear <span className="font-medium text-foreground">{server}</span>'s deploy note so it can be
        linked to a new repository. The old repository is left as the archive. It refuses while a
        closed change set has never been deployed or retired — deploy or retire it first.
      </p>
      {!confirming && (
        <button
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-foreground hover:bg-muted disabled:opacity-40"
        >
          <RotateCcw size={12} /> Start again…
        </button>
      )}
      {confirming && (
        <Note tone="warn">
          <p>This clears <span className="font-medium">{server}</span>'s deploy note in the IDE and in the model, then you link the new repository with GitHub setup. Nothing else is deleted.</p>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={run} disabled={busy} className="px-2.5 py-1 rounded bg-amber-600 text-white text-[11px] hover:bg-amber-500 disabled:opacity-40">
              {busy ? 'Working…' : `Yes, clear ${server}'s deploy note`}
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </Note>
      )}
      {busy && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Working…</p>}
      {error && (
        <Note tone="warn">
          <p className="flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>
          {blocked?.length ? <p>Deploy or retire: {blocked.map(s => `"${s.name}"`).join(', ')}.</p> : null}
        </Note>
      )}
      {result?.ok && <Note tone="ok"><p className="flex items-center gap-1"><CheckCircle2 size={11} /> {result.note}</p></Note>}
    </Card>
  )
}

function PrepareDevRestore({ server }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null)

  const run = async () => {
    setBusy(true); setError(null); setResult(null); setOpen(null)
    try {
      const d = await post('/api/deploy/prepare-dev-restore', { server })
      setResult(d)
      setConfirming(false)
    } catch (e) {
      setError(e.message)
      setOpen(Array.isArray(e.body?.open) ? e.body.open : null)
      setConfirming(false)
    } finally { setBusy(false) }
  }

  return (
    <Card icon={ServerCog} title="Prepare DEV for restore">
      <p className="text-[11px] text-muted-foreground">
        Checks that <span className="font-medium text-foreground">{server}</span> has no open change
        sets before you restore or re-clone it outside the IDE. This does not restore anything and
        does not touch the model.
      </p>
      {!confirming && (
        <button
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-foreground hover:bg-muted disabled:opacity-40"
        >
          <ServerCog size={12} /> Prepare DEV for restore…
        </button>
      )}
      {confirming && (
        <Note tone="warn">
          <p>This runs the open-change-set check on <span className="font-medium">{server}</span>; it writes nothing. If it is clear, the steps for a restore are shown.</p>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={run} disabled={busy} className="px-2.5 py-1 rounded bg-amber-600 text-white text-[11px] hover:bg-amber-500 disabled:opacity-40">
              {busy ? 'Checking…' : `Yes, check ${server}`}
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </Note>
      )}
      {busy && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Checking…</p>}
      {error && (
        <Note tone="warn">
          <p className="flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>
          {open?.length ? <p>Open change sets: {open.map(s => `"${s.name}"`).join(', ')}.</p> : null}
        </Note>
      )}
      {result?.ok && (
        <Note tone="ok">
          <p className="flex items-center gap-1"><CheckCircle2 size={11} /> {result.note}</p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>Keep {server}'s own <span className="font-mono">{'}git.ctx'}</span> when the server is replaced.</li>
            <li>Restore or re-clone {server} from PROD outside the IDE.</li>
            <li>Reconnect the IDE — the Git label is checked on reconnect.</li>
          </ol>
        </Note>
      )}
    </Card>
  )
}

export default function DeployAdmin({ server }) {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold mb-1">Deploy administration</h2>
          <p className="text-xs text-muted-foreground">
            The resets around the normal flow. Nothing here is part of a deploy; each asks before it
            acts, and the server still refuses when the model is not ready.
          </p>
        </div>
        <RecloneTest currentServer={server} />
        <StartAgain server={server} />
        <PrepareDevRestore server={server} />
      </div>
    </div>
  )
}
