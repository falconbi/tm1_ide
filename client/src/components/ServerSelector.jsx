import { useServers } from '@/hooks/useApi'
import { useStore } from '@/store'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Database, RefreshCw } from 'lucide-react'
import { serverLabel } from '@/lib/tm1-version'

export default function ServerSelector() {
  const { data: servers = [] } = useServers()
  const { server, setServer, serverVersion, setServerVersion } = useStore()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!server) return
    let cancelled = false
    fetch(`/api/server/version?server=${encodeURIComponent(server)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setServerVersion(d?.version ?? null) })
      .catch(() => { if (!cancelled) setServerVersion(null) })
    return () => { cancelled = true }
  }, [server, setServerVersion])

  const refresh = () => {
    if (!server) return
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[1] === server })
  }

  return (
    <div className="px-3 py-2 border-b border-sidebar-border">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Database size={12} />
        <span>SERVER</span>
        {serverVersion && (
          <span className="ml-auto text-[9px] font-semibold border rounded px-1 py-0.5 text-violet-400 border-violet-500/20 bg-violet-500/10">
            {serverLabel(serverVersion)}
          </span>
        )}
        {server && (
          <button
            onClick={refresh}
            className="ml-auto p-0.5 rounded text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
            title="Refresh server objects"
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>
      <select
        value={server ?? ''}
        onChange={e => setServer(e.target.value || null)}
        className="w-full bg-sidebar text-sidebar-foreground text-sm rounded border border-sidebar-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sidebar-ring"
      >
        <option value="">— select server —</option>
        {servers.map(s => {
          const name = typeof s === 'string' ? s : (s?.name ?? '')
          const ro   = typeof s === 'string' ? false : !!s?.readOnly
          return <option key={name} value={name}>{name}{ro ? '  (read-only)' : ''}</option>
        })}
      </select>
    </div>
  )
}
