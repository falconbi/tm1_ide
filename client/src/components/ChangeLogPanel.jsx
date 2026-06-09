import { useState } from 'react'
import { X, ChevronRight, ChevronDown, Clock, Box, Layers, Cog, FileText, Table2, List, Tag, Loader2 } from 'lucide-react'
import { useWorkSessions, useWorkSessionLog } from '@/hooks/useApi'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

const ACTION_META = {
  RULES_SAVED:        { label: 'Rules saved',        icon: FileText, colour: 'text-amber-400' },
  PROCESS_SAVED:      { label: 'Process saved',       icon: Cog,      colour: 'text-blue-400' },
  PROCESS_CREATED:    { label: 'Process created',     icon: Cog,      colour: 'text-emerald-400' },
  PROCESS_DELETED:    { label: 'Process deleted',     icon: Cog,      colour: 'text-red-400' },
  DIMENSION_CREATED:  { label: 'Dimension created',   icon: Layers,   colour: 'text-emerald-400' },
  DIMENSION_DELETED:  { label: 'Dimension deleted',   icon: Layers,   colour: 'text-red-400' },
  CUBE_CREATED:       { label: 'Cube created',        icon: Box,      colour: 'text-emerald-400' },
  CUBE_DELETED:       { label: 'Cube deleted',        icon: Box,      colour: 'text-red-400' },
  SUBSET_SAVED:       { label: 'Subset saved',        icon: List,     colour: 'text-blue-400' },
  SUBSET_DELETED:     { label: 'Subset deleted',      icon: List,     colour: 'text-red-400' },
  VIEW_SAVED:         { label: 'View saved',          icon: Table2,   colour: 'text-blue-400' },
  ATTRIBUTE_CREATED:  { label: 'Attribute created',   icon: Tag,      colour: 'text-emerald-400' },
  ATTRIBUTE_DELETED:  { label: 'Attribute deleted',   icon: Tag,      colour: 'text-red-400' },
}

function fmtTime(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return ts }
}

function fmtDate(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) } catch { return ts }
}

function LogEntry({ entry, openTab, server }) {
  const meta = ACTION_META[entry.action] ?? { label: entry.action, icon: FileText, colour: 'text-muted-foreground' }
  const Icon = meta.icon

  const handleClick = () => {
    if (!openTab) return
    if (entry.object_type === 'rules')     openTab({ id: `rules:${server}:${entry.object_name}`, type: 'rules', label: `Rules: ${entry.object_name}`, server, cube: entry.object_name })
    if (entry.object_type === 'process')   openTab({ id: `process:${server}:${entry.object_name}`, type: 'process', label: entry.object_name, server, processName: entry.object_name })
    if (entry.object_type === 'dimension') openTab({ id: `dimension:${server}:${entry.object_name}`, type: 'dimension', label: entry.object_name, server, dimension: entry.object_name })
    if (entry.object_type === 'view')      openTab({ id: `cubeview:${server}:${entry.detail}:${entry.object_name}`, type: 'cubeview', label: entry.object_name, server, cube: entry.detail, viewName: entry.object_name })
    if (entry.object_type === 'subset')    openTab({ id: `subset:${server}:${entry.detail}:${entry.object_name}`, type: 'subset', label: entry.object_name, server, dimension: entry.detail, subsetName: entry.object_name })
  }

  return (
    <div
      onClick={handleClick}
      className="flex items-center gap-2 px-3 py-1 hover:bg-muted/40 cursor-pointer group"
    >
      <Icon size={10} className={cn('shrink-0', meta.colour)} />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-mono truncate">{entry.object_name}</span>
        {entry.detail && <span className="text-[10px] text-muted-foreground/60 ml-1">· {entry.detail}</span>}
      </div>
      <span className="text-[10px] text-muted-foreground/50 shrink-0">{fmtTime(entry.timestamp)}</span>
    </div>
  )
}

function SessionRow({ session, server, openTab }) {
  const [open, setOpen] = useState(false)
  const { data: entries = [], isFetching } = useWorkSessionLog(open ? session.id : null)
  const isActive = !session.closed_at

  return (
    <div className="border-b border-border/40">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted/30 text-left"
      >
        {open ? <ChevronDown size={10} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={10} className="shrink-0 text-muted-foreground" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" />}
            <span className="text-xs font-medium truncate">{session.name}</span>
          </div>
          <div className="text-[10px] text-muted-foreground/60">
            {fmtDate(session.started_at)} · {session.entry_count} change{session.entry_count !== 1 ? 's' : ''}
          </div>
        </div>
      </button>

      {open && (
        <div className="bg-muted/10">
          {isFetching && <div className="flex items-center gap-1 px-4 py-2 text-[10px] text-muted-foreground"><Loader2 size={9} className="animate-spin" /> Loading…</div>}
          {!isFetching && entries.length === 0 && <div className="px-4 py-2 text-[10px] text-muted-foreground italic">No entries yet.</div>}
          {entries.map(e => <LogEntry key={e.id} entry={e} openTab={openTab} server={server} />)}
        </div>
      )}
    </div>
  )
}

export default function ChangeLogPanel({ server, onClose }) {
  const { openTab } = useStore()
  const { data: sessions = [], isFetching } = useWorkSessions(server)

  return (
    <div className="absolute bottom-6 right-0 w-[400px] bg-popover border border-border rounded-lg shadow-xl z-50 flex flex-col overflow-hidden" style={{ maxHeight: 480 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <Clock size={13} className="text-muted-foreground" />
          <span className="text-xs font-semibold">Change Log</span>
          {isFetching && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
          <X size={12} />
        </button>
      </div>

      {/* Sessions list */}
      <div className="overflow-auto flex-1">
        {sessions.length === 0 && !isFetching && (
          <p className="px-4 py-8 text-xs text-muted-foreground italic text-center">No sessions yet. Start a session to begin logging changes.</p>
        )}
        {sessions.map(s => (
          <SessionRow key={s.id} session={s} server={server} openTab={openTab} />
        ))}
      </div>
    </div>
  )
}
