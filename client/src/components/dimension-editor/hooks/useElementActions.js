import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import {
  useAddElement, useDeleteElement, useAddEdge, useDeleteEdge, useUpdateEdgeWeight,
  useSetComponent, usePreDeleteElementCheck,
} from '@/hooks/useApi'
import { isUnder } from '@/lib/dimension-editor/tree'

// Element and edge writes: add, bulk add, drag, delete (with its pre-delete
// check), parents and weight. Busy/error and the delete dialog live here too.
export default function useElementActions({
  tab, tree, edges, selected, setSelected, refresh: refreshData, selectedHierarchy,
  closeAddRoot, closeBulkAdd,
}) {
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)
  const [deleteCheck, setDeleteCheck] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const addElementMut     = useAddElement()
  const deleteElementMut  = useDeleteElement()
  const addEdgeMut        = useAddEdge()
  const setComponentMut   = useSetComponent()
  const deleteEdgeMut     = useDeleteEdge()
  const updateWeightMut   = useUpdateEdgeWeight()
  const preDeleteMut      = usePreDeleteElementCheck()

  const refresh = useCallback(() => {
    refreshData(); setError(null)
  }, [refreshData])

  const run = useCallback(async (fn) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e.message); toast.error(e.message) }
    finally { setBusy(false) }
  }, [])

  const handleAddRoot = useCallback((name, type, before) => {
    closeAddRoot()
    run(async () => {
      await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, before, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, addElementMut, tab, refresh, selectedHierarchy, closeAddRoot])

  const handleAddChild = useCallback((parent, name, type, before) => {
    run(async () => {
      await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, parent, before, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, addElementMut, tab, refresh, selectedHierarchy])

  const handleBulkAdd = useCallback((names, type, parent, before) => {
    closeBulkAdd()
    run(async () => {
      // all names go in before the same anchor, in list order — so the block keeps
      // the order it was pasted in
      for (const name of names) {
        await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, parent, before, hierarchy: selectedHierarchy })
      }
      refresh()
    })
  }, [run, addElementMut, tab, refresh, selectedHierarchy, closeBulkAdd])

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
  }, [tree, edges, run, setComponentMut, tab, refresh, selectedHierarchy, setSelected])

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
  }, [run, selected, edges, deleteEdgeMut, deleteElementMut, tab, refresh, selectedHierarchy, setSelected])

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
  }, [run, updateWeightMut, tab, refresh, selectedHierarchy])

  return {
    busy, error, refresh, run,
    deleteCheck, setDeleteCheck, deleteTarget, setDeleteTarget,
    handleAddRoot, handleAddChild, handleBulkAdd, handleDropChildAt,
    execDelete, handleDelete, handleAddParent, handleRemoveParent, handleUpdateWeight,
  }
}
