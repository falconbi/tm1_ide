import { useEffect, useMemo, useState } from 'react'
import { Milestone, X, Copy, Workflow, ListOrdered, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { buildRunSequence } from '@/lib/run-sequence'
import { cn } from '@/lib/utils'

const KIND = {
  process:  { color: '#34d399', label: 'process' },
  read:     { color: '#38bdf8', label: 'read' },
  write:    { color: '#4ade80', label: 'write' },
  dimwrite: { color: '#a78bfa', label: 'dimension' },
  note:     { color: '#94a3b8', label: 'note' },
}

// Collapse the code-order sequence into the process tree it really is: a process's own
// reads/writes, with each ExecuteProcess dive as a collapsed sub-group.
function toTree(seq) {
  const root = { path: [], entry: null, items: [], children: [], order: -1 }
  const stack = [root]
  let order = 0
  for (const s of seq) {
    const path = s.path ?? []
    if (s.kind === 'process') {
      const node = { path, entry: s, items: [], children: [], order: order++ }
      const parent = path.slice(0, -1).join('>')
      while (stack.length > 1 && stack[stack.length - 1].path.join('>') !== parent) stack.pop()
      stack[stack.length - 1].children.push(node)
      stack.push(node)
    } else {
      while (stack.length > 1 && stack[stack.length - 1].path.join('>') !== path.join('>')) stack.pop()
      stack[stack.length - 1].items.push({ ...s, order: order++ })
    }
  }
  return root
}
const countSteps = n => n.items.length + n.children.reduce((a, c) => a + countSteps(c), 0)

function StepGroup({ node, depth, openPaths, toggle, affects }) {
  const key = node.path.join('>')
  const open = depth === 0 || openPaths.has(key)
  const rows = [
    ...node.items.map(x => ({ type: 'item', x })),
    ...node.children.map(c => ({ type: 'child', x: c })),
  ].sort((a, b) => a.x.order - b.x.order)
  return (
    <div>
      {depth > 0 && (
        <button onClick={() => toggle(key)}
          className="w-full flex items-center gap-1.5 px-4 py-1 text-left hover:bg-muted/40 transition-colors"
          style={{ paddingLeft: 16 + depth * 12 }}>
          {open ? <ChevronDown size={10} className="text-muted-foreground shrink-0" /> : <ChevronRight size={10} className="text-muted-foreground shrink-0" />}
          <span className="text-[10px] text-foreground/80">{node.entry?.caption}</span>
          <span className="ml-auto text-[9px] text-muted-foreground/50">{countSteps(node)} steps</span>
        </button>
      )}
      {open && rows.map((r, i) => r.type === 'child'
        ? <StepGroup key={r.x.path.join('>')} node={r.x} depth={depth + 1} openPaths={openPaths} toggle={toggle} affects={affects} />
        : (() => {
            const st = KIND[r.x.kind] ?? KIND.note
            return (
              <div key={i} className="flex items-start gap-2 px-4 py-0.5" style={{ paddingLeft: 16 + depth * 12 }}>
                <span className="w-5 shrink-0 text-right font-mono text-[9px] text-muted-foreground/50 mt-0.5">{i + 1}</span>
                <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: st.color }} />
                <span className="text-[10px] text-foreground/80 leading-relaxed">
                  {r.x.caption}
                  {r.x.kind === 'write' && affects(r.x.nodes?.[1])?.length > 0 && (
                    <span className="block text-[9px] text-amber-500/90">→ affects rules in {affects(r.x.nodes[1]).join(', ')}</span>
                  )}
                </span>
                <span className="ml-auto shrink-0 text-[8px] uppercase tracking-wider text-muted-foreground/40 mt-0.5">{st.label}</span>
              </div>
            )
          })())}
    </div>
  )
}

// The Runbook: a read-only view of a chore — the order its processes run in, what each one is for
// (its Prolog description), and what each does in code order, with the rule cubes each write sets
// off. It runs nothing. A master process that isn't on a chore is shown by giving it a chore
// (inactive if it should never run on a schedule) — the chore is where TM1 keeps a sequence.
export default function RunbookDialog({ open, onClose, server, processData, cubeData, chores, onOpenProcess, onOpenPhaseMap }) {
  const [active, setActive]     = useState(0)
  const [expanded, setExpanded] = useState(null)
  const [openPaths, setOpenPaths] = useState(() => new Set())
  const [info, setInfo]         = useState({})
  const [copied, setCopied]     = useState(false)

  // A chore belongs on the list when it runs at least one process of the model on screen.
  const list = useMemo(() => (chores ?? [])
    .filter(c => c.processes.some(p => processData?.[p]))
    .sort((a, b) => a.name.localeCompare(b.name)), [chores, processData])
  const chore = list[active] ?? null

  // Each process's description (its Prolog header, or a saved summary).
  useEffect(() => {
    if (!open) return
    setExpanded(null); setOpenPaths(new Set()); setCopied(false)
    let cancelled = false
    fetch(`/api/process/summaries?server=${encodeURIComponent(server)}`, { headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' } })
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d.processes)) setInfo(Object.fromEntries(d.processes.map(x => [x.process, x]))) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, server])

  // Rule cubes a write sets off: the cube's own rules, and every cube whose rules read it with DB().
  const affectsMap = useMemo(() => {
    const out = {}
    for (const [name, d] of Object.entries(cubeData ?? {})) {
      if (d.hasRules) (out[name] ??= []).push(name)
      for (const src of d.ruleCalcRefs ?? []) if (src !== name) (out[src] ??= []).push(name)
    }
    return out
  }, [cubeData])
  const affects = cube => affectsMap[cube] ?? []

  const seq = useMemo(() => (expanded
    ? buildRunSequence({ kind: 'process', name: expanded }, processData ?? {}, cubeData ?? {}, chores ?? [])
    : []), [expanded, processData, cubeData, chores])
  const tree = useMemo(() => toTree(seq), [seq])

  if (!open) return null

  const describe = p => info[p]?.summary || info[p]?.header || ''
  const copy = async () => {
    if (!chore) return
    const md = [
      `# ${chore.name}`, '',
      chore.active ? 'Runs on its schedule.' : 'Inactive chore — a runbook only, never run on a schedule.', '',
      ...chore.processes.map((p, i) => `${i + 1}. ${p}${describe(p) ? ` — ${describe(p).split('\n')[0]}` : ''}`),
    ].join('\n')
    try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* blocked */ }
  }

  return (
    <div className="h-full w-[560px] max-w-[calc(100vw-2rem)] shrink-0 bg-popover border-l border-border shadow-xl flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Milestone size={14} className="text-amber-400" />
          <div className="text-sm font-medium">Runbook</div>
          <span className="text-[10px] text-muted-foreground">Each chore, step by step — read-only; it runs nothing.</span>
          <button onClick={onClose} className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"><X size={13} /></button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-52 shrink-0 border-r border-border overflow-auto">
            {list.map((c, i) => (
              <button key={c.name} onClick={() => { setActive(i); setExpanded(null) }}
                className={cn('w-full text-left px-3 py-2 border-b border-border/50 transition-colors', i === active ? 'bg-muted/60' : 'hover:bg-muted/30')}>
                <div className="text-[11px] font-medium truncate">{c.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {c.processes.length} step{c.processes.length !== 1 ? 's' : ''} · {c.active ? 'scheduled' : 'runbook only'}
                </div>
              </button>
            ))}
            {list.length === 0 && (
              <p className="p-3 text-[10px] text-muted-foreground leading-relaxed">
                No chores for this model. A runbook is a chore: to show a sequence here, create a chore that runs
                its processes in order — leave it inactive if it should never run on a schedule.
              </p>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            {chore ? (
              <>
                <div className="px-4 py-3 border-b border-border shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{chore.name}</span>
                    <span className={cn('px-1.5 py-px rounded text-[9px] uppercase tracking-wider border',
                      chore.active ? 'border-emerald-500/40 text-emerald-500' : 'border-border text-muted-foreground')}>
                      {chore.active ? 'scheduled' : 'runbook only'}
                    </span>
                    <button onClick={() => onOpenPhaseMap(chore.name, chore.processes, [{ type: 'chore', name: chore.name }], 'chore')}
                      className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted"
                      title="Show this chore's processes and everything they touch on the Cube Map">
                      <Workflow size={11} /> View on map
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                  {chore.processes.map((p, i) => {
                    const isOpen = expanded === p
                    const d = describe(p)
                    return (
                      <div key={`${i}:${p}`} className="border-b border-border/40">
                        <div className="flex items-start gap-2 px-4 py-1.5">
                          <span className="w-4 h-4 mt-0.5 shrink-0 rounded-full text-[9px] flex items-center justify-center border border-border text-muted-foreground">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[11px] text-foreground truncate">{p}</div>
                            {d
                              ? <div className="text-[10px] text-muted-foreground leading-relaxed line-clamp-3 whitespace-pre-line">{d}</div>
                              : <div className="text-[10px] text-amber-500/80 italic">No description — add one to the process's Prolog header.</div>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => { setExpanded(isOpen ? null : p); setOpenPaths(new Set()) }}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted">
                              <ListOrdered size={10} /> {isOpen ? 'Hide' : 'Steps'}
                            </button>
                            <button onClick={ev => onOpenProcess(p, ev.altKey)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted" title={`Open ${p} — Alt-click to open here`}>
                              <ExternalLink size={10} />
                            </button>
                          </div>
                        </div>
                        {isOpen && (
                          <div className="pb-2">
                            {seq.length === 0
                              ? <div className="px-8 py-1 text-[10px] text-muted-foreground italic">No reads, writes or calls found.</div>
                              : tree.children.map(c => (
                                  <StepGroup key={c.path.join('>')} node={c} depth={0} openPaths={openPaths} affects={affects}
                                    toggle={k => setOpenPaths(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })} />
                                ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : <div className="p-6 text-xs text-muted-foreground italic">{list.length ? 'Select a chore.' : ''}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border shrink-0">
          <span className="text-[10px] text-muted-foreground">{list.length} chore{list.length !== 1 ? 's' : ''} · {chore?.processes.length ?? 0} steps</span>
          <button onClick={copy} disabled={!chore} className="flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40">
            <Copy size={11} /> {copied ? 'Copied' : 'Copy steps'}
          </button>
          <button onClick={onClose} className="ml-auto px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground">Close</button>
        </div>
    </div>
  )
}
