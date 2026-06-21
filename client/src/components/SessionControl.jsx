import { useState } from 'react'
import { Clock, Circle, X, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { useActiveWorkSession, useStartWorkSession, useCloseWorkSession } from '@/hooks/useApi'
import ChangeLogPanel from '@/components/ChangeLogPanel'

function StartModal({ server, onClose, onStart }) {
  const [name, setName] = useState('')
  const start    = useStartWorkSession()
  const username = useStore(s => s.username)

  const handleStart = async () => {
    if (!name.trim()) return
    await start.mutateAsync({ name: name.trim(), server, user: username })
    onStart?.()
    onClose()
  }

  return (
    <div className="absolute top-10 right-0 w-72 bg-popover border border-border rounded-lg shadow-xl z-50 p-3">
      <div className="text-xs font-semibold mb-2">Start Change Set</div>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleStart(); if (e.key === 'Escape') onClose() }}
        placeholder="e.g. budget-fix, q1-load…"
        className="w-full bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring mb-2"
      />
      <div className="flex gap-1.5 justify-end">
        <button onClick={onClose} className="px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted">Cancel</button>
        <button onClick={handleStart} disabled={!name.trim() || start.isPending}
          className="px-2.5 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40">
          Start
        </button>
      </div>
    </div>
  )
}

export default function SessionControl() {
  const { server } = useStore()
  const [showModal, setShowModal]     = useState(false)
  const [showLog,   setShowLog]       = useState(false)

  const { data: activeSession } = useActiveWorkSession(server)
  const closeSession = useCloseWorkSession()

  if (!server) return null

  return (
    <div className="relative flex items-center gap-1">
      {activeSession ? (
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowLog(v => !v); setShowModal(false) }}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
              showLog ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
            title="View change set log"
          >
            <Circle size={7} className="fill-emerald-500 text-emerald-500 animate-pulse" />
            <Clock size={13} />
            <span className="font-medium max-w-[140px] truncate">{activeSession.name}</span>
          </button>
          <button
            onClick={() => closeSession.mutateAsync({ id: activeSession.id })}
            title="Close change set"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowModal(v => !v); setShowLog(false) }}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
              showModal ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
            title="Start a change set to track changes"
          >
            <Clock size={13} />
            <span>Change set</span>
          </button>
          <button
            onClick={() => { setShowLog(v => !v); setShowModal(false) }}
            className={cn(
              'p-1.5 rounded transition-colors',
              showLog ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
            title="View change set log"
          >
            <History size={13} />
          </button>
        </div>
      )}

{showModal && <StartModal server={server} onClose={() => setShowModal(false)} onStart={() => setShowLog(true)} />}
      {showLog   && <ChangeLogPanel server={server} onClose={() => setShowLog(false)} direction="down" />}
    </div>
  )
}
