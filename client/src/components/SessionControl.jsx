import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Clock, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { useActiveWorkSession, useStartWorkSession } from '@/hooks/useApi'
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
    <div className="absolute top-10 right-0 w-72 bg-popover border border-border rounded-lg shadow-xl z-[60] p-3">
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

export default function SessionControl({ deploy = null }) {
  const { server } = useStore()
  const [showModal, setShowModal] = useState(false)
  const [showLog,   setShowLog]   = useState(false)
  const wrapRef = useRef(null)

  const qc = useQueryClient()
  const { data: activeSession } = useActiveWorkSession(server)

  // A first-save may auto-start a change set (api wrapper) — keep the bar fresh.
  useEffect(() => {
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['work-session-active'] })
      qc.invalidateQueries({ queryKey: ['work-sessions'] })
    }
    window.addEventListener('tm1-sessions-changed', refresh)
    return () => window.removeEventListener('tm1-sessions-changed', refresh)
  }, [qc])

  // Deploy Center closes back to the Change Sets panel.
  useEffect(() => {
    const open = () => { setShowLog(true); setShowModal(false) }
    window.addEventListener('tm1-open-change-sets', open)
    return () => window.removeEventListener('tm1-open-change-sets', open)
  }, [])

  // Close the panel/modal when clicking outside the control.
  useEffect(() => {
    if (!showLog && !showModal) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setShowLog(false)
        setShowModal(false)
      }
    }
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        setShowLog(false)
        setShowModal(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [showLog, showModal])

  if (!server) return null

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1">
      {(showLog || showModal) && (
        <div
          className="fixed inset-0 z-40"
          onMouseDown={() => { setShowLog(false); setShowModal(false) }}
        />
      )}
      <button
        onClick={() => { setShowLog(v => !v); setShowModal(false) }}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
          showLog ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        )}
        title="Change sets — current, previous, and start a new one"
      >
        {activeSession
          ? <Circle size={7} className="fill-emerald-500 text-emerald-500 animate-pulse" />
          : <Clock size={13} />}
        <span
          className="font-medium max-w-[480px] truncate"
          title={activeSession ? `Change set: ${activeSession.name}` : 'Change sets'}
        >
          {activeSession
            ? `Change set: ${activeSession.name} · ${activeSession.entry_count ?? 0} changes`
            : 'Change sets'}
        </span>
      </button>

      {showModal && <StartModal server={server} onClose={() => setShowModal(false)} onStart={() => setShowLog(true)} />}
      {/* New closes the list first: both surfaces are anchored to this button and
          share its space, and the panel (also z-50, rendered later) would paint
          over the form and make Cancel/Start unclickable. */}
      {showLog   && <ChangeLogPanel server={server} onClose={() => setShowLog(false)} direction="down" onNew={() => { setShowLog(false); setShowModal(true) }} deploy={deploy} />}
    </div>
  )
}
