import { useServers, useServerLogins, useServerVersion, serverLogout } from '@/hooks/useApi'
import { useStore } from '@/store'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Database, RefreshCw, KeyRound, LogOut } from 'lucide-react'
import { serverLabel } from '@/lib/tm1-version'

export default function ServerSelector() {
  const { data: servers = [] } = useServers()
  const { server, setServer, serverVersion, setServerVersion } = useStore()
  const queryClient = useQueryClient()

  const { data: versionData } = useServerVersion(server)
  const version = versionData?.version ?? null
  useEffect(() => { setServerVersion(version) }, [version, setServerVersion])

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
          <span title={`TM1 ${serverVersion}`} className="ml-auto text-[9px] font-semibold border rounded px-1 py-0.5 text-violet-400 border-violet-500/20 bg-violet-500/10">
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
      {server && <ServerLoginState server={server} />}
    </div>
  )
}

// Sign-in state of the selected server, with Sign in / Sign out.
function ServerLoginState({ server }) {
  const { data: logins = [], refetch } = useServerLogins()
  const queryClient = useQueryClient()
  // Re-check after any sign-in dialog success or failure.
  useEffect(() => {
    const t = setInterval(() => refetch(), 15_000)
    return () => clearInterval(t)
  }, [refetch])
  const st = logins.find(l => l.name?.toLowerCase() === server.toLowerCase())
  if (!st) return null
  const signIn = () => window.dispatchEvent(new CustomEvent('tm1-server-login', { detail: { server, force: true, rejected: st.status === 'rejected' } }))
  const signOut = async () => { await serverLogout(server); refetch(); queryClient.invalidateQueries() }

  if (st.status === 'paw') return null
  if (st.status === 'signed-in') {
    return (
      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span className="truncate">Signed in as <span className="font-mono">{st.username}</span></span>
        <button onClick={signOut} className="ml-auto p-0.5 rounded hover:bg-sidebar-accent hover:text-foreground" title={`Sign out of ${server}`}>
          <LogOut size={10} />
        </button>
      </div>
    )
  }
  return (
    <button onClick={signIn}
      className={'mt-1 w-full flex items-center justify-center gap-1 rounded border px-2 py-0.5 text-[10px] transition-colors ' +
        (st.status === 'rejected'
          ? 'border-amber-500/40 text-amber-500 hover:bg-amber-500/10'
          : 'border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-sidebar-accent')}>
      <KeyRound size={10} />
      {st.status === 'rejected' ? 'Login rejected — sign in again' : `Sign in to ${server}`}
    </button>
  )
}
