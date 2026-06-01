import { useState, useRef, useMemo, useEffect, createContext, useContext, useCallback } from 'react'
import { toast } from 'sonner'
import { useCubes, useDims, useProcs, useChores, useSubsets, useViews, useCubeDimensions, useSaveView, useHierarchies, useCreateHierarchy, useControlObjects, useDeleteDimension, useDeleteCube, useDeleteProcess, useDeleteChore, useDeleteSubset, useCreateProcess } from '@/hooks/useApi'
import { useStore } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronRight, ChevronDown, Box, Layers, Cog, Clock, Loader2, List, Plus, Table2, Code2, PencilLine, Search, X, Braces, Trash2, FileSearch } from 'lucide-react'
import GlobalSearch from '@/components/GlobalSearch'
import { cn } from '@/lib/utils'

// ── Reveal / locate helpers ───────────────────────────────────────────────────

/** @param {string} sectionId @param {import('@/store').RevealTarget} target */
function shouldAutoOpen(sectionId, target) {
  if (!target) return false
  const parts = sectionId.split(':')
  const type = parts[0]

  if (target.type === 'view') {
    if (type === 'cubes') return true
    if (type === 'cube' && parts[1] === target.cube) return true
    if (type === 'cube' && parts[1] === target.cube && parts[2] === 'views') return true
    return false
  }

  if (target.type === 'cube' || target.type === 'rules') {
    if (type === 'cubes') return true
    if (type === 'rules') return true
    if (type === 'cube' && parts[1] === target.cube) return true
    return false
  }

  if (target.type === 'dimension' || target.type === 'hierarchy' || target.type === 'subset') {
    if (type === 'dimensions') return true
    if (type === 'dim' && parts[1] === target.dimension) return true
    return false
  }

  if (target.type === 'process') {
    if (type === 'processes') return true
  }

  return false
}

function getLocateId(target) {
  if (!target) return ''
  if (target.type === 'view') return `view:${target.cube}:${target.viewName}`
  if (target.type === 'cube') return `cube:${target.cube}`
  if (target.type === 'rules') return `rules:${target.cube}`
  if (target.type === 'dimension') return `dimension:${target.dimension}`
  if (target.type === 'hierarchy') return `hierarchy:${target.dimension}:${target.hierarchy}`
  if (target.type === 'subset') return `subset:${target.dimension}:${target.subsetName}`
  if (target.type === 'process') return `process:${target.name}`
  return ''
}

function getLocateIdFromTab(tab) {
  if (!tab) return ''
  if (tab.type === 'process')   return `process:${tab.name}`
  if (tab.type === 'rules')     return `rules:${tab.cube}`
  if (tab.type === 'view' || tab.type === 'cubeview') return tab.viewName ? `view:${tab.cube}:${tab.viewName}` : `cube:${tab.cube}`
  if (tab.type === 'subset')    return `subset:${tab.dimension}:${tab.subsetName}`
  if (tab.type === 'dimension') return `dimension:${tab.dimension}`
  if (tab.type === 'chore')     return `chore:${tab.name}`
  return ''
}

const ActiveLocateCtx = createContext('')

function Section({ icon: Icon, label, items, isLoading, onSelect, itemIcon: ItemIcon, sectionId, locateIdPrefix, onDelete, onAdd }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const inputRef = useRef(null)
  const activeId = useContext(ActiveLocateCtx)
  const revealTarget = useStore(s => s.revealTarget)
  useEffect(() => {
    if (revealTarget && shouldAutoOpen(sectionId, revealTarget)) setOpen(true)
  }, [revealTarget, sectionId])

  const startAdd = () => {
    setOpen(true)
    setAdding(true)
    setNewName('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }
  const commitAdd = () => {
    const name = newName.trim()
    if (name && onAdd) onAdd(name)
    setAdding(false)
    setNewName('')
  }

  return (
    <div>
      <div className="flex items-center w-full px-3 py-1 group">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 flex-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wider min-w-0"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Icon size={12} className="shrink-0" />
          <span className="truncate">{label}</span>
        </button>
        {isLoading && <Loader2 size={10} className="animate-spin text-muted-foreground shrink-0 ml-1" />}
        {onAdd && !isLoading && (
          <button
            onClick={startAdd}
            title={`New ${label.toLowerCase().replace(/s$/, '')}`}
            className="hidden group-hover:flex items-center ml-1 text-muted-foreground hover:text-foreground shrink-0"
          >
            <Plus size={11} />
          </button>
        )}
      </div>
      {open && (
        <div className="pb-1">
          {adding && (
            <div className="flex items-center gap-2 pl-6 pr-2 py-0.5">
              {ItemIcon && <ItemIcon size={12} className="shrink-0 text-muted-foreground" />}
              <input
                ref={inputRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') setAdding(false) }}
                onBlur={commitAdd}
                placeholder="name…"
                className="flex-1 text-xs bg-transparent border-b border-primary outline-none font-mono py-px"
              />
            </div>
          )}
          {(items ?? []).map(item => (
            <div key={item} className="flex items-center text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group">
              <button
                onClick={() => onSelect(item)}
                data-locate-id={locateIdPrefix ? `${locateIdPrefix}:${item}` : undefined}
                className="flex items-center gap-2 flex-1 pl-6 pr-2 py-0.5 truncate min-w-0"
              >
                {ItemIcon && <ItemIcon size={12} className="shrink-0 text-muted-foreground" />}
                <span className={cn('truncate', locateIdPrefix && activeId === `${locateIdPrefix}:${item}` && 'text-amber-400 dark:text-amber-300')}>{item}</span>
              </button>
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(item) }}
                  title={`Delete ${item}`}
                  className="hidden group-hover:flex items-center pr-2 py-0.5 text-muted-foreground hover:text-red-400 shrink-0"
                >
                  <Trash2 size={9} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CubeSubSection({ label, loading, children, onAdd, adding, onAddCommit, onAddCancel, addValue, onAddChange, addRef, sectionId }) {
  const [open, setOpen] = useState(false)
  const revealTarget = useStore(s => s.revealTarget)
  useEffect(() => {
    if (revealTarget && shouldAutoOpen(sectionId, revealTarget)) setOpen(true)
  }, [revealTarget, sectionId])
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
function CubeDimRow({ server, dim, onOpenSubset, onOpenDim, cube }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const inputRef = useRef(null)
  const { data: subsets, isFetching } = useSubsets(open ? server : null, open ? dim : null)
  const sectionId = `cube:${cube}:dim:${dim}`
  const deleteSubsetMut = useDeleteSubset()

  const handleDeleteSubset = (name) => {
    if (!window.confirm(`Delete subset "${name}"? This cannot be undone.`)) return
    deleteSubsetMut.mutate({ server, dimension: dim, name }, {
      onSuccess: () => toast.success(`Deleted ${name}`),
      onError:   (err) => toast.error(err.message ?? 'Delete failed'),
    })
  }

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
    <div data-section={sectionId}>
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
            <div key={s.Name} className="flex items-center text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group">
              <button
                onClick={() => onOpenSubset(dim, s.Name)}
                className="flex items-center gap-2 flex-1 pl-20 pr-2 py-0.5 truncate min-w-0"
                title={s.Expression ? 'MDX subset' : 'Static subset'}
              >
                {s.Expression
                  ? <Code2 size={10} className="shrink-0 text-violet-400" />
                  : <List   size={10} className="shrink-0 text-muted-foreground" />}
                <span className="truncate font-mono">{s.Name}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteSubset(s.Name) }}
                title="Delete subset"
                className="hidden group-hover:flex items-center pr-2 py-0.5 text-muted-foreground hover:text-red-400 shrink-0"
              >
                <Trash2 size={9} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CubeRow({ server, cube, onOpenRules, onOpenView, onOpenSubset, onOpenDim, onOpenViewer }) {
  const activeId = useContext(ActiveLocateCtx)
  const [open, setOpen] = useState(false)
  const revealTarget = useStore(s => s.revealTarget)
  const sectionId = `cube:${cube}`
  useEffect(() => {
    if (revealTarget && shouldAutoOpen(sectionId, revealTarget)) setOpen(true)
  }, [revealTarget, sectionId])
  const { data: views,    isFetching: loadingViews } = useViews(open ? server : null, open ? cube : null)
  const { data: cubeDims, isFetching: loadingDims  } = useCubeDimensions(open ? server : null, open ? cube : null)

  const [addingView, setAddingView] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const viewInputRef = useRef(null)
  const saveView = useSaveView()
  const deleteCubeMut = useDeleteCube()

  const handleDeleteCube = (e) => {
    e.stopPropagation()
    if (!window.confirm(`Delete cube "${cube}"? This cannot be undone.`)) return
    deleteCubeMut.mutate({ server, name: cube }, {
      onSuccess: () => toast.success(`Deleted ${cube}`),
      onError:   (err) => toast.error(err.message ?? 'Delete failed'),
    })
  }

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
    <div data-section={sectionId}>
      <div data-locate-id={`cube:${cube}`} className="flex items-center w-full px-6 py-0.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 mr-1.5 text-muted-foreground hover:text-foreground">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <button onClick={() => onOpenViewer(cube)} className="flex items-center flex-1 min-w-0 text-left">
          <Box size={12} className="shrink-0 text-muted-foreground mr-2" />
          <span className={cn('truncate', activeId === `cube:${cube}` && 'text-amber-400 dark:text-amber-300')}>{cube}</span>
        </button>
        {loading
        ? <Loader2 size={10} className="ml-1 animate-spin text-muted-foreground shrink-0" />
        : <span className="hidden group-hover:flex items-center shrink-0 ml-auto">
            <button onClick={handleDeleteCube} title="Delete cube"
              className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-red-400 hover:bg-sidebar-accent">
              <Trash2 size={9} />
            </button>
          </span>
      }
      </div>
      {open && <>
        <CubeSubSection label="Views" loading={loadingViews} sectionId={`cube:${cube}:views`}
          onAdd={startAddView} adding={addingView}
          addValue={newViewName} onAddChange={e => setNewViewName(e.target.value)}
          addRef={viewInputRef} onAddCommit={commitAddView} onAddCancel={() => setAddingView(false)}>
          {(views ?? []).length === 0 && !loadingViews && !addingView
            ? <p className="px-12 py-0.5 text-xs text-muted-foreground/50 italic">No views</p>
            : (views ?? []).map(v => (
                <button key={v.name} onClick={() => onOpenView(cube, v.name)}
                  data-locate-id={`view:${cube}:${v.name}`}
                  className="flex items-center gap-2 w-full px-12 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate"
                  title={v.type === 'mdx' ? 'MDX view' : 'Native view'}>
                  {v.type === 'mdx'
                    ? <Code2 size={10} className="shrink-0 text-violet-400" />
                    : <Table2 size={10} className="shrink-0 text-muted-foreground" />}
                  <span className={cn('truncate font-mono', activeId === `view:${cube}:${v.name}` && 'text-amber-400 dark:text-amber-300')}>{v.name}</span>
                </button>
              ))
          }
        </CubeSubSection>
        <CubeSubSection label="Dimensions" loading={loadingDims} sectionId={`cube:${cube}:dimensions`}>
          {(cubeDims ?? []).map(dim => (
            <CubeDimRow key={dim} server={server} dim={dim} cube={cube} onOpenSubset={onOpenSubset} onOpenDim={onOpenDim} />
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
  const revealTarget = useStore(s => s.revealTarget)
  useEffect(() => {
    if (revealTarget && shouldAutoOpen('cubes', revealTarget)) setOpen(true)
  }, [revealTarget])
  return (
    <div data-section="cubes">
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

// ── Rules Section ────────────────────────────────────────────────────────────
// Quick-access list of all cubes — clicking opens the rules editor directly.

function RulesSection({ server, cubes, isLoading, onOpenRules }) {
  const [open, setOpen] = useState(false)
  const activeId = useContext(ActiveLocateCtx)
  const revealTarget = useStore(s => s.revealTarget)
  useEffect(() => {
    if (revealTarget && shouldAutoOpen('rules', revealTarget)) setOpen(true)
  }, [revealTarget])

  return (
    <div data-section="rules">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wider"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Code2 size={12} />
        <span>Rules</span>
        {isLoading && <Loader2 size={10} className="ml-auto animate-spin" />}
      </button>
      {open && (
        <div className="pb-1">
          {(cubes ?? []).length === 0 && !isLoading && (
            <p className="px-6 py-0.5 text-xs text-muted-foreground/50 italic">No cubes</p>
          )}
          {(cubes ?? []).map(cube => (
            <button
              key={cube}
              onClick={() => onOpenRules(cube)}
              data-locate-id={`rules:${cube}`}
              className="flex items-center gap-2 w-full px-6 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group"
              title={`Open rules for ${cube}`}
            >
              <Box size={10} className="shrink-0 text-muted-foreground" />
              <span className={cn('truncate font-mono', activeId === `rules:${cube}` && 'text-amber-400 dark:text-amber-300')}>{cube}</span>
              <span className="hidden group-hover:inline text-[10px] text-muted-foreground ml-auto">Rules</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function HistorySection({ server, onOpen }) {
  const [open, setOpen] = useState(false)
  const tabHistory = useStore(s => s.tabHistory)
  const serverHistory = tabHistory.filter(h => h.server === server)
  if (serverHistory.length === 0) return null

  const typeIcon = { rules: Code2, process: Cog, subset: List, dimension: Layers, cubeview: Table2, view: Table2 }

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wider"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Clock size={12} />
        <span>History</span>
      </button>
      {open && (
        <div className="pb-1">
          {serverHistory.map(h => {
            const Icon = typeIcon[h.type] ?? Box
            return (
              <button
                key={h.id}
                onClick={() => onOpen(h)}
                className="flex items-center gap-2 w-full px-6 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate"
                title={`${h.type}: ${h.label}`}
              >
                <Icon size={11} className="shrink-0 text-muted-foreground" />
                <span className="truncate flex-1 text-left">{h.label}</span>
                <span className="text-[10px] text-muted-foreground/50 shrink-0 capitalize">{h.type}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DimRow({ server, dim, onOpenSubset, onOpenDim }) {
  const activeId = useContext(ActiveLocateCtx)
  const [open, setOpen] = useState(false)
  const revealTarget = useStore(s => s.revealTarget)
  const sectionId = `dim:${dim}`
  useEffect(() => {
    if (revealTarget && shouldAutoOpen(sectionId, revealTarget)) setOpen(true)
  }, [revealTarget, sectionId])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [addingHierarchy, setAddingHierarchy] = useState(false)
  const [newHierarchyName, setNewHierarchyName] = useState('')
  const inputRef = useRef(null)
  const hierarchyInputRef = useRef(null)
  const { data: subsets, isFetching } = useSubsets(open ? server : null, open ? dim : null)
  const { data: hierarchies = [] } = useHierarchies(open ? server : null, open ? dim : null)
  const createHierarchyMut = useCreateHierarchy()
  const hasMultipleHierarchies = hierarchies.length > 1 || addingHierarchy
  const deleteDimMut = useDeleteDimension()
  const deleteSubsetMut = useDeleteSubset()

  const handleDeleteSubset = (name) => {
    if (!window.confirm(`Delete subset "${name}"? This cannot be undone.`)) return
    deleteSubsetMut.mutate({ server, dimension: dim, name }, {
      onSuccess: () => toast.success(`Deleted ${name}`),
      onError:   (err) => toast.error(err.message ?? 'Delete failed'),
    })
  }

  const handleDelete = (e) => {
    e.stopPropagation()
    if (!window.confirm(`Delete dimension "${dim}"? This cannot be undone.`)) return
    deleteDimMut.mutate({ server, name: dim }, {
      onSuccess: () => toast.success(`Deleted ${dim}`),
      onError:   (err) => toast.error(err.message ?? 'Delete failed'),
    })
  }

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
    <div data-section={sectionId}>
      <div
        data-locate-id={`dimension:${dim}`}
        className="flex items-center w-full px-6 py-0.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group"
      >
        <button onClick={() => setOpen(o => !o)} className="shrink-0 mr-1.5 text-muted-foreground">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <Layers size={12} className="shrink-0 text-muted-foreground mr-2" />
        <span className={cn('truncate flex-1 text-left', activeId === `dimension:${dim}` && 'text-amber-400 dark:text-amber-300')}>{dim}</span>
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
          <button onClick={handleDelete} title="Delete dimension"
            className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-red-400 hover:bg-sidebar-accent">
            <Trash2 size={9} />
          </button>
        </span>
      </div>
      {open && (
        <div>
          {/* Hierarchies */}
          {hasMultipleHierarchies && (
            <div className="px-10 py-0.5">
              <div className="flex items-center justify-between mb-0.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Hierarchies</div>
                {!addingHierarchy && (
                  <button
                    onClick={() => { setAddingHierarchy(true); setNewHierarchyName(''); setTimeout(() => hierarchyInputRef.current?.focus(), 0) }}
                    className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                    title="New hierarchy"
                  >
                    <Plus size={9} />
                  </button>
                )}
              </div>
              {addingHierarchy && (
                <div className="flex items-center gap-1 px-4 py-0.5">
                  <Layers size={10} className="shrink-0 text-muted-foreground" />
                  <input
                    ref={hierarchyInputRef}
                    value={newHierarchyName}
                    onChange={e => setNewHierarchyName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newHierarchyName.trim()) {
                        createHierarchyMut.mutate({ server, dimension: dim, name: newHierarchyName.trim() }, {
                          onSuccess: () => {
                            setAddingHierarchy(false)
                            setNewHierarchyName('')
                            onOpenDim(dim, newHierarchyName.trim())
                          },
                          onError: err => toast.error(err.message),
                        })
                      }
                      if (e.key === 'Escape') { setAddingHierarchy(false); setNewHierarchyName('') }
                    }}
                    onBlur={() => { setAddingHierarchy(false); setNewHierarchyName('') }}
                    placeholder="Hierarchy name…"
                    className="flex-1 text-xs bg-transparent border-b border-primary outline-none font-mono py-px"
                  />
                </div>
              )}
              {hierarchies.map(h => (
                <button
                  key={h}
                  onClick={() => onOpenDim(dim, h)}
                  data-locate-id={`hierarchy:${dim}:${h}`}
                  className="flex items-center gap-2 w-full px-4 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate"
                  title={`Open ${h} hierarchy`}
                >
                  <Layers size={10} className="shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono">{h}</span>
                  {h === dim && <span className="text-[10px] text-muted-foreground/50">(default)</span>}
                </button>
              ))}
            </div>
          )}
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
          {(subsets ?? []).length === 0 && !isFetching && !adding && !hasMultipleHierarchies && (
            <p className="px-14 py-0.5 text-xs text-muted-foreground italic">No subsets — hover to add</p>
          )}
          {(subsets ?? []).map(s => (
            <div key={s.Name} className="flex items-center text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group">
              <button
                onClick={() => onOpenSubset(dim, s.Name)}
                data-locate-id={`subset:${dim}:${s.Name}`}
                className="flex items-center gap-2 flex-1 pl-14 pr-2 py-0.5 truncate min-w-0"
                title={s.Expression ? 'MDX subset' : 'Static subset'}
              >
                {s.Expression
                  ? <Code2 size={10} className="shrink-0 text-violet-400" />
                  : <List   size={10} className="shrink-0 text-muted-foreground" />
                }
                <span className={cn('truncate font-mono', activeId === `subset:${dim}:${s.Name}` && 'text-amber-400 dark:text-amber-300')}>{s.Name}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteSubset(s.Name) }}
                title="Delete subset"
                className="hidden group-hover:flex items-center pr-2 py-0.5 text-muted-foreground hover:text-red-400 shrink-0"
              >
                <Trash2 size={9} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DimSection({ server, dims, isLoading, onOpenSubset, onOpenDim }) {
  const [open, setOpen] = useState(false)
  const revealTarget = useStore(s => s.revealTarget)
  useEffect(() => {
    if (revealTarget && shouldAutoOpen('dimensions', revealTarget)) setOpen(true)
  }, [revealTarget])
  return (
    <div data-section="dimensions">
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

function ControlSection({ server, onOpenViewer, onOpenDim, onOpenProcess }) {
  const [open, setOpen]           = useState(false)
  const [cubesOpen, setCubesOpen] = useState(false)
  const [dimsOpen,  setDimsOpen]  = useState(false)
  const [procsOpen, setProcsOpen] = useState(false)

  // Fetch eagerly — data is ready when user opens the section
  const { data, isFetching } = useControlObjects(server)
  const cubes = data?.cubes      ?? []
  const dims  = data?.dimensions ?? []
  const procs = data?.processes  ?? []

  const SubHeader = ({ label, count, isOpen, onToggle }) => (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 w-full px-5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground"
    >
      {isOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
      <span>{label}</span>
      {isFetching
        ? <Loader2 size={9} className="ml-1 animate-spin" />
        : <span className="ml-1 text-muted-foreground/40">{count}</span>
      }
    </button>
  )

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wider"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Braces size={12} />
        <span>Control Objects</span>
      </button>

      {open && (
        <div className="pb-1">
          <SubHeader label="Cubes" count={cubes.length} isOpen={cubesOpen} onToggle={() => setCubesOpen(o => !o)} />
          {cubesOpen && cubes.map(name => (
            <button key={name} onClick={() => onOpenViewer(name)}
              className="flex items-center gap-2 w-full px-9 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate">
              <Box size={11} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{name}</span>
            </button>
          ))}

          <SubHeader label="Dimensions" count={dims.length} isOpen={dimsOpen} onToggle={() => setDimsOpen(o => !o)} />
          {dimsOpen && dims.map(name => (
            <button key={name} onClick={() => onOpenDim(name)}
              className="flex items-center gap-2 w-full px-9 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate">
              <Layers size={11} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{name}</span>
            </button>
          ))}

          {(isFetching || procs.length > 0) && (
            <>
              <SubHeader label="Processes" count={procs.length} isOpen={procsOpen} onToggle={() => setProcsOpen(o => !o)} />
              {procsOpen && procs.map(name => (
                <button key={name} onClick={() => onOpenProcess(name)}
                  className="flex items-center gap-2 w-full px-9 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate">
                  <Cog size={11} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function Explorer() {
  const { server, openTab } = useStore()
  const [search, setSearch] = useState('')
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setShowGlobalSearch(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])
  const { data: cubes,  isFetching: loadingCubes  } = useCubes(server)
  const { data: dims,   isFetching: loadingDims   } = useDims(server)
  const { data: procs,  isFetching: loadingProcs  } = useProcs(server)
  const { data: chores, isFetching: loadingChores } = useChores(server)
  const deleteProcessMut  = useDeleteProcess()
  const deleteCoreMut     = useDeleteChore()
  const createProcessMut  = useCreateProcess()

  const handleDeleteProcess = (name) => {
    if (!window.confirm(`Delete process "${name}"? This cannot be undone.`)) return
    deleteProcessMut.mutate({ server, name }, {
      onSuccess: () => toast.success(`Deleted ${name}`),
      onError:   (err) => toast.error(err.message ?? 'Delete failed'),
    })
  }

  const handleCreateProcess = (name) => {
    const id = toast.loading(`Creating "${name}"…`)
    createProcessMut.mutate({ server, name }, {
      onSuccess: () => { toast.success(`Created ${name}`, { id }); openProcess(name) },
      onError:   (err) => toast.error(err.message ?? 'Create failed', { id }),
    })
  }

  const handleDeleteChore = (name) => {
    if (!window.confirm(`Delete chore "${name}"? This cannot be undone.`)) return
    deleteCoreMut.mutate({ server, name }, {
      onSuccess: () => toast.success(`Deleted ${name}`),
      onError:   (err) => toast.error(err.message ?? 'Delete failed'),
    })
  }

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
    label:    view,
    server,
    cube,
    viewName: view,
  })

  const openDim = (dim, hierarchy = dim) => openTab({
    id:        `dim:${server}:${dim}:${hierarchy}`,
    type:      'dimension',
    label:     hierarchy === dim ? dim : `${dim} / ${hierarchy}`,
    server,
    dimension: dim,
    hierarchy,
  })

  const openChore = (name) => openTab({
    id:     `chore:${server}:${name}`,
    type:   'chore',
    label:  name,
    server,
    name,
  })

  const openProcessAtLine = useCallback((name, section, line) => openTab({
    id: `process:${server}:${name}`, type: 'process', label: name, server, name, content: null,
    ...(section && line ? { scrollToSection: section, scrollToLine: line } : {}),
  }), [server, openTab])

  const openFromHistory = (h) => openTab({ ...h, content: null })

  const tabs          = useStore(s => s.tabs)
  const groups        = useStore(s => s.groups)
  const activeGroupId = useStore(s => s.activeGroupId)
  const activeTab     = tabs.find(t => t.id === groups.find(g => g.id === activeGroupId)?.activeTabId)
  const activeLocateId = activeTab?.server === server ? getLocateIdFromTab(activeTab) : ''

  const revealTarget = useStore(s => s.revealTarget)
  const clearRevealTarget = useStore(s => s.clearRevealTarget)

  // Scroll to and highlight the revealed object in the tree
  useEffect(() => {
    if (!revealTarget || revealTarget.server !== server) return
    // Clear search so the tree is visible
    if (search) setSearch('')
    const id = getLocateId(revealTarget)
    if (!id) return
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-locate-id="${id}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.remove('tree-reveal-glow')
        void el.offsetWidth // force reflow so re-triggering works
        el.classList.add('tree-reveal-glow')
        setTimeout(() => el.classList.remove('tree-reveal-glow'), 2100)
      }
      clearRevealTarget()
    }, 400)
    return () => clearTimeout(timer)
  }, [revealTarget, server, search, clearRevealTarget])

  if (!server) {
    return (
      <div className="px-4 py-6 text-xs text-muted-foreground text-center">
        Select a server to explore objects.
      </div>
    )
  }

  const handleResultClick = (r) => {
    if (r.type === 'cube')           openCubeViewer(r.name)
    else if (r.type === 'dimension') openDim(r.name)
    else if (r.type === 'process')   openProcess(r.name)
    else if (r.type === 'chore')     openChore(r.name)
  }

  return (
    <ActiveLocateCtx.Provider value={activeLocateId}>
    {showGlobalSearch && server && (
      <GlobalSearch
        server={server}
        onOpen={openProcessAtLine}
        onClose={() => setShowGlobalSearch(false)}
      />
    )}
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
          <button
            onClick={() => setShowGlobalSearch(true)}
            title="Search code (Ctrl+Shift+F)"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            <FileSearch size={11} />
          </button>
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
              <HistorySection server={server} onOpen={openFromHistory} />
              <RulesSection server={server} cubes={cubes} isLoading={loadingCubes} onOpenRules={openRules} />
              <CubeSection server={server} cubes={cubes} isLoading={loadingCubes}
                onOpenRules={openRules} onOpenView={openView}
                onOpenSubset={openSubset} onOpenDim={openDim}
                onOpenViewer={openCubeViewer} />
              <DimSection server={server} dims={dims}    isLoading={loadingDims}   onOpenSubset={openSubset} onOpenDim={openDim} />
              <Section    icon={Cog}   label="Processes" items={procs}  isLoading={loadingProcs}  onSelect={openProcess} itemIcon={Cog}   sectionId="processes" locateIdPrefix="process" onDelete={handleDeleteProcess} onAdd={handleCreateProcess} />
              <Section    icon={Clock} label="Chores"    items={chores} isLoading={loadingChores} onSelect={openChore}   itemIcon={Clock} sectionId="chores" locateIdPrefix="chore" onDelete={handleDeleteChore} />
              <ControlSection
                server={server}
                onOpenViewer={openCubeViewer}
                onOpenDim={openDim}
                onOpenProcess={openProcess}
              />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
    </ActiveLocateCtx.Provider>
  )
}
