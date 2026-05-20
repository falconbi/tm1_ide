import { useState, useRef } from 'react'
import { useCubes, useDims, useProcs, useChores, useSubsets, useViews, useCubeDimensions } from '@/hooks/useApi'
import { useStore } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronRight, ChevronDown, Box, Layers, Cog, Clock, Loader2, List, Plus, Table2, Code2, PencilLine } from 'lucide-react'
import { cn } from '@/lib/utils'

function Section({ icon: Icon, label, items, isLoading, onSelect, itemIcon: ItemIcon }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wider"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Icon size={12} />
        <span>{label}</span>
        {isLoading && <Loader2 size={10} className="ml-auto animate-spin" />}
      </button>
      {open && (
        <div className="pb-1">
          {(items ?? []).map(item => (
            <button
              key={item}
              onClick={() => onSelect(item)}
              className="flex items-center gap-2 w-full px-6 py-0.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate"
            >
              {ItemIcon && <ItemIcon size={12} className="shrink-0 text-muted-foreground" />}
              <span className="truncate">{item}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CubeSubSection({ label, loading, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 w-full px-9 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold hover:text-muted-foreground transition-colors">
        {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        {label}
        {loading && <Loader2 size={9} className="ml-1 animate-spin" />}
      </button>
      {open && children}
    </div>
  )
}

// Dimension row inside a cube — shows subsets on expand
function CubeDimRow({ server, dim, onOpenSubset, onOpenDim }) {
  const [open, setOpen] = useState(false)
  const { data: subsets, isFetching } = useSubsets(open ? server : null, open ? dim : null)

  return (
    <div>
      <div className="flex items-center w-full px-12 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 mr-1.5 text-muted-foreground">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <Layers size={10} className="shrink-0 text-muted-foreground mr-1.5" />
        <span className="truncate flex-1">{dim}</span>
        <span className="hidden group-hover:flex items-center gap-1 shrink-0 ml-1">
          <button
            onClick={() => onOpenDim(dim)}
            title="Edit dimension"
            className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
          >
            <PencilLine size={9} /> Edit
          </button>
        </span>
        {isFetching && <Loader2 size={10} className="animate-spin text-muted-foreground shrink-0" />}
      </div>
      {open && (subsets ?? []).map(s => (
        <button
          key={s.Name}
          onClick={() => onOpenSubset(dim, s.Name)}
          className="flex items-center gap-2 w-full px-16 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate"
          title={s.Expression ? 'MDX subset' : 'Static subset'}
        >
          {s.Expression
            ? <Code2 size={10} className="shrink-0 text-violet-400" />
            : <List   size={10} className="shrink-0 text-muted-foreground" />}
          <span className="truncate font-mono">{s.Name}</span>
        </button>
      ))}
    </div>
  )
}

function CubeRow({ server, cube, onOpenRules, onOpenView, onOpenSubset, onOpenDim, onOpenViewer }) {
  const [open, setOpen] = useState(false)
  const { data: views,    isFetching: loadingViews } = useViews(open ? server : null, open ? cube : null)
  const { data: cubeDims, isFetching: loadingDims  } = useCubeDimensions(open ? server : null, open ? cube : null)

  const loading = loadingViews || loadingDims

  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center w-full px-6 py-0.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group">
        <span className="shrink-0 mr-1.5 text-muted-foreground">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
        <Box size={12} className="shrink-0 text-muted-foreground mr-2" />
        <span className="truncate flex-1 text-left">{cube}</span>
        {loading && <Loader2 size={10} className="ml-1 animate-spin text-muted-foreground shrink-0" />}
      </button>
      {open && <>
        <button onClick={() => onOpenViewer(cube)}
          className="flex items-center gap-2 w-full px-9 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <Table2 size={10} className="shrink-0 text-blue-400" />
          <span>Data</span>
        </button>
        <button onClick={() => onOpenRules(cube)}
          className="flex items-center gap-2 w-full px-9 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <Code2 size={10} className="shrink-0 text-muted-foreground" />
          <span>Rules</span>
        </button>
        <CubeSubSection label="Views" loading={loadingViews}>
          {(views ?? []).length === 0 && !loadingViews
            ? <p className="px-12 py-0.5 text-xs text-muted-foreground/50 italic">No views</p>
            : (views ?? []).map(v => (
                <button key={v} onClick={() => onOpenView(cube, v)}
                  className="flex items-center gap-2 w-full px-12 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate">
                  <Table2 size={10} className="shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono">{v}</span>
                </button>
              ))
          }
        </CubeSubSection>
        <CubeSubSection label="Dimensions" loading={loadingDims}>
          {(cubeDims ?? []).map(dim => (
            <CubeDimRow key={dim} server={server} dim={dim} onOpenSubset={onOpenSubset} onOpenDim={onOpenDim} />
          ))}
        </CubeSubSection>
      </>}
    </div>
  )
}

function CubeSection({ server, cubes, isLoading, onOpenRules, onOpenView, onOpenSubset, onOpenDim, onOpenViewer }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wider"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Box size={12} />
        <span>Cubes</span>
        {isLoading && <Loader2 size={10} className="ml-auto animate-spin" />}
      </button>
      {open && (
        <div className="pb-1">
          {(cubes ?? []).map(cube => (
            <CubeRow key={cube} server={server} cube={cube}
              onOpenRules={onOpenRules} onOpenView={onOpenView}
              onOpenSubset={onOpenSubset} onOpenDim={onOpenDim}
              onOpenViewer={onOpenViewer} />
          ))}
        </div>
      )}
    </div>
  )
}

function DimRow({ server, dim, onOpenSubset, onOpenDim }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const inputRef = useRef(null)
  const { data: subsets, isFetching } = useSubsets(open ? server : null, open ? dim : null)

  const startAdd = () => {
    setAdding(true)
    setNewName('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const commitAdd = () => {
    const name = newName.trim()
    if (name) onOpenSubset(dim, name)
    setAdding(false)
    setNewName('')
  }

  return (
    <div>
      <div className="flex items-center w-full px-6 py-0.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 mr-1.5 text-muted-foreground">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <Layers size={12} className="shrink-0 text-muted-foreground mr-2" />
        <button onClick={() => onOpenDim(dim)} className="truncate text-left flex-1">{dim}</button>
        {isFetching
          ? <Loader2 size={10} className="ml-1 animate-spin text-muted-foreground shrink-0" />
          : <button onClick={(e) => { e.stopPropagation(); setOpen(true); startAdd() }}
              className="ml-1 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
              title="New subset">
              <Plus size={11} />
            </button>
        }
      </div>
      {open && (
        <div>
          {adding && (
            <div className="flex items-center gap-1 px-14 py-0.5">
              <List size={10} className="shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') setAdding(false) }}
                onBlur={commitAdd}
                placeholder="Subset name…"
                className="flex-1 text-xs bg-transparent border-b border-primary outline-none font-mono py-px"
              />
            </div>
          )}
          {(subsets ?? []).length === 0 && !isFetching && !adding && (
            <p className="px-14 py-0.5 text-xs text-muted-foreground italic">No subsets — hover to add</p>
          )}
          {(subsets ?? []).map(s => (
            <button
              key={s.Name}
              onClick={() => onOpenSubset(dim, s.Name)}
              className="flex items-center gap-2 w-full px-14 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate"
              title={s.Expression ? 'MDX subset' : 'Static subset'}
            >
              {s.Expression
                ? <Code2 size={10} className="shrink-0 text-violet-400" />
                : <List   size={10} className="shrink-0 text-muted-foreground" />
              }
              <span className="truncate font-mono">{s.Name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DimSection({ server, dims, isLoading, onOpenSubset, onOpenDim }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wider"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Layers size={12} />
        <span>Dimensions</span>
        {isLoading && <Loader2 size={10} className="ml-auto animate-spin" />}
      </button>
      {open && (
        <div className="pb-1">
          {(dims ?? []).map(dim => (
            <DimRow key={dim} server={server} dim={dim} onOpenSubset={onOpenSubset} onOpenDim={onOpenDim} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Explorer() {
  const { server, openTab } = useStore()
  const { data: cubes,  isFetching: loadingCubes  } = useCubes(server)
  const { data: dims,   isFetching: loadingDims   } = useDims(server)
  const { data: procs,  isFetching: loadingProcs  } = useProcs(server)
  const { data: chores, isFetching: loadingChores } = useChores(server)

  const openRules = (cube) => openTab({
    id:      `rules:${server}:${cube}`,
    type:    'rules',
    label:   cube,
    server,
    cube,
    content: null,
  })

  const openProcess = (name) => openTab({
    id:      `process:${server}:${name}`,
    type:    'process',
    label:   name,
    server,
    name,
    content: null,
  })

  const openSubset = (dim, name) => openTab({
    id:         `subset:${server}:${dim}:${name}`,
    type:       'subset',
    label:      name,
    server,
    dimension:  dim,
    subsetName: name,
  })

  const openCubeViewer = (cube) => openTab({
    id:      `cubeview:${server}:${cube}`,
    type:    'cubeview',
    label:   `⊞ ${cube}`,
    server,
    cube,
  })

  const openView = (cube, view) => openTab({
    id:       `cubeview:${server}:${cube}:${view}`,
    type:     'cubeview',
    label:    `⊞ ${cube} / ${view}`,
    server,
    cube,
    viewName: view,
  })

  const openDim = (dim) => openTab({
    id:        `dim:${server}:${dim}`,
    type:      'dimension',
    label:     dim,
    server,
    dimension: dim,
  })

  if (!server) {
    return (
      <div className="px-4 py-6 text-xs text-muted-foreground text-center">
        Select a server to explore objects.
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="py-1">
        <CubeSection server={server} cubes={cubes} isLoading={loadingCubes}
          onOpenRules={openRules} onOpenView={openView}
          onOpenSubset={openSubset} onOpenDim={openDim}
          onOpenViewer={openCubeViewer} />
        <DimSection server={server} dims={dims}    isLoading={loadingDims}   onOpenSubset={openSubset} onOpenDim={openDim} />
        <Section    icon={Cog}   label="Processes" items={procs}  isLoading={loadingProcs}  onSelect={openProcess} itemIcon={Cog} />
        <Section    icon={Clock} label="Chores"    items={chores} isLoading={loadingChores} onSelect={() => {}}    itemIcon={Clock} />
      </div>
    </ScrollArea>
  )
}
