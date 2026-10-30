import { useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/store'

const LAST_SAVED_KEY = 'tm1-save-data-last'

function readLastSaved() {
  try { return JSON.parse(localStorage.getItem(LAST_SAVED_KEY)) ?? {} } catch { return {} }
}

function timeLabel(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function SaveDataButton() {
  const { server, token } = useStore()
  const [busy, setBusy] = useState(false)
  const [lastByServer, setLastByServer] = useState(readLastSaved)
  const lastSaved = server ? lastByServer[server] ?? null : null

  const save = async () => {
    if (!server || busy) return
    if (!window.confirm(`Write all changed data on ${server} to disk now? The server pauses briefly.`)) return

    setBusy(true)
    try {
      const r = await fetch('/api/server/save-data-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ide-token': token ?? localStorage.getItem('tm1-token') ?? '' },
        body: JSON.stringify({ server }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Save failed (${r.status})`)

      const at = d.savedAt ?? new Date().toISOString()
      const next = { ...lastByServer, [server]: at }
      try { localStorage.setItem(LAST_SAVED_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      setLastByServer(next)

      const t = new Date(at)
      const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      toast.success(`Data saved on ${server} at ${hhmm}`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const last = timeLabel(lastSaved)
  const title = !server
    ? 'Select a server first'
    : busy
      ? `Saving data on ${server}…`
      : `Write all changed data on ${server} to disk.\nLast saved from the IDE: ${last ?? 'never'}`

  return (
    <button
      onClick={save}
      disabled={!server || busy}
      title={title}
      className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
      Save data
    </button>
  )
}
