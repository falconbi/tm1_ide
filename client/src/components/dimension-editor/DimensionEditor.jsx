import { useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import PicklistBuilder from '@/components/PicklistBuilder'
import DimensionToolbar from '@/components/dimension-editor/DimensionToolbar'
import AttrGrid from '@/components/dimension-editor/attrs/AttrGrid'
import StructureGrid from '@/components/dimension-editor/StructureGrid'
import useDimensionData from '@/components/dimension-editor/hooks/useDimensionData'
import useElementActions from '@/components/dimension-editor/hooks/useElementActions'
import useHierarchySelection from '@/components/dimension-editor/hooks/useHierarchySelection'
import ElementPanel from '@/components/dimension-editor/ElementPanel'
import NewDimensionScreen from '@/components/dimension-editor/NewDimensionScreen'
import BulkAddModal from '@/components/dimension-editor/dialogs/BulkAddModal'
import PreDeleteDialog from '@/components/dimension-editor/dialogs/PreDeleteDialog'
import AddRow from '@/components/dimension-editor/tree/AddRow'
import TreeNode from '@/components/dimension-editor/tree/TreeNode'
import FlatList from '@/components/dimension-editor/tree/FlatList'

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
  const [showCubes, setShowCubes]       = useState(false)
  const [filterSearch, setFilterSearch] = useState('')
  const [showPicklist, setShowPicklist] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [dragging, setDragging] = useState(null)

  const {
    selectedHierarchy, selectHierarchy, addingHierarchy, setAddingHierarchy,
    newHierarchyName, setNewHierarchyName, hierMenu, setHierMenu,
    fromAttr, setFromAttr, handleFromAttrDone, createHierarchy,
  } = useHierarchySelection({ tab, setSelected })

  const {
    elements, edges, indexMap, hierarchies, dimCubes, dimProcs, elemAttrs, loadingAttrs,
    loadingEl, loadingEd, refetchEl, refetchEd,
    tree, filteredElements, filteredTree, consolElements,
    selectedEl, selectedParents, selectedChildren,
  } = useDimensionData({ tab, selectedHierarchy, showIndex, selected, filterSearch })

  const refreshData = useCallback(() => {
    refetchEl(); refetchEd()
  }, [refetchEl, refetchEd])

  const {
    busy, error, refresh,
    deleteCheck, setDeleteCheck, deleteTarget, setDeleteTarget,
    run, handleAddRoot, handleAddChild, handleBulkAdd, handleDropChildAt,
    execDelete, handleDelete, handleAddParent, handleRemoveParent, handleUpdateWeight,
  } = useElementActions({
    tab, tree, edges, selected, setSelected, refresh: refreshData, selectedHierarchy,
    closeAddRoot: () => setAddRoot(false),
    closeBulkAdd: () => setBulkAdd(false),
  })

  if (loadingEl || loadingEd) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 size={16} className="animate-spin mr-2" /> Loading dimension…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <DimensionToolbar
        tab={tab}
        view={view} setView={setView}
        hierarchies={hierarchies}
        selectedHierarchy={selectedHierarchy}
        onSelectHierarchy={selectHierarchy}
        addingHierarchy={addingHierarchy} setAddingHierarchy={setAddingHierarchy}
        newHierarchyName={newHierarchyName} setNewHierarchyName={setNewHierarchyName}
        hierMenu={hierMenu} setHierMenu={setHierMenu}
        fromAttr={fromAttr} setFromAttr={setFromAttr}
        handleFromAttrDone={handleFromAttrDone}
        createHierarchy={createHierarchy} run={run}
        filteredElements={filteredElements} elements={elements}
        busy={busy} error={error}
        setAddRoot={setAddRoot} setBulkAdd={setBulkAdd}
        showIndex={showIndex} setShowIndex={setShowIndex}
        setShowPicklist={setShowPicklist} showHelp={showHelp} setShowHelp={setShowHelp}
        dimCubes={dimCubes} dimProcs={dimProcs}
        showCubes={showCubes} setShowCubes={setShowCubes}
        filterSearch={filterSearch} setFilterSearch={setFilterSearch}
      />

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
