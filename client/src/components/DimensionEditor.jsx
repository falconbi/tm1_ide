import { useMemo, useState, useCallback } from 'react'
import {
  useElements, useElementsWithIndex, useEdges, useElementAttrValues, useHierarchies,
  useAddElement, useDeleteElement, useAddEdge, useDeleteEdge, useUpdateEdgeWeight, useSetComponent,
  useDimensionUsage, useCreateHierarchy, usePreDeleteElementCheck,
} from '@/hooks/useApi'
import HierarchyFromAttributeDialog from '@/components/HierarchyFromAttributeDialog'
import { useStore } from '@/store'
import { ChevronRight, ChevronDown, Loader2, List, GitBranch, Plus, X, ClipboardList, Table2, Search, ListOrdered, MapPin, Grid3x3, Cog, HelpCircle } from 'lucide-react'
import HelpPanel from '@/components/HelpPanel'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import PicklistBuilder from './PicklistBuilder'
import AttrGrid from '@/components/dimension-editor/attrs/AttrGrid'
import StructureGrid from '@/components/dimension-editor/StructureGrid'
import ElementPanel, { AlternateBanner } from '@/components/dimension-editor/ElementPanel'
import NewDimensionScreen from '@/components/dimension-editor/NewDimensionScreen'
import BulkAddModal from '@/components/dimension-editor/dialogs/BulkAddModal'
import PreDeleteDialog from '@/components/dimension-editor/dialogs/PreDeleteDialog'
import AddRow from '@/components/dimension-editor/tree/AddRow'
import TreeNode from '@/components/dimension-editor/tree/TreeNode'
import FlatList from '@/components/dimension-editor/tree/FlatList'
import { buildTree, isUnder } from '@/lib/dimension-editor/tree'

export default function DimensionEditor({ tab }) {
  if (!tab.dimension) return <NewDimensionScreen tab={tab} />
  return <DimensionEditorCore tab={tab} />
}

function DimensionEditorCore({ tab }) {
  const [view, setView]           = useState('attrs')
  const [selected, setSelected]   = useState(null)
  const [showIndex, setShowIndex] = useState(false)
  const [addRoot, setAddRoot]     = useState(false)
  const [bulkAdd, setBulkAdd]     = useState(false)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)
  const [showCubes, setShowCubes]       = useState(false)
  const [filterSearch, setFilterSearch] = useState('')
  const [showPicklist, setShowPicklist] = useState(false)
  const [selectedHierarchy, setSelectedHierarchy] = useState(tab.hierarchy ?? tab.dimension)
  const [addingHierarchy, setAddingHierarchy] = useState(false)
  const [newHierarchyName, setNewHierarchyName] = useState('')
  const [hierMenu, setHierMenu] = useState(false)
  const [fromAttr, setFromAttr] = useState(false)
  const [deleteCheck, setDeleteCheck] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const [dragging, setDragging] = useState(null)

  const { data: elements = [], isLoading: loadingEl, refetch: refetchEl } = useElements(tab.server, tab.dimension, selectedHierarchy)
  const { data: indexedEls = [] } = useElementsWithIndex(showIndex ? tab.server : null, tab.dimension, selectedHierarchy)
  const indexMap = useMemo(() => Object.fromEntries(indexedEls.map(e => [e.Name, e.Index])), [indexedEls])
  const { data: edges    = [], isLoading: loadingEd, refetch: refetchEd } = useEdges(tab.server, tab.dimension, selectedHierarchy)
  const { data: hierarchies = [] } = useHierarchies(tab.server, tab.dimension)
  const { data: dimUsageData } = useDimensionUsage(tab.server, tab.dimension)
  const dimCubes    = dimUsageData?.cubes    ?? []
  const dimProcs    = dimUsageData?.processes ?? []
  const { data: elemAttrs, isFetching: loadingAttrs } = useElementAttrValues(tab.server, tab.dimension, selected, selectedHierarchy)

  const addElementMut     = useAddElement()
  const deleteElementMut  = useDeleteElement()
  const addEdgeMut        = useAddEdge()
  const setComponentMut   = useSetComponent()
  const deleteEdgeMut     = useDeleteEdge()
  const updateWeightMut   = useUpdateEdgeWeight()
  const createHierarchyMut = useCreateHierarchy()
  const preDeleteMut      = usePreDeleteElementCheck()

  const tree = useMemo(() => buildTree(elements, edges), [elements, edges])

  const filteredElements = useMemo(() => {
    let list = elements
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      list = list.filter(e => e.Name.toLowerCase().includes(q))
    }
    return list
  }, [elements, filterSearch])

  // Tree: the matches plus the parents above them, so a match still has a path down from the top
  const filteredTree = useMemo(() => {
    if (!filterSearch) return buildTree(elements, edges)
    const parentsOf = {}
    for (const e of edges) (parentsOf[e.ComponentName] ??= []).push(e.ParentName)
    const keep = new Set(), stack = filteredElements.map(e => e.Name)
    while (stack.length) { const n = stack.pop(); if (keep.has(n)) continue; keep.add(n); stack.push(...(parentsOf[n] ?? [])) }
    return buildTree(elements.filter(e => keep.has(e.Name)), edges.filter(e => keep.has(e.ParentName) && keep.has(e.ComponentName)))
  }, [elements, filteredElements, edges, filterSearch])

  const consolElements   = useMemo(() => elements.filter(e => e.Type === 'C'), [elements])
  const selectedEl       = selected ? tree.byName[selected] : null
  const selectedParents  = selected ? edges.filter(e => e.ComponentName === selected) : []
  const selectedChildren = selected ? edges.filter(e => e.ParentName === selected) : []

  const refresh = useCallback(() => {
    refetchEl(); refetchEd(); setError(null)
  }, [refetchEl, refetchEd])

  const run = useCallback(async (fn) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e.message); toast.error(e.message) }
    finally { setBusy(false) }
  }, [])

  const handleAddRoot = useCallback((name, type, before) => {
    setAddRoot(false)
    run(async () => {
      await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, before, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, addElementMut, tab, refresh, selectedHierarchy])

  const handleAddChild = useCallback((parent, name, type, before) => {
    run(async () => {
      await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, parent, before, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, addElementMut, tab, refresh, selectedHierarchy])

  const handleBulkAdd = useCallback((names, type, parent, before) => {
    setBulkAdd(false)
    run(async () => {
      // all names go in before the same anchor, in list order — so the block keeps
      // the order it was pasted in
      for (const name of names) {
        await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, parent, before, hierarchy: selectedHierarchy })
      }
      refresh()
    })
  }, [run, addElementMut, tab, refresh, selectedHierarchy])

  // drag an element onto a consolidation (before = null → end) or between two siblings
  const handleDropChildAt = useCallback((parent, before, child) => {
    if (!parent || !child || parent === child || before === child) return
    const parentEl = tree.byName[parent], childEl = tree.byName[child]
    if (parentEl?.Type !== 'C' || !childEl) return
    if (childEl.Type === 'S') { toast.error('String elements cannot be added under a consolidation'); return }
    if (isUnder(tree.childrenOf, child, parent)) { toast.error(`Cannot put "${child}" under its own descendant`); return }
    const existing = edges.find(e => e.ParentName === parent && e.ComponentName === child)
    run(async () => {
      await setComponentMut.mutateAsync({
        server: tab.server, dimension: tab.dimension, parent, child, before,
        weight: existing?.Weight ?? 1, hierarchy: selectedHierarchy,
      })
      refresh()
      setSelected(parent)
      toast.success(`${existing ? 'Moved' : 'Added'} ${child} under ${parent}`)
    })
  }, [tree, edges, run, setComponentMut, tab, refresh, selectedHierarchy])

  const execDelete = useCallback((name) => {
    if (selected === name) setSelected(null)
    run(async () => {
      const involving = edges.filter(e => e.ParentName === name || e.ComponentName === name)
      await Promise.all(involving.map(e =>
        deleteEdgeMut.mutateAsync({ server: tab.server, dimension: tab.dimension, parent: e.ParentName, child: e.ComponentName, hierarchy: selectedHierarchy })
      ))
      await deleteElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, selected, edges, deleteEdgeMut, deleteElementMut, tab, refresh, selectedHierarchy])

  const handleDelete = useCallback((name) => {
    const childCount = (tree.childrenOf[name] ?? []).length
    if (childCount > 0 && !window.confirm(`"${name}" has ${childCount} child${childCount !== 1 ? 'ren' : ''}. Remove all edges and delete?`)) return
    const id = toast.loading(`Checking references for "${name}"…`)
    preDeleteMut.mutateAsync({ server: tab.server, dimension: tab.dimension, element: name, hierarchy: selectedHierarchy })
      .then(result => {
        toast.dismiss(id)
        setDeleteTarget(name)
        setDeleteCheck(result)
      })
      .catch(() => {
        toast.dismiss(id)
        execDelete(name)
      })
  }, [tree, tab, selectedHierarchy, preDeleteMut, execDelete])

  const handleAddParent = useCallback((child, parent) => {
    run(async () => {
      await addEdgeMut.mutateAsync({ server: tab.server, dimension: tab.dimension, parent, child, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, addEdgeMut, tab, refresh, selectedHierarchy])

  const handleRemoveParent = useCallback((child, parent) => {
    run(async () => {
      await deleteEdgeMut.mutateAsync({ server: tab.server, dimension: tab.dimension, parent, child, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, deleteEdgeMut, tab, refresh, selectedHierarchy])

  const handleUpdateWeight = useCallback((parent, child, weight) => {
    run(async () => {
      await updateWeightMut.mutateAsync({ server: tab.server, dimension: tab.dimension, parent, child, weight, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, updateWeightMut, tab, refresh])


  if (loadingEl || loadingEd) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 size={16} className="animate-spin mr-2" /> Loading dimension…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar row 1 — title + hierarchy + actions */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted shrink-0">
        <span className="text-xs font-semibold">{tab.dimension}</span>
        <button
          onClick={() => {
            const { setRevealTarget } = useStore.getState()
            setRevealTarget({
              type: tab.hierarchy && tab.hierarchy !== tab.dimension ? 'hierarchy' : 'dimension',
              server: tab.server,
              dimension: tab.dimension,
              hierarchy: tab.hierarchy,
            })
          }}
          className="p-1 rounded hover:bg-muted text-amber-400 hover:text-amber-300 transition-colors"
          title="Show in Explorer tree"
        >
          <MapPin size={11} />
        </button>
        {hierarchies.filter(h => h !== 'Leaves').length > 1 && (
          <select
            value={selectedHierarchy}
            onChange={e => { setSelectedHierarchy(e.target.value); setSelected(null) }}
            className="text-xs bg-background border border-border rounded px-1.5 py-0.5 text-foreground max-w-36"
            title="Select hierarchy"
          >
            {hierarchies.filter(h => h !== 'Leaves').map(h => <option key={h} value={h}>{h}{h === tab.dimension ? ' (default)' : ' (alternate)'}</option>)}
          </select>
        )}
        {addingHierarchy ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newHierarchyName}
              onChange={e => setNewHierarchyName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newHierarchyName.trim()) {
                  run(async () => {
                    await createHierarchyMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name: newHierarchyName.trim() })
                    setAddingHierarchy(false)
                    setNewHierarchyName('')
                    setSelectedHierarchy(newHierarchyName.trim())
                  })
                }
                if (e.key === 'Escape') { setAddingHierarchy(false); setNewHierarchyName('') }
              }}
              onBlur={() => { setAddingHierarchy(false); setNewHierarchyName('') }}
              placeholder="Hierarchy name…"
              className="text-xs bg-background border border-primary rounded px-1.5 py-0.5 outline-none w-28"
            />
            <button onClick={() => { setAddingHierarchy(false); setNewHierarchyName('') }} className="text-muted-foreground hover:text-foreground"><X size={10} /></button>
          </div>
        ) : (
          <button
            onClick={() => setHierMenu(m => !m)}
            className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-background relative"
            title="New hierarchy"
          >
            <Plus size={9} /> Hierarchy
            {hierMenu && (
              <span className="absolute left-0 top-full mt-1 z-50 w-56 rounded border border-border bg-popover shadow-lg text-left py-1" onClick={e => e.stopPropagation()}>
                <span role="button" className="block px-3 py-1.5 hover:bg-muted text-foreground"
                  onClick={() => { setHierMenu(false); setFromAttr(true) }}>
                  From an attribute…<span className="block text-[10px] text-muted-foreground">Generated and kept in step by a process</span>
                </span>
                <span role="button" className="block px-3 py-1.5 hover:bg-muted text-foreground"
                  onClick={() => { setHierMenu(false); setAddingHierarchy(true); setNewHierarchyName('') }}>
                  Empty<span className="block text-[10px] text-muted-foreground">Built by hand in this editor</span>
                </span>
              </span>
            )}
          </button>
        )}
        <span className="text-xs text-muted-foreground">
          {filteredElements.length !== elements.length
            ? `${filteredElements.length} / ${elements.length} elements`
            : `${elements.length} elements`}
        </span>
        {busy && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
        {error && <span className="text-xs text-red-400 truncate max-w-40" title={error}>{error}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => { setAddRoot(true); setView('tree') }} disabled={busy}
            className="flex items-center gap-0.5 px-2 py-0.5 text-xs rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Plus size={10} /> Add
          </button>
          <button onClick={() => setBulkAdd(true)} disabled={busy}
            className="flex items-center gap-0.5 px-2 py-0.5 text-xs rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40">
            <ClipboardList size={10} /> Bulk
          </button>
          <span className="w-px h-4 bg-border mx-0.5" />
          <button onClick={() => setView('tree')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'tree' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <GitBranch size={11} /> Tree
          </button>
          <button onClick={() => setView('flat')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'flat' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <List size={11} /> Flat
          </button>
          <button onClick={() => setView('grid')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'grid' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <Grid3x3 size={11} /> Grid
          </button>
          <button onClick={() => setView('attrs')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'attrs' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <Table2 size={11} /> Attrs
          </button>
          <span className="w-px h-4 bg-border mx-0.5" />
          <button onClick={() => setShowIndex(v => !v)}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              showIndex ? 'bg-primary/10 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:bg-background hover:text-foreground')}
            title="Toggle element index">
            # Idx
          </button>
          <button onClick={() => setShowPicklist(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border text-muted-foreground hover:bg-background hover:text-foreground transition-colors">
            <ListOrdered size={11} /> Picklists
          </button>
          <span className="w-px h-4 bg-border mx-0.5" />
          <button onClick={() => setShowHelp(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
            title="Help — Dimension Editor">
            <HelpCircle size={11} />
          </button>
        </div>
      </div>
      <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="dimension" />
      <AlternateBanner server={tab.server} dimension={tab.dimension} hierarchy={selectedHierarchy} />
      {fromAttr && (
        <HierarchyFromAttributeDialog server={tab.server} dimension={tab.dimension} onClose={() => setFromAttr(false)}
          onDone={h => { setFromAttr(false); setSelectedHierarchy(h); setSelected(null) }} />
      )}

      {/* Toolbar row 2 — used in + filters */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/50 shrink-0 flex-wrap">
        {(dimCubes.length > 0 || dimProcs.length > 0) && (
          <span className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setShowCubes(s => !s)}
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors shrink-0">
              {showCubes ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Used in {dimCubes.length} cube{dimCubes.length !== 1 ? 's' : ''}{dimProcs.length > 0 ? `, ${dimProcs.length} TI` : ''}
            </button>
            {showCubes && <>
              {dimCubes.map(c => (
                <span key={c} className="px-1.5 py-px rounded bg-background border border-border text-[10px] font-mono text-muted-foreground">{c}</span>
              ))}
              {dimProcs.map((p, i) => (
                <span key={`p-${i}`} className="flex items-center gap-1 px-1.5 py-px rounded bg-background border border-border text-[10px] font-mono text-muted-foreground">
                  <Cog size={8} />{p.process}
                </span>
              ))}
            </>}
          </span>
        )}
        {/* the one element filter — Tree, Flat and Attrs; not Grid, which edits and applies every row */}
        <span className="ml-auto flex items-center gap-2">
          {view !== 'grid' && <div className="flex items-center gap-1 bg-background border border-border rounded px-1.5 py-0.5">
            <Search size={10} className="text-muted-foreground shrink-0" />
            <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
              placeholder="Filter elements…"
              className="text-xs bg-transparent outline-none w-28 placeholder:text-muted-foreground" />
            {filterSearch && (
              <button onClick={() => setFilterSearch('')} className="text-muted-foreground hover:text-foreground shrink-0">
                <X size={9} />
              </button>
            )}
          </div>}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {view === 'attrs' && <div className="flex-1 min-w-0 min-h-0 flex flex-col"><AttrGrid tab={tab} elements={elements} edges={edges} hierarchy={selectedHierarchy} search={filterSearch} indexMap={showIndex ? indexMap : null} /></div>}
        {view === 'grid' && <div className="flex-1 min-w-0 min-h-0 flex flex-col"><StructureGrid tab={tab} elements={elements} edges={edges} hierarchy={selectedHierarchy} onApplied={refresh} /></div>}
        {/* Tree / Flat pane */}
        {view !== 'attrs' && view !== 'grid' && <>
          <div className={cn('flex-1 min-w-0 overflow-auto', selectedEl && 'max-w-[55%]')}>
            {view === 'flat' && (
              <FlatList elements={filteredElements} selected={selected} onSelect={setSelected} onDelete={handleDelete} indexMap={showIndex ? indexMap : null} />
            )}
            {view === 'tree' && (
              <div className="p-2">
                {addRoot && <AddRow beforeOptions={selectedHierarchy === tab.dimension ? tree.roots : []} onConfirm={handleAddRoot} onCancel={() => setAddRoot(false)} />}
                {filteredTree.roots.length === 0 && !addRoot && (
                  <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                    {filterSearch ? 'No elements match the current filter.' : 'No elements. Click Add or Bulk to start.'}
                  </p>
                )}
                {filteredTree.roots.map(r => (
                  <TreeNode key={filterSearch ? `${r}|filtered` : r} filtering={!!filterSearch} name={r} childrenOf={filteredTree.childrenOf} byName={filteredTree.byName} depth={0}
                    onAddChild={handleAddChild} onDelete={handleDelete}
                    selected={selected} onSelect={setSelected} visited={new Set()} indexMap={showIndex ? indexMap : null}
                    drag={dragging} onDragStart={setDragging} onDragEnd={() => setDragging(null)} onDropChildAt={handleDropChildAt} />
                ))}
              </div>
            )}
          </div>
          {selectedEl && (
            <div className="w-[45%] shrink-0 overflow-auto">
              <ElementPanel
                server={tab.server}
                dimension={tab.dimension}
                el={selectedEl}
                parents={selectedParents}
                children={selectedChildren}
                byName={tree.byName}
                consolElements={consolElements}
                hierarchies={hierarchies}
                elemAttrs={elemAttrs}
                loadingAttrs={loadingAttrs}
                onDelete={handleDelete}
                onAddParent={parent => handleAddParent(selected, parent)}
                onRemoveParent={parent => handleRemoveParent(selected, parent)}
                onUpdateWeight={handleUpdateWeight}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </>}
      </div>

      {/* Bulk add modal */}
      {bulkAdd && (
        <BulkAddModal
          consolElements={consolElements}
          roots={tree.roots}
          childrenOf={tree.childrenOf}
          onConfirm={handleBulkAdd}
          onClose={() => setBulkAdd(false)}
        />
      )}
      {showPicklist && (
        <PicklistBuilder
          server={tab.server}
          dim={tab.dimension}
          hierarchy={selectedHierarchy}
          onClose={() => setShowPicklist(false)}
        />
      )}
      <PreDeleteDialog
        check={deleteCheck}
        elementName={deleteTarget}
        onConfirm={() => { setDeleteCheck(null); execDelete(deleteTarget); setDeleteTarget(null) }}
        onCancel={() => { setDeleteCheck(null); setDeleteTarget(null) }}
      />
    </div>
  )
}
