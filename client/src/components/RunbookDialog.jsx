import { useEffect, useMemo, useState } from 'react'
import { Milestone, X, Copy, Loader2, Workflow, ListOrdered, ExternalLink, ChevronDown, ChevronRight, Map } from 'lucide-react'
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

function StepGroup({ node, depth, openPaths, toggle }) {
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
        ? <StepGroup key={r.x.path.join('>')} node={r.x} depth={depth + 1} openPaths={openPaths} toggle={toggle} />
        : (() => {
            const st = KIND[r.x.kind] ?? KIND.note
            return (
              <div key={i} className="flex items-start gap-2 px-4 py-0.5" style={{ paddingLeft: 16 + depth * 12 }}>
                <span className="w-5 shrink-0 text-right font-mono text-[9px] text-muted-foreground/50 mt-0.5">{i + 1}</span>
                <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: st.color }} />
                <span className="text-[10px] text-foreground/80 leading-relaxed">{r.x.caption}</span>
                <span className="ml-auto shrink-0 text-[8px] uppercase tracking-wider text-muted-foreground/40 mt-0.5">{st.label}</span>
              </div>
            )
          })())}
    </div>
  )
}

// A phased review of a model update (config/workforce-lifecycle.json).
// Left: phases in business order. Right: the processes/chores for the phase, each
// expandable to its code-order steps, plus a phase-filtered Cube Map.
export default function RunbookDialog({ open, onClose, server, processData, cubeData, chores, onOpenProcess, onOpenPhaseMap }) {
  const [book, setBook] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const [openPaths, setOpenPaths] = useState(() => new Set())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setActive(0); setExpanded(null); setOpenPaths(new Set()); setError(null); setCopied(false)
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const r = await fetch(`/api/runbooks?server=${encodeURIComponent(server)}`, { headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' } })
        const d = await r.json()
        if (!r.ok || d.error) throw new Error(d.error || r.statusText)
        if (!cancelled) setBook(d.runbooks?.[0] ?? null)
      } catch (e) { if (!cancelled) setError(e.message) }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [open, server])

  const phase = book?.phases?.[active] ?? null
  const entry = phase?.entries?.find(e => `${e.type}:${e.name ?? e.label}` === expanded) ?? null
  const seq = useMemo(() => {
    if (!entry || entry.type === 'manual') return []
    return buildRunSequence({ kind: entry.type === 'chore' ? 'chore' : 'process', name: entry.name }, processData ?? {}, cubeData ?? {}, chores ?? [])
  }, [entry, processData, cubeData, chores])

  const tree = useMemo(() => toTree(seq), [seq])
  const seeds = useMemo(() => {
    const out = new Set()
    for (const e of phase?.entries ?? []) {
      if (e.type === 'process') out.add(e.name)
      else if (e.type === 'chore') (chores.find(c => c.name === e.name)?.processes ?? []).forEach(p => out.add(p))
    }
    return [...out]
  }, [phase, chores])

  if (!open) return null

  const copy = async () => {
    if (!phase) return
    const md = [
      `# ${book.name} — ${phase.title}`,
      '',
      `Who: ${phase.who ?? ''}`,
      phase.note ? `\n${phase.note}` : '',
      '',
      '## Steps',
      ...phase.entries.map(e => e.type === 'manual'
        ? `- (manual) ${e.label}${e.note ? ` — ${e.note}` : ''}`
        : `- ${e.type === 'chore' ? 'chore' : 'process'} ${e.name}${e.note ? ` — ${e.note}` : ''}`),
    ].join('\n')
    try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* blocked */ }
  }

  return (
    <div className="h-full w-[560px] max-w-[calc(100vw-2rem)] shrink-0 bg-popover border-l border-border shadow-xl flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Milestone size={14} className="text-amber-400" />
          <div className="text-sm font-medium">{book?.name ?? 'Runbook'}</div>
          <span className="text-[10px] text-muted-foreground">Phased review — the order is defined here; each process expands to its code-order steps.</span>
          <button onClick={onClose} className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"><X size={13} /></button>
        </div>
        {error && <div className="px-4 py-2 border-b border-red-500/30 bg-red-500/10 text-[11px] text-red-400">{error}</div>}
        <div className="flex flex-1 min-h-0">
          <div className="w-52 shrink-0 border-r border-border overflow-auto">
            {loading && <div className="p-3 text-[11px] text-muted-foreground flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Loading…</div>}
            {(book?.phases ?? []).map((p, i) => (
              <button key={p.id} onClick={() => { setActive(i); setExpanded(null) }}
                className={cn('w-full text-left px-3 py-2 border-b border-border/50 transition-colors',
                  i === active ? 'bg-muted/60' : 'hover:bg-muted/30')}>
                <div className="flex items-center gap-1.5">
                  <span className={cn('w-4 h-4 rounded-full text-[9px] flex items-center justify-center border',
                    i === active ? 'border-primary text-primary' : 'border-border text-muted-foreground')}>{i + 1}</span>
                  <span className="text-[11px] font-medium truncate">{p.title}</span>
                </div>
                <div className="text-[10px] text-muted-foreground pl-5">{p.who} · {p.entries.length} step{p.entries.length !== 1 ? 's' : ''}</div>
              </button>
            ))}
            {book?.description && <p className="p-3 text-[10px] text-muted-foreground leading-relaxed">{book.description}</p>}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            {phase ? (
              <>
                <div className="px-4 py-3 border-b border-border shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{phase.title}</span>
                    <span className="text-[10px] text-muted-foreground">{phase.who}</span>
                    <button onClick={() => onOpenPhaseMap(phase.title, seeds, phase.entries)} disabled={seeds.length === 0}
                      className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
                      title={seeds.length ? `Open the Cube Map filtered to ${seeds.length} processes in this phase` : 'No processes to map in this phase'}>
                      <Workflow size={11} /> View phase map
                    </button>
                  </div>
                  {phase.note && <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{phase.note}</p>}
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                  {phase.entries.map(e => {
                    const key = `${e.type}:${e.name ?? e.label}`
                    const isOpen = expanded === key
                    return (
                      <div key={key} className="border-b border-border/40">
                        <div className="flex items-center gap-2 px-4 py-1.5">
                          <span className={cn('px-1.5 py-px rounded text-[9px] uppercase tracking-wider border',
                            e.type === 'process' ? 'border-emerald-500/40 text-emerald-500' :
                            e.type === 'chore' ? 'border-amber-500/40 text-amber-500' : 'border-border text-muted-foreground')}>
                            {e.type}
                          </span>
                          <span className="font-mono text-[11px] text-foreground truncate">{e.name ?? e.label}</span>
                          {e.note && <span className="text-[10px] text-muted-foreground truncate">— {e.note}</span>}
                          <div className="ml-auto flex items-center gap-1">
                            {e.type !== 'manual' && (
                              <>
                                <button onClick={() => {
                                  const procs = e.type === 'process' ? [e.name] : (chores.find(c => c.name === e.name)?.processes ?? [])
                                  onOpenPhaseMap(e.name ?? e.label, procs, [e], e.type)
                                }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted"
                                  title={`Show this change's dataflow on the Cube Map`}>
                                  <Map size={10} /> Map
                                </button>
                                <button onClick={() => { setExpanded(isOpen ? null : key); setOpenPaths(new Set()) }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted">
                                  <ListOrdered size={10} /> {isOpen ? 'Hide' : 'Steps'}
                                </button>
                              </>
                            )}
                            {e.type === 'process' && (
                              <button onClick={ev => onOpenProcess(e.name, ev.altKey)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted" title={`Open ${e.name} — Alt-click to open here`}>
                                <ExternalLink size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                        {isOpen && (
                          <div className="pb-2">
                            {seq.length === 0
                              ? <div className="px-8 py-1 text-[10px] text-muted-foreground italic">No reads, writes or calls found.</div>
                              : tree.children.map(c => (
                                  <StepGroup key={c.path.join('>')} node={c} depth={0} openPaths={openPaths}
                                    toggle={k => setOpenPaths(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })} />
                                ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : <div className="p-6 text-xs text-muted-foreground italic">Select a phase.</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border shrink-0">
          <span className="text-[10px] text-muted-foreground">{book?.phases?.length ?? 0} phases · {phase?.entries?.length ?? 0} steps in this phase</span>
          <button onClick={copy} disabled={!phase} className="flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40">
            <Copy size={11} /> {copied ? 'Copied' : 'Copy phase'}
          </button>
          <button onClick={onClose} className="ml-auto px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground">Close</button>
        </div>
    </div>
  )
}
