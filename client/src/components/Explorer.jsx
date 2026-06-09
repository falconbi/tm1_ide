import { useState, useRef, useMemo, useEffect, createContext, useContext, useCallback } from 'react'
import { toast } from 'sonner'
import { useCubes, useDims, useProcs, useChores, useSubsets, useViews, useCubeDimensions, useSaveView, useHierarchies, useCreateHierarchy, useControlObjects, useDeleteDimension, useDeleteCube, useDeleteProcess, useDeleteChore, useDeleteSubset } from '@/hooks/useApi'
import { useStore } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronRight, ChevronDown, Box, Layers, Cog, Clock, Loader2, List, Plus, Table2, Code2, Sigma, PencilLine, Search, X, Braces, Trash2, FileSearch, Database, Tag } from 'lucide-react'
import GlobalSearch from '@/components/GlobalSearch'
import { DeleteWarningModal } from '@/components/DeleteWarningModal'
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
  if (tab.type === 'subset')    return tab.subsetName ? `subset:${tab.dimension}:${tab.subsetName}` : `dimension:${tab.dimension}`
  if (tab.type === 'dimension') return `dimension:${tab.dimension}`
  if (tab.type === 'chore')     return `chore:${tab.name}`
  return ''
}

const ActiveLocateCtx = createContext('')

function NamePopover({ open, onCommit, onCancel, placeholder = 'name…' }) {
  const inputRef = useRef(null)
  const [value, setValue] = useState('')
  useEffect(() => { if (open) { setValue(''); setTimeout(() => inputRef.current?.focus(), 0) } }, [open])
  if (!open) return null
  const commit = () => { const n = value.trim(); if (n) onCommit(n); else onCancel() }
  return (
    <div className="absolute right-0 top-full mt-0.5 z-50 w-52 rounded-md border border-border bg-popover p-2 shadow-lg flex flex-col gap-1.5">
      <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel() }}
        placeholder={placeholder}
        className="text-xs bg-transparent border-b border-primary outline-none font-mono py-px w-full" />
      <div className="flex gap-1 justify-end pt-0.5">
        <button onClick={onCancel}
          className="text-[10px] px-2 py-0.5 rounded hover:bg-muted text-muted-foreground">Cancel</button>
        <button onClick={commit}
          className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90">Create</button>
      </div>
    </div>
  )
}

function Section({ icon: Icon, label, items, isLoading, onSelect, itemIcon: ItemIcon, sectionId, locateIdPrefix, onDelete, onAdd }) {
  const [open, setOpen] = useState(false)
  const activeId = useContext(ActiveLocateCtx)
  const revealTarget = useStore(s => s.revealTarget)
  useEffect(() => {
    if (revealTarget && shouldAutoOpen(sectionId, revealTarget)) setOpen(true)
  }, [revealTarget, sectionId])

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
            onClick={() => { setOpen(true); onAdd() }}
            title={`New ${label.toLowerCase().replace(/s$/, '')}`}
            className="hidden group-hover:flex items-center ml-1 text-muted-foreground hover:text-foreground shrink-0"
          >
            <Plus size={11} />
          </button>
        )}
      </div>
      {open && (
        <div className="pb-1">
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

function CubeSubSection({ label, loading, children, onAdd, sectionId }) {
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
        {onAdd && (
          <button onClick={() => onAdd()}
            className="hidden group-hover:flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent shrink-0 ml-auto transition-colors"
            title={`New ${label.toLowerCase()}`}>
            <Plus size={9} />
          </button>
        )}
      </div>
      {open && children}
    </div>
  )
}

// Dimension row inside a cube — shows subsets on expand
function CubeDimRow({ server, dim, onOpenSubset, onOpenDim, cube }) {
  const [open, setOpen] = useState(false)
  const [deleteModal, setDeleteModal] = useState(null)
  const { data: subsets, isFetching } = useSubsets(open ? server : null, open ? dim : null)
  const sectionId = `cube:${cube}:dim:${dim}`
  const deleteSubsetMut = useDeleteSubset()

  const confirmDeleteSubset = () => {
    const name = deleteModal
    setDeleteModal(null)
    deleteSubsetMut.mutate({ server, dimension: dim, name }, {
      onSuccess: () => toast.success(`Deleted ${name}`),
      onError:   (err) => toast.error(err.message ?? 'Delete failed'),
    })
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
            : <button onClick={(e) => { e.stopPropagation(); setOpen(true); onOpenSubset(dim, null) }} title="New subset"
                className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent">
                <Plus size={9} /> Subset
              </button>
          }
        </span>
      </div>
      {open && (
        <div>
          {(subsets ?? []).length === 0 && !isFetching && (
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
                onClick={(e) => { e.stopPropagation(); setDeleteModal(s.Name) }}
                title="Delete subset"
                className="hidden group-hover:flex items-center pr-2 py-0.5 text-muted-foreground hover:text-red-400 shrink-0"
              >
                <Trash2 size={9} />
              </button>
            </div>
          ))}
        </div>
      )}
      <DeleteWarningModal open={!!deleteModal} type="subset" name={deleteModal} server={server}
        dimension={dim} onClose={() => setDeleteModal(null)} onConfirm={confirmDeleteSubset} />
    </div>
  )
}

function CubeRow({ server, cube, onOpenRules, onOpenView, onOpenSubset, onOpenDim, onOpenViewer, onOpenCubeEditor }) {
  const activeId = useContext(ActiveLocateCtx)
  const [open, setOpen] = useState(false)
  const revealTarget = useStore(s => s.revealTarget)
  const sectionId = `cube:${cube}`
  useEffect(() => {
    if (revealTarget && shouldAutoOpen(sectionId, revealTarget)) setOpen(true)
  }, [revealTarget, sectionId])
  const { data: views,    isFetching: loadingViews } = useViews(open ? server : null, open ? cube : null)
  const { data: cubeDims, isFetching: loadingDims  } = useCubeDimensions(open ? server : null, open ? cube : null)

  const [deleteModal, setDeleteModal] = useState(false)
  const saveView = useSaveView()
  const deleteCubeMut = useDeleteCube()

  const handleDeleteCube = (e) => { e.stopPropagation(); setDeleteModal(true) }
  const confirmDeleteCube = () => {
    setDeleteModal(false)
    deleteCubeMut.mutate({ server, name: cube }, {
      onSuccess: () => toast.success(`Deleted ${cube}`),
      onError:   (err) => toast.error(err.message ?? 'Delete failed'),
    })
  }

  const handleAddView = () => {
    openTab({ id: `guidedmdxview:${server}:${cube}:${Date.now()}`, type: 'guidedmdxview', label: `Builder — ${cube}`, server, initialState: { selectedCube: cube, step: 1 } })
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
            <button onClick={e => { e.stopPropagation(); onOpenCubeEditor?.(cube) }} title="Edit cube structure"
              className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent">
              <PencilLine size={9} />
            </button>
            <button onClick={e => { e.stopPropagation(); openTab({ id: `guidedmdxview:${server}:${cube}:${Date.now()}`, type: 'guidedmdxview', label: `Builder — ${cube}`, server, initialState: { selectedCube: cube, step: 1 } }) }} title="Build MDX View"
              className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent">
              <Braces size={9} />
            </button>
            <button onClick={handleDeleteCube} title="Delete cube"
              className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:text-red-400 hover:bg-sidebar-accent">
              <Trash2 size={9} />
            </button>
          </span>
      }
      </div>
      {open && <>
        <CubeSubSection label="Views" loading={loadingViews} sectionId={`cube:${cube}:views`}
          onAdd={handleAddView}>
          {(views ?? []).length === 0 && !loadingViews
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
          <Sigma size={10} className="shrink-0 text-muted-foreground" />
          <span>Rules</span>
        </button>
      </>}
      <DeleteWarningModal open={deleteModal} type="cube" name={cube} server={server}
        onClose={() => setDeleteModal(false)} onConfirm={confirmDeleteCube} />
    </div>
  )
}

function CubeSection({ server, cubes, isLoading, onOpenRules, onOpenView, onOpenSubset, onOpenDim, onOpenViewer, onOpenCubeEditor }) {
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
        {isLoading
          ? <Loader2 size={10} className="ml-auto animate-spin" />
          : <button onClick={e => { e.stopPropagation(); onOpenCubeEditor(null) }}
              title="New cube"
              className="ml-auto p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <Plus size={11} />
            </button>
        }
      </button>
      {open && (
        <div className="pb-1">
          {(cubes ?? []).map(cube => (
            <CubeRow key={cube} server={server} cube={cube}
              onOpenRules={onOpenRules} onOpenView={onOpenView}
              onOpenSubset={onOpenSubset} onOpenDim={onOpenDim}
              onOpenViewer={onOpenViewer} onOpenCubeEditor={onOpenCubeEditor} />
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
        <Sigma size={12} />
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

  const typeIcon = {
    rules: Code2, process: Cog, subset: List, dimension: Layers,
    cubeview: Table2, view: Table2, sql: Database, guidedmdxview: Braces,
  }
  const typeLabel = {
    rules: 'Rules', process: 'Process', subset: 'Subset', dimension: 'Dimension',
    cubeview: 'View', view: 'View', sql: 'SQL', guidedmdxview: 'MDX Builder',
  }

  // SQL/MDX Builder tabs have no server — show them regardless
  const visible = tabHistory.filter(h => h.server === server || !h.server)
  if (visible.length === 0) return null

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
          {visible.map(h => {
            const Icon = typeIcon[h.type] ?? Box
            return (
              <button
                key={h.id}
                onClick={() => onOpen(h)}
                className="flex items-center gap-2 w-full px-6 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground truncate"
                title={`${typeLabel[h.type] ?? h.type}: ${h.label}`}
              >
                <Icon size={11} className="shrink-0 text-muted-foreground" />
                <span className="truncate flex-1 text-left">{h.label}</span>
                <span className="text-[10px] text-muted-foreground/50 shrink-0">{typeLabel[h.type] ?? h.type}</span>
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
  const [addingHierarchy, setAddingHierarchy] = useState(false)
  const [newHierarchyName, setNewHierarchyName] = useState('')
  const hierarchyInputRef = useRef(null)
  const { data: subsets, isFetching } = useSubsets(open ? server : null, open ? dim : null)
  const { data: hierarchies = [] } = useHierarchies(open ? server : null, open ? dim : null)
  const createHierarchyMut = useCreateHierarchy()
  const hasMultipleHierarchies = hierarchies.length > 1 || addingHierarchy
  const deleteDimMut = useDeleteDimension()
  const deleteSubsetMut = useDeleteSubset()

  const [deleteModal, setDeleteModal] = useState(null)

  const handleDeleteSubset = (name) => setDeleteModal({ type: 'subset', name })
  const handleDelete = (e) => { e.stopPropagation(); setDeleteModal({ type: 'dimension' }) }

  const confirmDelete = () => {
    const m = deleteModal
    setDeleteModal(null)
    if (m.type === 'subset') {
      deleteSubsetMut.mutate({ server, dimension: dim, name: m.name }, {
        onSuccess: () => {
          toast.success(`Deleted ${m.name}`)
          const { tabs, closeTab } = useStore.getState()
          tabs
            .filter(t => t.id === `subset:${server}:${dim}:${m.name}`)
            .forEach(t => closeTab(t.id))
        },
        onError: (err) => toast.error(err.message ?? 'Delete failed'),
      })
    } else {
      deleteDimMut.mutate({ server, name: dim }, {
        onSuccess: () => {
          toast.success(`Deleted ${dim}`)
          const { tabs, closeTab } = useStore.getState()
          tabs
            .filter(t => t.id.startsWith(`dim:${server}:${dim}:`) || t.id.startsWith(`subset:${server}:${dim}:`))
            .forEach(t => closeTab(t.id))
        },
        onError: (err) => toast.error(err.message ?? 'Delete failed'),
      })
    }
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
            : <button onClick={(e) => { e.stopPropagation(); setOpen(true); onOpenSubset(dim, null) }} title="New subset"
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
          {(subsets ?? []).length === 0 && !isFetching && !hasMultipleHierarchies && (
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
      <DeleteWarningModal
        open={!!deleteModal}
        type={deleteModal?.type === 'dimension' ? 'dimension' : 'subset'}
        name={deleteModal?.type === 'dimension' ? dim : deleteModal?.name}
        server={server}
        dimension={deleteModal?.type === 'subset' ? dim : undefined}
        onClose={() => setDeleteModal(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function DimSection({ server, dims, isLoading, onOpenSubset, onOpenDim, onCreateDim }) {
  const [open, setOpen] = useState(false)
  const revealTarget = useStore(s => s.revealTarget)
  useEffect(() => {
    if (revealTarget && shouldAutoOpen('dimensions', revealTarget)) setOpen(true)
  }, [revealTarget])

  return (
    <div data-section="dimensions">
      <div className="flex items-center w-full px-3 py-1 group">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 flex-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wider"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Layers size={12} />
          <span>Dimensions</span>
        </button>
        {isLoading
          ? <Loader2 size={10} className="ml-auto animate-spin" />
          : <button onClick={e => { e.stopPropagation(); onCreateDim() }} title="New dimension"
              className="hidden group-hover:flex ml-auto p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <Plus size={11} />
            </button>
        }
      </div>
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

// ── SQL / ODBC section ────────────────────────────────────────────────────────

// ── Control object classifiers ────────────────────────────────────────────────
const CUBE_GROUPS = [
  { id: 'picklist',  label: 'Picklist Cubes',   match: n => n.startsWith('}PickList_') },
  { id: 'attribute', label: 'Attribute Cubes',  match: n => n.startsWith('}ElementAttributes_') },
  { id: 'security',  label: 'Security Cubes',   match: n => n.startsWith('}ElementSecurity_') || ['}ClientGroups','}ClientProperties','}GroupProperties','}Clients','}Groups'].includes(n) },
  { id: 'stats',     label: 'Statistics Cubes', match: n => n.startsWith('}Stats_') },
  { id: 'other',     label: 'Other Cubes',      match: () => true },
]
const DIM_GROUPS = [
  { id: 'attribute', label: 'Attribute Dims',   match: n => n.startsWith('}ElementAttributes_') },
  { id: 'security',  label: 'Security Dims',    match: n => ['}Clients','}Groups','}GroupProperties','}ClientProperties'].some(p => n === p || n.startsWith(p)) },
  { id: 'hierarchy', label: 'Hierarchy Dims',   match: n => n.startsWith('}Hierarchies_') },
  { id: 'other',     label: 'Other Dims',       match: () => true },
]

function classify(items, groups) {
  const result = groups.map(g => ({ ...g, items: [] }))
  for (const name of items) {
    const g = result.find(g => g.match(name))
    if (g) g.items.push(name)
  }
  return result.filter(g => g.items.length > 0)
}

// Lightweight expandable cube row for control objects (Views only, no rules/editor)
function CtrlCubeRow({ server, name, onOpenViewer, onOpenView }) {
  const [open, setOpen] = useState(false)
  const { data: views, isFetching } = useViews(open ? server : null, open ? name : null)
  return (
    <div>
      <div className="flex items-center group w-full px-9 hover:bg-sidebar-accent">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 mr-1 text-muted-foreground/50 hover:text-muted-foreground">
          {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        </button>
        <button onClick={() => onOpenViewer(name)} className="flex items-center gap-2 flex-1 min-w-0 py-0.5 text-xs text-sidebar-foreground truncate">
          <Box size={11} className="shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </button>
      </div>
      {open && (
        <div>
          {isFetching && <div className="px-14 py-0.5 text-[10px] text-muted-foreground flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> Loading…</div>}
          {(views ?? []).map(v => (
            <button key={v.name} onClick={() => onOpenView(name, v.name)}
              className="flex items-center gap-2 w-full px-14 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent truncate">
              <Table2 size={10} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{v.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Lightweight expandable dim row for control objects (Subsets only)
function CtrlDimRow({ server, name, onOpenDim, onOpenSubset }) {
  const [open, setOpen] = useState(false)
  const { data: subsets, isFetching } = useSubsets(open ? server : null, open ? name : null)
  return (
    <div>
      <div className="flex items-center group w-full px-9 hover:bg-sidebar-accent">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 mr-1 text-muted-foreground/50 hover:text-muted-foreground">
          {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        </button>
        <button onClick={() => onOpenDim(name)} className="flex items-center gap-2 flex-1 min-w-0 py-0.5 text-xs text-sidebar-foreground truncate">
          <Layers size={11} className="shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </button>
      </div>
      {open && (
        <div>
          {isFetching && <div className="px-14 py-0.5 text-[10px] text-muted-foreground flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> Loading…</div>}
          {(subsets ?? []).map(s => (
            <button key={s.Name} onClick={() => onOpenSubset(name, s.Name)}
              className="flex items-center gap-2 w-full px-14 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent truncate">
              <List size={10} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{s.Name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ControlSection({ server, onOpenViewer, onOpenDim, onOpenProcess, onOpenView, onOpenSubset }) {
  const [open, setOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState({})

  const { data, isFetching } = useControlObjects(server)
  const cubes = data?.cubes      ?? []
  const dims  = data?.dimensions ?? []
  const procs = data?.processes  ?? []

  const cubeGroups = useMemo(() => classify(cubes, CUBE_GROUPS), [cubes])
  const dimGroups  = useMemo(() => classify(dims,  DIM_GROUPS),  [dims])

  const toggleGroup = id => setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }))

  const GroupHeader = ({ id, label, count }) => (
    <button onClick={() => toggleGroup(id)}
      className="flex items-center gap-1.5 w-full px-5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground">
      {openGroups[id] ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
      <span>{label}</span>
      <span className="ml-1 text-muted-foreground/40">{count}</span>
    </button>
  )

  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wider">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Braces size={12} />
        <span>Control Objects</span>
        {isFetching && <Loader2 size={10} className="ml-1 animate-spin" />}
      </button>

      {open && (
        <div className="pb-1">
          {/* ── Cubes ── */}
          <GroupHeader id="cubes-top" label={`Cubes (${cubes.length})`} count={null} />
          {openGroups['cubes-top'] && cubeGroups.map(g => (
            <div key={g.id}>
              <button onClick={() => toggleGroup(`cube-${g.id}`)}
                className="flex items-center gap-1.5 w-full px-7 py-0.5 text-[10px] font-medium text-muted-foreground/60 hover:text-muted-foreground">
                {openGroups[`cube-${g.id}`] ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
                <span>{g.label}</span>
                <span className="ml-1 text-muted-foreground/40">{g.items.length}</span>
              </button>
              {openGroups[`cube-${g.id}`] && g.items.map(name => (
                <CtrlCubeRow key={name} server={server} name={name} onOpenViewer={onOpenViewer} onOpenView={onOpenView} />
              ))}
            </div>
          ))}

          {/* ── Dimensions ── */}
          <GroupHeader id="dims-top" label={`Dimensions (${dims.length})`} count={null} />
          {openGroups['dims-top'] && dimGroups.map(g => (
            <div key={g.id}>
              <button onClick={() => toggleGroup(`dim-${g.id}`)}
                className="flex items-center gap-1.5 w-full px-7 py-0.5 text-[10px] font-medium text-muted-foreground/60 hover:text-muted-foreground">
                {openGroups[`dim-${g.id}`] ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
                <span>{g.label}</span>
                <span className="ml-1 text-muted-foreground/40">{g.items.length}</span>
              </button>
              {openGroups[`dim-${g.id}`] && g.items.map(name => (
                <CtrlDimRow key={name} server={server} name={name} onOpenDim={onOpenDim} onOpenSubset={onOpenSubset} />
              ))}
            </div>
          ))}

          {/* ── Processes ── */}
          {procs.length > 0 && (
            <div>
              <GroupHeader id="procs-top" label={`Processes (${procs.length})`} count={null} />
              {openGroups['procs-top'] && procs.map(name => (
                <button key={name} onClick={() => onOpenProcess(name)}
                  className="flex items-center gap-2 w-full px-9 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent truncate">
                  <Cog size={11} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{name}</span>
                </button>
              ))}
            </div>
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

  const openNewProcess = () => openTab({
    id: `process:${server}:new:${Date.now()}`,
    type: 'process',
    label: 'New Process',
    server,
    name: null,
  })

  const [deleteModal, setDeleteModal] = useState(null)

  const handleDeleteProcess = (name) => setDeleteModal(name)
  const confirmDeleteProcess = () => {
    const name = deleteModal
    setDeleteModal(null)
    deleteProcessMut.mutate({ server, name }, {
      onSuccess: () => toast.success(`Deleted ${name}`),
      onError:   (err) => toast.error(err.message ?? 'Delete failed'),
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
    id:         name ? `subset:${server}:${dim}:${name}` : `subset:${server}:${dim}:new:${Date.now()}`,
    type:       'subset',
    label:      name ?? 'New Subset',
    server,
    dimension:  dim,
    subsetName: name ?? null,
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

  const openDim = (dim, hierarchy) => openTab({
    id:        dim ? `dim:${server}:${dim}:${hierarchy ?? dim}` : `dim:${server}:new:${Date.now()}`,
    type:      'dimension',
    label:     dim ? (hierarchy && hierarchy !== dim ? `${dim} / ${hierarchy}` : dim) : 'New Dimension',
    server,
    dimension: dim ?? null,
    hierarchy: dim ? (hierarchy ?? dim) : null,
  })

  const openCubeEditor = (cube) => openTab({
    id:     cube ? `cubeeditor:${server}:${cube}` : `cubeeditor:${server}:new:${Date.now()}`,
    type:   'cubeeditor',
    label:  cube ?? 'New Cube',
    server,
    cube:   cube ?? null,
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
    const delay = revealTarget?.type === 'subset' ? 800 : 400
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
    }, delay)
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
                onOpenViewer={openCubeViewer} onOpenCubeEditor={openCubeEditor} />
              <DimSection server={server} dims={dims}    isLoading={loadingDims}   onOpenSubset={openSubset} onOpenDim={openDim} onCreateDim={() => openDim(null)} />
              <Section    icon={Cog}   label="Processes" items={procs}  isLoading={loadingProcs}  onSelect={openProcess} itemIcon={Cog}   sectionId="processes" locateIdPrefix="process" onDelete={handleDeleteProcess} onAdd={openNewProcess} />
              <Section    icon={Clock} label="Chores"    items={chores} isLoading={loadingChores} onSelect={openChore}   itemIcon={Clock} sectionId="chores" locateIdPrefix="chore" onDelete={handleDeleteChore} />
              <ControlSection
                server={server}
                onOpenViewer={openCubeViewer}
                onOpenDim={openDim}
                onOpenProcess={openProcess}
                onOpenView={openView}
                onOpenSubset={openSubset}
              />

            </>
          )}
        </div>
      </ScrollArea>
      <DeleteWarningModal open={!!deleteModal} type="process" name={deleteModal} server={server}
        onClose={() => setDeleteModal(null)} onConfirm={confirmDeleteProcess} />
    </div>
    </ActiveLocateCtx.Provider>
  )
}
