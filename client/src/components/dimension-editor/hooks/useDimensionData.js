import { useMemo } from 'react'
import {
  useElements, useElementsWithIndex, useEdges, useElementAttrValues,
  useHierarchies, useDimensionUsage,
} from '@/hooks/useApi'
import { buildTree } from '@/lib/dimension-editor/tree'

// Elements, edges and everything derived from them for the open hierarchy.
export default function useDimensionData({ tab, selectedHierarchy, showIndex, selected, filterSearch }) {
  const { data: elements = [], isLoading: loadingEl, refetch: refetchEl } = useElements(tab.server, tab.dimension, selectedHierarchy)
  const { data: indexedEls = [] } = useElementsWithIndex(showIndex ? tab.server : null, tab.dimension, selectedHierarchy)
  const indexMap = useMemo(() => Object.fromEntries(indexedEls.map(e => [e.Name, e.Index])), [indexedEls])
  const { data: edges    = [], isLoading: loadingEd, refetch: refetchEd } = useEdges(tab.server, tab.dimension, selectedHierarchy)
  const { data: hierarchies = [] } = useHierarchies(tab.server, tab.dimension)
  const { data: dimUsageData } = useDimensionUsage(tab.server, tab.dimension)
  const dimCubes    = dimUsageData?.cubes    ?? []
  const dimProcs    = dimUsageData?.processes ?? []
  const { data: elemAttrs, isFetching: loadingAttrs } = useElementAttrValues(tab.server, tab.dimension, selected, selectedHierarchy)

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

  return {
    elements, edges, indexMap, hierarchies, dimCubes, dimProcs, elemAttrs, loadingAttrs,
    loadingEl, loadingEd, refetchEl, refetchEd,
    tree, filteredElements, filteredTree, consolElements,
    selectedEl, selectedParents, selectedChildren,
  }
}
