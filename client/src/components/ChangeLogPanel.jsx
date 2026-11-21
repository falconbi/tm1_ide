import { request } from '@/lib/api'
import { useState, useRef, useEffect } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { X, ChevronRight, ChevronDown, Clock, Box, Layers, Cog, FileText, FileCheck, Table2, List, Tag, Loader2, Diff, Pencil, RotateCcw, HelpCircle, Plus, Rocket } from 'lucide-react'
import HelpPanel from '@/components/HelpPanel'
import DiffViewerModal from '@/components/DiffViewerModal'
import { useWorkSessions, useWorkSessionLog, useWorkSessionLogVerbose, useUpdateSessionDescription, useResumeWorkSession, useServerLogins } from '@/hooks/useApi'
import { useStore } from '@/store'
import { SESSIONS_LIMIT } from '@/lib/deploy/change-sets'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { rulesTabId, processTabId, dimensionTabId, viewTabId, subsetTabId } from '@/lib/tab-ids'
import { buildSessionSummary } from '@/lib/deploy/session-summary'

const authHeader = () => ({ 'Content-Type': 'application/json', 'x-ide-token': localStorage.getItem('tm1-token') ?? '' })


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
  VIEW_DELETED:       { label: 'View deleted',        icon: Table2,   colour: 'text-red-400' },
  ATTRIBUTE_CREATED:  { label: 'Attribute created',   icon: Tag,      colour: 'text-emerald-400' },
  ATTRIBUTE_DELETED:  { label: 'Attribute deleted',   icon: Tag,      colour: 'text-red-400' },
  ATTRIBUTE_VALUE_SET:{ label: 'Attribute value set', icon: Tag,      colour: 'text-amber-400' },
  ASSERTION_ADDED:    { label: 'Assertion added',     icon: FileCheck, colour: 'text-emerald-400' },
  ASSERTION_REMOVED:  { label: 'Assertion removed',   icon: FileCheck, colour: 'text-red-400' },
  ELEMENT_ADDED:      { label: 'Element added',       icon: Layers,   colour: 'text-emerald-400' },
  ELEMENT_DELETED:    { label: 'Element deleted',     icon: Layers,   colour: 'text-red-400' },
  ELEMENT_RENAMED:    { label: 'Element renamed',     icon: Layers,   colour: 'text-amber-400' },
  ELEMENT_LINKED:     { label: 'Element linked',      icon: Layers,   colour: 'text-blue-400' },
  HIERARCHY_CREATED:  { label: 'Hierarchy created',   icon: Layers,   colour: 'text-emerald-400' },
  HIERARCHY_DELETED:  { label: 'Hierarchy deleted',   icon: Layers,   colour: 'text-red-400' },
  EDGE_REMOVED:       { label: 'Parent removed',     icon: Layers,   colour: 'text-amber-400' },
  PROCESS_RUN:        { label: 'Process run',        icon: Cog,      colour: 'text-sky-400' },
  ROLLED_BACK:        { label: 'Rolled back',        icon: FileText, colour: 'text-purple-400' },
}

function fmtTime(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return ts }
}

function fmtDate(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) } catch { return ts }
}

function LogEntry({ entry, server, openTab, onDiff }) {
  const meta = ACTION_META[entry.action] ?? { label: entry.action, icon: FileText, colour: 'text-muted-foreground' }
  const Icon = meta.icon
  const hasDiff = !!(entry.before_state && entry.after_state)

  // The diff opens here, over the panel — not as another tab. Opening a second
  // surface to read one change made the list hard to follow.
  const openDiff = () => onDiff?.(entry)

  const handleClick = () => {
    if (!openTab) return
    if (entry.object_type === 'rules')     openTab({ id: rulesTabId(server, entry.object_name),     type: 'rules',     label: `Rules: ${entry.object_name}`, server, cube: entry.object_name })
    if (entry.object_type === 'process')   openTab({ id: processTabId(server, entry.object_name),   type: 'process',   label: entry.object_name, server, name: entry.object_name })
    if (entry.object_type === 'dimension') openTab({ id: dimensionTabId(server, entry.object_name, entry.object_name), type: 'dimension', label: entry.object_name, server, dimension: entry.object_name })
    if (entry.object_type === 'view')      openTab({ id: viewTabId(server, entry.detail, entry.object_name), type: 'cubeview', label: entry.object_name, server, cube: entry.detail, viewName: entry.object_name })
    if (entry.object_type === 'subset')    openTab({ id: subsetTabId(server, entry.detail, entry.detail, entry.object_name),   type: 'subset',   label: entry.object_name, server, dimension: entry.detail, subsetName: entry.object_name })
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1 hover:bg-muted/40 group">
      <button onClick={handleClick} className="flex items-center gap-2 flex-1 min-w-0 text-left">
        <Icon size={10} className={cn('shrink-0', meta.colour)} />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-mono truncate">{entry.object_name}</span>
          {entry.detail && <span className="text-[10px] text-muted-foreground/60 ml-1">· {entry.detail}</span>}
        </div>
        <span className="text-[10px] text-muted-foreground/50 shrink-0">{fmtTime(entry.timestamp)}</span>
      </button>

      {/* Diff / rollback actions — visible on hover */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {hasDiff && (
          <button
            onClick={openDiff}
            title="View diff"
            className="p-1 rounded hover:bg-muted text-emerald-500/70 hover:text-emerald-400 transition-colors"
          >
            <Diff size={10} />
          </button>
        )}
      </div>
    </div>
  )
}

function SessionRow({ session, server, openTab, onClose, currentUser, isAdmin = false, onDiff }) {
  const { openDeployWizard } = useStore()
  const [open, setOpen]           = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  // A draft only exists while the user is editing; otherwise the text follows the
  // session. Keeping it derived means a saved description (or one changed by
  // someone else) shows up without an effect copying props into state.
  const [descDraft, setDescDraft]     = useState(null)
  const descValue = descDraft ?? session.description ?? ''
  const descRef = useRef(null)
  const updateDesc = useUpdateSessionDescription()
  const resume     = useResumeWorkSession()
  const qc         = useQueryClient()
  // Retire keeps the history and stops the set being offered as shippable.
  // Automatic phantom detection only covers sets whose objects disappeared.
  const retire = useMutation({
    mutationFn: async ({ id, restore }) => {
      const r = await request(`/api/sessions/${id}/${restore ? 'unretire' : 'retire'}`, {
        method: 'POST', headers: authHeader(), body: JSON.stringify({}),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      return d
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-sessions', server] })
      qc.invalidateQueries({ queryKey: ['work-session-active', server] })
    },
    onError: e => toast.error(e.message ?? 'Could not retire this change set'),
  })
  const { data: entries = [], isFetching } = useWorkSessionLog(open ? session.id : null)
  // Only while the row is open — this is the "saved Nx" detail, not something
  // every row in the list should fetch.
  const { data: verboseLog = [] } = useWorkSessionLogVerbose(open ? session.id : null)
  const runs = entries.filter(e => e.object_type === 'process-run')
  const changes = entries.filter(e => e.object_type !== 'process-run')

  // The old "report" tab added exactly one thing the panel could not: pasteable
  // text. Offer that here instead of opening another surface.
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(buildSessionSummary({ session, entries, verboseLog }))
      toast.success('Summary copied')
    } catch { toast.error('Could not copy the summary') }
  }
  const isActive = !session.closed_at
  const owns = isAdmin || !session.user || !currentUser || String(session.user).toLowerCase() === String(currentUser).toLowerCase()

  useEffect(() => { if (editingDesc) descRef.current?.focus() }, [editingDesc])

  const saveDesc = () => {
    setEditingDesc(false)
    const next = descValue.trim() || null
    setDescDraft(null)   // follow the session (and the refetch) again
    updateDesc.mutate({ id: session.id, description: next, server })
  }

  return (
    <>
      <div className="border-b border-border/40">
        <div className="flex items-center group">
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 hover:bg-muted/30 text-left"
          >
            {open
              ? <ChevronDown  size={10} className="shrink-0 text-muted-foreground" />
              : <ChevronRight size={10} className="shrink-0 text-muted-foreground" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" />}
                <span className="text-xs font-medium truncate">{session.name}</span>
                {session.deployed && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 shrink-0">Deployed</span>
                )}
                {(session.phantom || session.wont_deploy_at) && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0" title="No touched objects remain on this server — history only">Phantom — empty</span>
                )}
                {session.covered_by && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0" title="Carried by a catch-up release">Covered by catch-up{session.covered_at ? ` ${fmtDate(session.covered_at)}` : ''}</span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground/60">
                {fmtDate(session.started_at)} · {session.entry_count} change{session.entry_count !== 1 ? 's' : ''}{session.user ? ` · ${session.user}` : ''}
              </div>
              {(session.commit_ref || session.deployed_target || session.close_tests) && (() => {
                let t
                try { t = session.close_tests ? JSON.parse(session.close_tests) : null } catch { t = null }
                return (
                  <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                    {session.commit_ref && <span>commit {session.commit_ref}</span>}
                    {t && <span>{session.commit_ref ? ' · ' : ''}tests at close {t.passed}/{t.total}{t.blocking ? ` (${t.blocking} blocking)` : ''}</span>}
                    {session.deployed_target && <span>{session.commit_ref || t ? ' · ' : ''}shipped to {session.deployed_target}</span>}
                  </div>
                )
              })()}
              {/* Clicking the note opens the editor. This sits inside the row's
                  toggle button, so it stays a plain div (not a nested button) and
                  stops the click; the hover pencil remains the keyboard path. */}
              {!editingDesc && (descValue
                ? <div
                    onClick={e => { e.stopPropagation(); setEditingDesc(true) }}
                    title="Edit note"
                    className="text-[10px] text-muted-foreground/80 truncate mt-0.5 italic cursor-pointer hover:text-foreground"
                  >{descValue}</div>
                : <div
                    onClick={e => { e.stopPropagation(); setEditingDesc(true) }}
                    title="Add a note"
                    className="text-[10px] text-muted-foreground/30 truncate mt-0.5 italic cursor-pointer hover:text-muted-foreground"
                  >Add a note…</div>
              )}

            </div>
          </button>
          {!isActive && owns && session.kind !== 'catch-up' && !session.deployed && !session.covered_by && !session.wont_deploy_at && (
            <button
              onClick={e => { e.stopPropagation(); resume.mutate({ id: session.id, server }) }}
              title="Resume this change set"
              className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded hover:bg-muted text-muted-foreground hover:text-amber-400 shrink-0"
            >
              <RotateCcw size={10} />
            </button>
          )}
          {!isActive && owns && session.closed_at && !session.deployed && !session.covered_by && (
            session.wont_deploy_at ? (
              <button
                onClick={e => { e.stopPropagation(); retire.mutate({ id: session.id, restore: true }) }}
                disabled={retire.isPending}
                title="Restore this change set so it can be released again"
                className="opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 mr-1 text-[10px] rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40"
              >
                Unretire
              </button>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); retire.mutate({ id: session.id }) }}
                disabled={retire.isPending}
                title="Retire this change set — keep its history, stop offering it as something to ship"
                className="opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 mr-1 text-[10px] rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40"
              >
                Retire
              </button>
            )
          )}
          {/* No Close here. Closing runs the whole model's assertions and records
              an immutable closed record — a gated step that belongs where the
              results are visible (the wizard's Test → Close), not on a row. The
              deploy button below says "Finish & deploy…" while the set is open,
              so this row still has one obvious way forward. */}
          {owns && <button
              onClick={e => { e.stopPropagation(); setEditingDesc(v => !v) }}
              title="Add / edit note"
              className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
            >
              <Pencil size={10} />
            </button>}
          {(session.entry_count ?? 0) > 0 && !session.phantom && !session.wont_deploy_at && !session.covered_by && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center mr-1">
              <button
                onClick={() => { openDeployWizard({ session }); onClose?.() }}
                title={isActive ? 'Run the tests, close it, then deploy' : 'Deploy this change set'}
                className="px-1.5 py-1 rounded text-[10px] font-medium text-emerald-500 hover:text-emerald-400 hover:bg-muted transition-colors"
              >
                {isActive ? 'Finish & deploy…' : 'Deploy'}
              </button>
            </div>
          )}
        </div>

        {editingDesc && (
          <div className="px-3 pb-2">
            <textarea
              ref={descRef}
              value={descValue}
              onChange={e => setDescDraft(e.target.value)}
              onBlur={saveDesc}
              onKeyDown={e => { if (e.key === 'Escape') { setEditingDesc(false); setDescDraft(null) } }}
              placeholder="Add a note about this change set…"
              rows={3}
              className="w-full text-[10px] bg-background border border-border rounded px-2 py-1 outline-none focus:border-primary text-foreground placeholder:text-muted-foreground/40 resize-none"
            />
            <div className="text-[9px] text-muted-foreground/40 mt-0.5">Blur or click away to save · Esc to cancel</div>
          </div>
        )}

        {open && (
          <div className="bg-muted/10">
            {isFetching && (
              <div className="flex items-center gap-1 px-4 py-2 text-[10px] text-muted-foreground">
                <Loader2 size={9} className="animate-spin" /> Loading…
              </div>
            )}
            {!isFetching && entries.length === 0 && (
              <div className="px-4 py-2 text-[10px] text-muted-foreground italic">No entries yet.</div>
            )}
            {changes.map(e => (
              <LogEntry
                key={e.id}
                entry={e}
                server={server}
                openTab={openTab}
                onDiff={onDiff}
              />
            ))}
            {runs.length > 0 && (
              <>
                <div className="px-3 py-1 mt-1 border-t border-border/40 text-[10px] uppercase tracking-wide text-muted-foreground">Processes run</div>
                {runs.map(e => (
                  <LogEntry
                    key={e.id}
                    entry={e}
                    server={server}
                    openTab={openTab}
                    onDiff={onDiff}
                  />
                ))}
              </>
            )}
            {entries.length > 0 && (
              <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-t border-border/40">
                <button
                  onClick={copySummary}
                  title="Copy this change set as plain text — grouped by cube, dimension and process"
                  className="px-1.5 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Copy summary
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

export default function ChangeLogPanel({ server, onClose, direction = 'up', onNew, deploy = null }) {
  // SessionRow opens the wizard itself; this panel only lists and links.
  const { openTab, username } = useStore()
  const { data: allSessions = [], isFetching } = useWorkSessions(server)
  const [showDeployed, setShowDeployed] = useState(false)
  const [showWontDeploy, setShowWontDeploy] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  // One diff at a time, shown over this panel instead of in another tab.
  const [diffEntry, setDiffEntry] = useState(null)

  // Once a change set has shipped it's not "in play" anymore -- its record
  // lives properly in Deploy History now. Keep this list to what's still
  // active or not yet deployed; deployed ones are one click away, not gone.
  // A phantom set has no surviving objects and is hidden the same way.
  const deployedCount = allSessions.filter(s => (s.deployed || s.covered_by) && !s.phantom && !s.wont_deploy_at).length
  const phantomCount = allSessions.filter(s => s.phantom || s.wont_deploy_at).length
  const sessions = allSessions.filter(s =>
    (showWontDeploy || (!s.phantom && !s.wont_deploy_at)) &&
    (showDeployed || (!s.deployed && !s.covered_by)))

  const { data: logins = [] } = useServerLogins()
  const isAdmin = logins.some(l => String(l?.name ?? '').toLowerCase() === String(server ?? '').toLowerCase() && l?.isAdmin)

  const posClass = direction === 'down'
    ? 'absolute top-full left-1/2 -translate-x-1/2 mt-1'
    : 'absolute bottom-6 left-1/2 -translate-x-1/2'

  return (
    <>
      <div className={cn(posClass, 'w-[960px] max-w-[calc(100vw-24px)] bg-popover border border-border rounded-lg shadow-xl z-50 flex flex-col overflow-hidden')} style={{ maxHeight: '70vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <Clock size={13} className="text-muted-foreground" />
            <span className="text-xs font-semibold">Change Sets</span>
            {isFetching && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
          </div>
          {deploy?.center && (
            <button
              onClick={() => { onClose?.(); deploy.center() }}
              title="Open Deploy Center"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Rocket size={10} /> Deploy
            </button>
          )}
          {onNew && (
            <button
              onClick={onNew}
              title="Start a new change set"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-emerald-500 hover:text-emerald-400 hover:bg-muted transition-colors"
            >
              <Plus size={11} /> New
            </button>
          )}
          <button onClick={() => setShowHelp(true)} title="Help — Change Sets" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <HelpCircle size={12} />
          </button>
          <button onClick={onClose} title="Close" aria-label="Close change sets" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={12} />
          </button>
        </div>
        {/* Sessions list */}
        <div className="overflow-auto flex-1">
          {sessions.length === 0 && !isFetching && (
            <p className="px-4 py-8 text-xs text-muted-foreground italic text-center">
              {allSessions.length === 0
                ? 'No change sets yet. Start a change set to begin tracking changes.'
                : 'Nothing in play — every other change set here is deployed, retired, or empty (phantom).'}
            </p>
          )}
          {sessions.map(s => (
            <SessionRow
              key={s.id}
              session={s}
              server={server}
              openTab={openTab}
              onClose={onClose}
              currentUser={username}
              isAdmin={isAdmin}
              onDiff={setDiffEntry}
            />
          ))}
        </div>

        {deployedCount > 0 && (
          <button
            onClick={() => setShowDeployed(v => !v)}
            className="shrink-0 px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-t border-border text-left"
          >
            {showDeployed ? 'Hide deployed' : `Show ${deployedCount} deployed`}
          </button>
        )}
        {phantomCount > 0 && (
          <button
            onClick={() => setShowWontDeploy(v => !v)}
            className="shrink-0 px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-t border-border text-left"
          >
            {showWontDeploy ? "Hide phantom" : `Show ${phantomCount} phantom`}
          </button>
        )}
        {/* Say so when the list is a page, not the whole history — the counts
            above are only totals when everything came back. */}
        {allSessions.length >= SESSIONS_LIMIT && (
          <p className="shrink-0 px-3 py-1.5 text-[10px] text-muted-foreground/70 border-t border-border">
            Showing the latest {SESSIONS_LIMIT} change sets.
          </p>
        )}
      </div>

      <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="changesets" />
      {diffEntry && <DiffViewerModal entry={diffEntry} onClose={() => setDiffEntry(null)} />}
    </>
  )
}
