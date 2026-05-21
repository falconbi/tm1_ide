import { useState, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import { useCubes, useDims, useProcs, useChores, useSubsets, useViews, useCubeDimensions, useSaveView } from '@/hooks/useApi'
import { useStore } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronRight, ChevronDown, Box, Layers, Cog, Clock, Loader2, List, Plus, Table2, Code2, PencilLine, Search, X } from 'lucide-react'
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

function CubeSubSection({ label, loading, children, onAdd, adding, onAddCommit, onAddCancel, addValue, onAddChange, addRef }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div className="flex items-center w-full pr-2 group">
        <button onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 flex-1 px-9 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold hover:text-muted-foreground transition-colors">
          {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          {label}
          {loading && <Loader2 size={9} className="ml-1 animate-spin" />}
        </button>
        {onAdd && !adding && (
          <button onClick={onAdd}
            className="hidden group-hover:flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent shrink-0 ml-auto transition-colors"
            title={`New ${label.toLowerCase()}`}>
            <Plus size={9} />
          </button>
        )}
      </div>
      {open && children}
      {adding && (
        <div className="flex items-center gap-1 px-12 py-0.5">
          <Table2 size={10} className="shrink-0 text-muted-foreground" />
          <input
            ref={addRef}
            value={addValue}
            onChange={onAddChange}
            onKeyDown={e => { if (e.key === 'Enter') onAddCommit(); if (e.key === 'Escape') onAddCancel() }}
            onBlur={onAddCommit}
            placeholder={`${label.toLowerCase()} name\u2026`}
            className="flex-1 text-xs bg-transparent border-b border-primary outline-none font-mono py-px"
          />
        </div>
      )}
    </div>
  )
}

// Dimension row inside a cube — shows subsets on expand
function CubeDimRow({ server, dim, onOpenSubset, onOpenDim }) {
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
      <div className="flex items-center w-full px-12 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 mr-1.5 text-muted-foreground">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <Layers size={10} className="shrink-0 text-muted-foreground mr-1.5" />
        <span className="truncate flex-1">{dim}</span>
        <span className="hidden group-hover:flex items-center gap-1 shrink-0 ml-1">
          <button onClick={() => onOpenDim(dim)} title="Edit dimension"
            className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent">
            <PencilLine size={9} /> Edit
          </button>
          {isFetching
            ? <Loader2 size={10} className="animate-spin text-muted-foreground" />
            : <button onClick={(e) => { e.stopPropagation(); setOpen(true); startAdd() }} title="New subset"
                className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent">
                <Plus size={9} /> Subset
              </button>
          }
        </span>
      </div>
      {open && (
        <div>
          {adding && (
            <div className="flex items-center gap-1 px-20 py-0.5">
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
            <p className="px-20 py-0.5 text-xs text-muted-foreground italic">No subsets — hover to add</p>
          )}
          {(subsets ?? []).map(s => (
            <button
              key={s.Name}
              onClick={() => onOpenSubset(dim, s.Name)}
              className="flex items-center gap-2 w-full px-20 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate"
              title={s.Expression ? 'MDX subset' : 'Static subset'}
            >
              {s.Expression
                ? <Code2 size={10} className="shrink-0 text-violet-400" />
                : <List   size={10} className="shrink-0 text-muted-foreground" />}
              <span className="truncate font-mono">{s.Name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CubeRow({ server, cube, onOpenRules, onOpenView, onOpenSubset, onOpenDim, onOpenViewer }) {
  const [open, setOpen] = useState(false)
  const { data: views,    isFetching: loadingViews } = useViews(open ? server : null, open ? cube : null)
  const { data: cubeDims, isFetching: loadingDims  } = useCubeDimensions(open ? server : null, open ? cube : null)

  const [addingView, setAddingView] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const viewInputRef = useRef(null)
  const saveView = useSaveView()

  const startAddView = () => {
    setAddingView(true)
    setNewViewName('')
    setTimeout(() => viewInputRef.current?.focus(), 0)
  }

  const commitAddView = () => {
    const name = newViewName.trim()
    setAddingView(false)
    setNewViewName('')
    if (!name) return
    const id = toast.loading(`Creating view "${name}"…`)
    saveView.mutate(
      { server, cube, name, mdx: `SELECT {} ON COLUMNS FROM [${cube}]` },
      {
        onSuccess: () => {
          toast.success(`View "${name}" created`, { id })
          onOpenView(cube, name)
        },
        onError: e => toast.error(e.message, { id }),
      }
    )
  }

  const loading = loadingViews || loadingDims

  return (
    <div>
      <div className="flex items-center w-full px-6 py-0.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 mr-1.5 text-muted-foreground hover:text-foreground">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <button onClick={() => onOpenViewer(cube)} className="flex items-center flex-1 min-w-0 text-left">
          <Box size={12} className="shrink-0 text-muted-foreground mr-2" />
          <span className="truncate">{cube}</span>
        </button>
        {loading && <Loader2 size={10} className="ml-1 animate-spin text-muted-foreground shrink-0" />}
      </div>
      {open && <>
        <CubeSubSection label="Views" loading={loadingViews}
          onAdd={startAddView} adding={addingView}
          addValue={newViewName} onAddChange={e => setNewViewName(e.target.value)}
          addRef={viewInputRef} onAddCommit={commitAddView} onAddCancel={() => setAddingView(false)}>
          {(views ?? []).length === 0 && !loadingViews && !addingView
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
        <button onClick={() => onOpenRules(cube)}
          className="flex items-center gap-2 w-full px-9 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <Code2 size={10} className="shrink-0 text-muted-foreground" />
          <span>Rules</span>
        </button>
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
        <span className="truncate flex-1 text-left">{dim}</span>
        <span className="hidden group-hover:flex items-center gap-1 shrink-0 ml-1">
          <button onClick={() => onOpenDim(dim)} title="Edit dimension"
            className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent">
            <PencilLine size={9} /> Edit
          </button>
          {isFetching
            ? <Loader2 size={10} className="animate-spin text-muted-foreground" />
            : <button onClick={(e) => { e.stopPropagation(); setOpen(true); startAdd() }} title="New subset"
                className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent">
                <Plus size={9} /> Subset
              </button>
          }
        </span>
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
  const [search, setSearch] = useState('')
  const { data: cubes,  isFetching: loadingCubes  } = useCubes(server)
  const { data: dims,   isFetching: loadingDims   } = useDims(server)
  const { data: procs,  isFetching: loadingProcs  } = useProcs(server)
  const { data: chores, isFetching: loadingChores } = useChores(server)

  const searchResults = useMemo(() => {
    if (!search.trim()) return null
    const q = search.toLowerCase()
    const match = (name) => name.toLowerCase().includes(q)
    return [
      ...(cubes  ?? []).filter(match).map(n => ({ type: 'cube',      name: n, Icon: Box    })),
      ...(dims   ?? []).filter(match).map(n => ({ type: 'dimension', name: n, Icon: Layers  })),
      ...(procs  ?? []).filter(match).map(n => ({ type: 'process',   name: n, Icon: Cog    })),
      ...(chores ?? []).filter(match).map(n => ({ type: 'chore',     name: n, Icon: Clock   })),
    ]
  }, [search, cubes, dims, procs, chores])

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

  const handleResultClick = (r) => {
    if (r.type === 'cube')      openCubeViewer(r.name)
    else if (r.type === 'dimension') openDim(r.name)
    else if (r.type === 'process')   openProcess(r.name)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-2 py-1.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 bg-muted rounded px-2 py-1">
          <Search size={11} className="text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search objects…"
            className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground shrink-0">
              <X size={10} />
            </button>
          )}
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="py-1">
          {searchResults ? (
            searchResults.length === 0
              ? <p className="px-4 py-3 text-xs text-muted-foreground">No results for "{search}"</p>
              : searchResults.map(r => (
                  <button key={`${r.type}:${r.name}`} onClick={() => handleResultClick(r)}
                    className="flex items-center gap-2 w-full px-4 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                    <r.Icon size={11} className="shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1 text-left">{r.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{r.type}</span>
                  </button>
                ))
          ) : (
            <>
              <CubeSection server={server} cubes={cubes} isLoading={loadingCubes}
                onOpenRules={openRules} onOpenView={openView}
                onOpenSubset={openSubset} onOpenDim={openDim}
                onOpenViewer={openCubeViewer} />
              <DimSection server={server} dims={dims}    isLoading={loadingDims}   onOpenSubset={openSubset} onOpenDim={openDim} />
              <Section    icon={Cog}   label="Processes" items={procs}  isLoading={loadingProcs}  onSelect={openProcess} itemIcon={Cog} />
              <Section    icon={Clock} label="Chores"    items={chores} isLoading={loadingChores} onSelect={() => {}}    itemIcon={Clock} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
