import { useServers } from '@/hooks/useApi'
import { useStore } from '@/store'
import { Database } from 'lucide-react'

export default function ServerSelector() {
  const { data: servers = [] } = useServers()
  const { server, setServer } = useStore()

  return (
    <div className="px-3 py-2 border-b border-sidebar-border">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Database size={12} />
        <span>SERVER</span>
      </div>
      <select
        value={server ?? ''}
        onChange={e => setServer(e.target.value || null)}
        className="w-full bg-sidebar text-sidebar-foreground text-sm rounded border border-sidebar-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sidebar-ring"
      >
        <option value="">— select server —</option>
        {servers.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  )
}
