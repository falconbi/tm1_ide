import { useState, useMemo } from 'react'
import { Copy, ScrollText, Loader2, ChevronRight, ChevronDown, Box, Layers, Cog, Table2, List, Sigma, FileText, Tag, Diff } from 'lucide-react'
import { useWorkSessions, useWorkSessionLog, useWorkSessionLogVerbose } from '@/hooks/useApi'
import { autoDescription } from '@/components/ChangeLogPanel'
import { useStore } from '@/store'
import { toast } from 'sonner'

function fmtDate(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) } catch { return ts }
}

function fmtTime(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return ts }
}

function ChevronToggle({ open, onClick, className = '' }) {
  return (
    <button onClick={onClick} className={`shrink-0 mr-1.5 text-muted-foreground hover:text-foreground ${className}`}>
      {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
    </button>
  )
}

function CollapsibleSection({ label, icon: Icon, count, defaultOpen = true, children, className = '' }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={className}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wider"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Icon size={12} />
        <span>{label}</span>
        {count != null && <span className="text-[10px] text-muted-foreground/40 ml-auto">{count}</span>}
      </button>
      {open && children}
    </div>
  )
}

function DiffButton({ entry, openTab, server }) {
  const hasDiff = !!(entry.before_state && entry.after_state)
  if (!hasDiff) return null
  return (
    <button
      onClick={e => {
        e.stopPropagation()
        openTab({
          id: `diff:log:${entry.id}`,
          type: 'diff',
          label: `Diff: ${entry.object_name}`,
          server,
          objectType: entry.object_type,
          before: entry.before_state,
          after: entry.after_state,
        })
      }}
      title="View diff"
      className="p-1 rounded hover:bg-muted text-emerald-400 hover:text-emerald-300 transition-colors"
    >
      <Diff size={10} />
    </button>
  )
}

function EntryRow({ icon: Icon, entry, server, openTab, allSaves = [] }) {
  const [showAll, setShowAll] = useState(false)
  const hasMultiple = allSaves.length > 1

  return (
    <>
      <div className="flex items-center gap-2 pl-14 pr-3 py-1 text-xs border-l-2 border-border/30 ml-[13px] group hover:bg-muted/20">
        {hasMultiple && (
          <button onClick={() => setShowAll(o => !o)} className="shrink-0 -ml-4 text-muted-foreground hover:text-foreground">
            {showAll ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          </button>
        )}
        <Icon size={10} className="shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <span className="font-mono truncate block">{entry.object_name}</span>
          <span className="text-[10px] text-muted-foreground/60 truncate block">
            {autoDescription(entry.action, entry.object_name, entry.detail)}
            {hasMultiple && <span className="text-muted-foreground/40 ml-1">· saved {allSaves.length}x</span>}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/40 shrink-0 font-mono">{fmtTime(entry.timestamp)}</span>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center">
          <DiffButton entry={entry} openTab={openTab} server={server} />
        </div>
      </div>
      {showAll && hasMultiple && allSaves.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2 pl-20 pr-3 py-0.5 text-[10px] text-muted-foreground/50 border-l border-border/20 ml-[22px] group hover:bg-muted/10">
          <span className="text-muted-foreground/30 w-14 shrink-0">{i === 0 ? 'seeded' : i < allSaves.length - 1 ? `save #${i}` : ''}</span>
          <span className="font-mono">{fmtTime(s.timestamp)}</span>
          <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            {s !== entry && s.before_state && s.after_state && (
              <DiffButton entry={s} openTab={openTab} server={server} />
            )}
          </div>
        </div>
      ))}
    </>
  )
}

function CubeTree({ cube, views, rules, cubeEntries, server, openTab, saveKeyMap }) {
  const [open, setOpen] = useState(true)
  const [viewsOpen, setViewsOpen] = useState(true)
  const hasViews = views.length > 0
  const hasRules = rules.length > 0
  const getSaves = e => saveKeyMap[`${e.object_type}::${e.object_name}::${e.action}`] ?? [e]

  return (
    <div>
      <div className="flex items-center w-full px-6 py-0.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group">
        <ChevronToggle open={open} onClick={() => setOpen(o => !o)} />
        <Box size={12} className="shrink-0 text-muted-foreground mr-2" />
        <span className="truncate flex-1 text-left">{cube}</span>
        <span className="text-[10px] text-muted-foreground/40">{views.length + rules.length + cubeEntries.length}</span>
      </div>
      {open && <>
        {hasViews && (
          <div>
            <button
              onClick={() => setViewsOpen(o => !o)}
              className="flex items-center gap-1 w-full px-9 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold hover:text-muted-foreground"
            >
              {viewsOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              Views
              <span className="text-[9px] text-muted-foreground/40 ml-1">({views.length})</span>
            </button>
            {viewsOpen && views.map(e => (
              <EntryRow key={e.id} icon={Table2} entry={e} server={server} openTab={openTab} allSaves={getSaves(e)} />
            ))}
          </div>
        )}
        {hasRules && rules.map(e => (
          <EntryRow key={e.id} icon={Sigma} entry={e} server={server} openTab={openTab} allSaves={getSaves(e)} />
        ))}
        {cubeEntries.length > 0 && cubeEntries.map(e => (
          <EntryRow key={e.id} icon={Box} entry={e} server={server} openTab={openTab} allSaves={getSaves(e)} />
        ))}
      </>}
    </div>
  )
}

function DimTree({ dim, subsets, entries, server, openTab, saveKeyMap }) {
  const [open, setOpen] = useState(true)
  const [subsOpen, setSubsOpen] = useState(true)
  const hasSubs = subsets.length > 0
  const getSaves = e => saveKeyMap[`${e.object_type}::${e.object_name}::${e.action}`] ?? [e]

  return (
    <div>
      <div className="flex items-center w-full px-6 py-0.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group">
        <ChevronToggle open={open} onClick={() => setOpen(o => !o)} />
        <Layers size={12} className="shrink-0 text-muted-foreground mr-2" />
        <span className="truncate flex-1 text-left">{dim}</span>
        <span className="text-[10px] text-muted-foreground/40">{subsets.length + entries.length}</span>
      </div>
      {open && <>
        {hasSubs && (
          <div>
            <button
              onClick={() => setSubsOpen(o => !o)}
              className="flex items-center gap-1 w-full px-9 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold hover:text-muted-foreground"
            >
              {subsOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              Subsets
              <span className="text-[9px] text-muted-foreground/40 ml-1">({subsets.length})</span>
            </button>
            {subsOpen && subsets.map(e => (
              <EntryRow key={e.id} icon={List} entry={e} server={server} openTab={openTab} allSaves={getSaves(e)} />
            ))}
          </div>
        )}
        {entries.map(e => {
          const entryIcon = e.action === 'ATTRIBUTE_CREATED' || e.action === 'ATTRIBUTE_DELETED' ? Tag : Layers
          return <EntryRow key={e.id} icon={entryIcon} entry={e} server={server} openTab={openTab} allSaves={getSaves(e)} />
        })}
      </>}
    </div>
  )
}

function ProcessEntryRow({ entry, server, openTab, allSaves = [] }) {
  const [showAll, setShowAll] = useState(false)
  const hasMultiple = allSaves.length > 1

  return (
    <>
      <div className="flex items-center gap-2 pl-6 pr-3 py-1 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground min-w-0 group">
        {hasMultiple && (
          <button onClick={() => setShowAll(o => !o)} className="shrink-0 text-muted-foreground hover:text-foreground">
            {showAll ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          </button>
        )}
        <Cog size={10} className="shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <span className="font-mono truncate block">{entry.object_name}</span>
          <span className="text-[10px] text-muted-foreground/60 truncate block">
            {autoDescription(entry.action, entry.object_name, entry.detail)}
            {hasMultiple && <span className="text-muted-foreground/40 ml-1">· saved {allSaves.length}x</span>}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/40 shrink-0 font-mono">{fmtTime(entry.timestamp)}</span>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center">
          <DiffButton entry={entry} openTab={openTab} server={server} />
        </div>
      </div>
      {showAll && hasMultiple && allSaves.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2 pl-14 pr-3 py-0.5 text-[10px] text-muted-foreground/50 border-l border-border/20 ml-[22px] group hover:bg-muted/10">
          <span className="text-muted-foreground/30 w-14 shrink-0">{i === 0 ? 'seeded' : i < allSaves.length - 1 ? `save #${i}` : ''}</span>
          <span className="font-mono">{fmtTime(s.timestamp)}</span>
          <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            {s !== entry && s.before_state && s.after_state && (
              <DiffButton entry={s} openTab={openTab} server={server} />
            )}
          </div>
        </div>
      ))}
    </>
  )
}

export default function SessionReportTab({ tab }) {
  const { openTab } = useStore()
  const { session: tabSession } = tab
  const { data: sessions = [] } = useWorkSessions(tab.server)
  const session = sessions.find(s => s.id === tabSession?.id) ?? tabSession
  const { data: entries = [], isFetching } = useWorkSessionLog(session?.id)
  const { data: verboseLog = [] } = useWorkSessionLogVerbose(session?.id)

  const saveKeyMap = useMemo(() => {
    const map = {}
    for (const e of verboseLog) {
      const key = `${e.object_type}::${e.object_name}::${e.action}`
      if (!map[key]) map[key] = []
      map[key].push(e)
    }
    return map
  }, [verboseLog])

  const tree = useMemo(() => {
    const cubes = {}
    const dimensions = {}
    const processes = []

    for (const e of entries) {
      switch (e.object_type) {
        case 'view': {
          const cube = e.detail || '(unknown)'
          if (!cubes[cube]) cubes[cube] = { views: [], rules: [], cubeEntries: [] }
          cubes[cube].views.push(e)
          break
        }
        case 'rules': {
          if (!cubes[e.object_name]) cubes[e.object_name] = { views: [], rules: [], cubeEntries: [] }
          cubes[e.object_name].rules.push(e)
          break
        }
        case 'cube': {
          if (!cubes[e.object_name]) cubes[e.object_name] = { views: [], rules: [], cubeEntries: [] }
          cubes[e.object_name].cubeEntries.push(e)
          break
        }
        case 'subset': {
          const dim = e.detail || '(unknown)'
          if (!dimensions[dim]) dimensions[dim] = { subsets: [], entries: [] }
          dimensions[dim].subsets.push(e)
          break
        }
        case 'dimension': {
          const dim = e.detail || e.object_name
          if (!dimensions[dim]) dimensions[dim] = { subsets: [], entries: [] }
          dimensions[dim].entries.push(e)
          break
        }
        case 'process': {
          processes.push(e)
          break
        }
      }
    }
    return { cubes, dimensions, processes }
  }, [entries])

  const hasCubes = Object.keys(tree.cubes).length > 0
  const hasDims = Object.keys(tree.dimensions).length > 0
  const hasProcs = tree.processes.length > 0

  const copyText = () => {
    const lines = []
    lines.push(`Change Set: ${session.name} — ${fmtDate(session.started_at)}`)
    if (session.description) lines.push(`Note: ${session.description}`)
    lines.push('─'.repeat(52))

    const writeEntries = (entries, indent = 0) => {
      for (const e of entries) {
        const saves = saveKeyMap[`${e.object_type}::${e.object_name}::${e.action}`] ?? []
        const suffix = saves.length > 1 ? ` (saved ${saves.length}x)` : ''
        lines.push(`${'  '.repeat(indent)}${fmtTime(e.timestamp)}  ${autoDescription(e.action, e.object_name, e.detail)}${suffix}`)
      }
    }

    for (const [cube, data] of Object.entries(tree.cubes)) {
      lines.push(`\n  ${cube}`)
      if (data.views.length) {
        lines.push(`    Views (${data.views.length})`)
        for (const e of data.views) {
          lines.push(`      ${e.object_name}  ${fmtTime(e.timestamp)}`)
        }
      }
      if (data.rules.length) writeEntries(data.rules, 3)
      if (data.cubeEntries.length) writeEntries(data.cubeEntries, 2)
    }

    for (const [dim, data] of Object.entries(tree.dimensions)) {
      lines.push(`\n  ${dim}`)
      if (data.subsets.length) {
        lines.push(`    Subsets (${data.subsets.length})`)
        for (const e of data.subsets) lines.push(`      ${e.object_name}  ${fmtTime(e.timestamp)}`)
      }
      writeEntries(data.entries, 2)
    }

    if (tree.processes.length) {
      lines.push(`\n  Processes (${tree.processes.length})`)
      writeEntries(tree.processes, 1)
    }

    lines.push(`\n${'─'.repeat(52)}`)
    lines.push(`${verboseLog.length} change${verboseLog.length !== 1 ? 's' : ''} total · ${entries.length} objects`)
    navigator.clipboard.writeText(lines.join('\n'))
    toast.success('Copied to clipboard')
  }

  if (isFetching) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <Loader2 size={14} className="animate-spin mr-2" /> Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <ScrollText size={14} className="text-muted-foreground shrink-0" />
          <div>
            <div className="text-sm font-semibold">{session.name}</div>
            <div className="text-[10px] text-muted-foreground">
              {fmtDate(session.started_at)}
              {session.closed_at ? ` → ${fmtDate(session.closed_at)}` : ' · active'}
            </div>
            {session.description && (
              <div className="text-[11px] text-foreground/70 mt-0.5 italic">{session.description}</div>
            )}
          </div>
        </div>
        <button
          onClick={copyText}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Copy size={11} /> Copy as text
        </button>
      </div>

      <div className="flex-1 overflow-auto py-1 text-sm">
        {entries.length === 0 && (
          <p className="px-4 py-4 text-sm text-muted-foreground italic">No changes recorded in this session.</p>
        )}

        {hasCubes && (
          <CollapsibleSection label="Cubes" icon={Box} count={Object.keys(tree.cubes).length}>
            {Object.entries(tree.cubes).map(([cube, data]) => (
              <CubeTree key={cube} cube={cube} {...data} server={tab.server} openTab={openTab} saveKeyMap={saveKeyMap} />
            ))}
          </CollapsibleSection>
        )}

        {hasDims && (
          <CollapsibleSection label="Dimensions" icon={Layers} count={Object.keys(tree.dimensions).length}>
            {Object.entries(tree.dimensions).map(([dim, data]) => (
              <DimTree key={dim} dim={dim} {...data} server={tab.server} openTab={openTab} saveKeyMap={saveKeyMap} />
            ))}
          </CollapsibleSection>
        )}

        {hasProcs && (
          <CollapsibleSection label="Processes" icon={Cog} count={tree.processes.length}>
            <div className="pb-1">
              {tree.processes.map(e => {
                const saves = saveKeyMap[`${e.object_type}::${e.object_name}::${e.action}`] ?? [e]
                return <ProcessEntryRow key={e.id} entry={e} server={tab.server} openTab={openTab} allSaves={saves} />
              })}
            </div>
          </CollapsibleSection>
        )}

        {entries.length > 0 && (
          <div className="px-3 pt-2 pb-2 border-t border-border mt-1 text-[10px] text-muted-foreground">
            {verboseLog.length} change{verboseLog.length !== 1 ? 's' : ''} total · {entries.length} objects
          </div>
        )}
      </div>
    </div>
  )
}
