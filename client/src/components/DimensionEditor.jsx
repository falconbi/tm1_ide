import { useMemo, useState } from 'react'
import { useElements, useEdges } from '@/hooks/useApi'
import { ChevronRight, ChevronDown, Loader2, List, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'

const TYPE_ICON  = { N: '○', C: '◆', S: '"' }
const TYPE_COLOR = { N: 'text-blue-400', C: 'text-orange-400', S: 'text-green-400' }
const TYPE_LABEL = { N: 'Numeric', C: 'Consolidated', S: 'String' }

function buildTree(elements, edges) {
  const byName = {}
  for (const e of elements) byName[e.Name] = e

  const childrenOf = {}
  const isChild = new Set()
  for (const edge of edges) {
    if (!childrenOf[edge.ParentName]) childrenOf[edge.ParentName] = []
    childrenOf[edge.ParentName].push(edge.ComponentName)
    isChild.add(edge.ComponentName)
  }

  const roots = elements.filter(e => !isChild.has(e.Name)).map(e => e.Name)
  return { roots, childrenOf, byName }
}

function TreeNode({ name, childrenOf, byName, depth, visited = new Set() }) {
  const children = childrenOf[name] ?? []
  const hasChildren = children.length > 0
  const cycle = visited.has(name)
  const [open, setOpen] = useState(depth < 2)
  const el = byName[name]
  const nextVisited = new Set(visited).add(name)

  return (
    <div className={cn(depth > 0 && 'ml-4 border-l border-border/50 pl-1.5')}>
      <div className="flex items-center gap-1 py-px group">
        {hasChildren && !cycle ? (
          <button onClick={() => setOpen(o => !o)} className="shrink-0 text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : <span className="w-3 shrink-0" />}
        <span className={cn('shrink-0 text-[10px] w-3', TYPE_COLOR[el?.Type])}>{TYPE_ICON[el?.Type] ?? '·'}</span>
        <span className="text-xs font-mono truncate" title={name}>{name}</span>
        {cycle && <span className="text-muted-foreground/50 text-[10px] ml-1">(cycle)</span>}
      </div>
      {open && !cycle && children.map(c => (
        <TreeNode key={c} name={c} childrenOf={childrenOf} byName={byName} depth={depth + 1} visited={nextVisited} />
      ))}
    </div>
  )
}

function FlatList({ elements }) {
  const counts = { N: 0, C: 0, S: 0 }
  for (const e of elements) if (counts[e.Type] != null) counts[e.Type]++

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-3 px-3 py-2 border-b border-border shrink-0 text-xs text-muted-foreground">
        {Object.entries(counts).map(([t, n]) => (
          <span key={t}><span className={TYPE_COLOR[t]}>{TYPE_ICON[t]}</span> {n} {TYPE_LABEL[t]}</span>
        ))}
        <span className="ml-auto">{elements.length} total</span>
      </div>
      <div className="flex-1 overflow-auto">
        {elements.map(e => (
          <div key={e.Name} className="flex items-center gap-2 px-3 py-px text-xs hover:bg-muted">
            <span className={cn('shrink-0 text-[10px]', TYPE_COLOR[e.Type])}>{TYPE_ICON[e.Type] ?? '·'}</span>
            <span className="font-mono truncate">{e.Name}</span>
            <span className="ml-auto text-muted-foreground/60 shrink-0">L{e.Level}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DimensionEditor({ tab }) {
  const { data: elements = [], isLoading: loadingEl } = useElements(tab.server, tab.dimension)
  const { data: edges    = [], isLoading: loadingEd } = useEdges(tab.server, tab.dimension)
  const [view, setView] = useState('tree')

  const tree = useMemo(() => buildTree(elements, edges), [elements, edges])

  const isLoading = loadingEl || loadingEd

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 size={16} className="animate-spin mr-2" /> Loading dimension…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted shrink-0">
        <span className="text-xs font-semibold">{tab.dimension}</span>
        <span className="text-xs text-muted-foreground">{elements.length} elements</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setView('tree')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'tree' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted')}
          >
            <GitBranch size={11} /> Tree
          </button>
          <button
            onClick={() => setView('flat')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'flat' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted')}
          >
            <List size={11} /> Flat
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {view === 'flat' && <FlatList elements={elements} />}
        {view === 'tree' && (
          <div className="p-2">
            {tree.roots.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-4">No elements found.</p>
            )}
            {tree.roots.map(r => (
              <TreeNode key={r} name={r} childrenOf={tree.childrenOf} byName={tree.byName} depth={0} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
