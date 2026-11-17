import { useCallback, useState } from 'react'
import { useCreateHierarchy } from '@/hooks/useApi'

// The open hierarchy, the add-hierarchy menu, and the from-attribute dialog.
export default function useHierarchySelection({ tab, setSelected }) {
  const [selectedHierarchy, setSelectedHierarchy] = useState(tab.hierarchy ?? tab.dimension)
  const [addingHierarchy, setAddingHierarchy] = useState(false)
  const [newHierarchyName, setNewHierarchyName] = useState('')
  const [hierMenu, setHierMenu] = useState(false)
  const [fromAttr, setFromAttr] = useState(false)
  const createHierarchyMut = useCreateHierarchy()

  const selectHierarchy = useCallback(h => { setSelectedHierarchy(h); setSelected(null) }, [setSelected])

  const handleFromAttrDone = useCallback(h => {
    setFromAttr(false)
    setSelectedHierarchy(h)
    setSelected(null)
  }, [setSelected])

  const createHierarchy = useCallback(async (name) => {
    await createHierarchyMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name })
    setAddingHierarchy(false)
    setNewHierarchyName('')
    setSelectedHierarchy(name)
  }, [createHierarchyMut, tab])

  return {
    selectedHierarchy, setSelectedHierarchy, selectHierarchy,
    addingHierarchy, setAddingHierarchy,
    newHierarchyName, setNewHierarchyName,
    hierMenu, setHierMenu,
    fromAttr, setFromAttr,
    handleFromAttrDone,
    createHierarchy,
  }
}
