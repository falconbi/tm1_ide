import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { request, authHeader } from '@/lib/api'
import { ShieldCheck, Loader2, Save, HelpCircle } from 'lucide-react'
import { useServers } from '@/hooks/useApi'
import { useStore } from '@/store'
import { toast } from 'sonner'

// What happens to a target before a deploy is allowed to overwrite it.
//
// A deploy writes the model, and there is no undo — so the target's data is
// saved to disk first, and then either the site's own backup process runs or the
// person states when the last backup was taken. This screen sets which.

export default function DeployProtection() {
  const server = useStore(s => s.server)
  const { data } = useServers()
  const servers = (data?.value ?? data ?? []).map(s => s?.name ?? s).filter(Boolean)
  const qc = useQueryClient()
  const [target, setTarget] = useState(server ?? '')
  const [draft, setDraft] = useState(null)     // edits only; the saved value comes from the query
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [showHelp, setShowHelp] = useState(false)

  // Server state lives in the query, not in an effect: no copy, no cascading render.
  const settings = useQuery({
    queryKey: ['deploy-settings', target],
    enabled: !!target,
    queryFn: async () => {
      const r = await request(`/api/deploy/settings?server=${encodeURIComponent(target)}`, { headers: authHeader() })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      return d
    },
  })
  const loaded = settings.data ? (settings.data.backupProcess ?? '') : null
  const process = draft ?? loaded ?? ''

  const save = async () => {
    setBusy('save'); setError(null)
    try {
      const r = await request('/api/deploy/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ server: target, backupProcess: process.trim() || null }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['deploy-settings', target] })
      toast.success(d.backupProcess ? `Deploys to ${target} will run "${d.backupProcess}" first` : `Deploys to ${target} will ask for the last backup time`)
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }

  return (
    <div className="p-5 space-y-4 max-w-2xl">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck size={14} className="text-muted-foreground" /> Backup before deploy
          <button onClick={() => setShowHelp(v => !v)} className="p-0.5 text-muted-foreground hover:text-foreground" title="Help"><HelpCircle size={12} /></button>
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Every deploy writes the target's model, and there is no undo. Before the pull, the IDE saves the
          target's data to disk, then runs the backup you name here — or asks the person when the last backup
          was taken, if you name none.
        </p>
      </div>

      {showHelp && (
        <div className="border border-border rounded-md p-3 text-[11px] text-muted-foreground space-y-1.5">
          <p><span className="text-foreground">A backup process</span> is a TI process you write on the target. It runs with the deploy's own login, under the deploy lock, immediately before the model is replaced.</p>
          <p><span className="text-foreground">It usually needs ExecuteCommand</span> — to copy files, call a database backup, or run a script. <span className="text-amber-600">TM1 v12 does not allow ExecuteCommand</span>, so on v12 a process that shells out will fail and stop every deploy. On v12, leave this empty: the deploy asks for the last backup time instead, which is the normal answer there.</p>
          <p><span className="text-foreground">If the process fails, the deploy is refused</span> before anything is replaced. That is the point of it.</p>
          <p><span className="text-foreground">Saving data is separate</span> and always happens: <span className="font-mono">SaveDataAll</span> on the target, recorded in the deploy report with the time it ran.</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground w-16">Server</label>
        <select value={target} onChange={e => setTarget(e.target.value)} className="bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
          {!target && <option value="">Select a server…</option>}
          {servers.map(s => <option key={s} value={s} className="bg-background">{s}</option>)}
        </select>
      </div>

      {target && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-16">Process</label>
            <input
              value={process}
              onChange={e => setDraft(e.target.value)}
              placeholder="(none — ask for the last backup time)"
              className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={save}
              disabled={busy === 'save' || settings.isLoading || process.trim() === (loaded ?? '')}
              className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40"
            >
              {busy === 'save' ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
            </button>
          </div>
          {settings.isLoading && <p className="text-[11px] text-muted-foreground">Reading the setting…</p>}
          {settings.error && <p className="text-[11px] text-red-600">{settings.error.message}</p>}
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          {!busy && loaded !== null && (
            <p className="text-[11px] text-muted-foreground">
              {loaded
                ? <>Deploys to <span className="text-foreground">{target}</span> run <span className="font-mono text-foreground">{loaded}</span> first.</>
                : <>Deploys to <span className="text-foreground">{target}</span> ask for the last backup time.</>}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
