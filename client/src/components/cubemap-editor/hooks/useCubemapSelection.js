import { useCallback, useEffect, useMemo, useState } from 'react'
import { MAX_FOCUS_NODES, buildReverseMap, getReachable } from '@/lib/cubemap-editor/graph.js'
import { narrowToDim } from '@/lib/cubemap-editor/filters.js'
import { computePrefixGroups } from '@/lib/cubemap-editor/grouping.js'
import { pushStep, backTo, previousStep } from '@/lib/cubemap-trail'
import { rulesTabId, processTabId, dimensionTabId } from '@/lib/tab-ids'

// Which cube / module / phase the map is focused on, the trail that got us
// there, the reachable set, and every interaction that drills into the graph.
export default function useCubemapSelection({
  cubeData, processData, dimData, processCallers,
  groupRegex, prefs, srv, openTab,
  dimFilter, setDimFilter, traceKinds, traceDepth,
}) {
  const [selectedCube,   setSelectedCube]   = useState(null)
  const [moduleFocus,    setModuleFocus]    = useState(null)
  const [trail,          setTrail]          = useState([])   // focus path since the full map — see Trail below
  const [focused,        setFocused]        = useState(false)
  const [phaseFocus,     setPhaseFocus]     = useState(null)
  const [dimmedIds,      setDimmedIds]      = useState(new Set())
  const [showLegend,     setShowLegend]     = useState(prefs.showLegend ?? true)
  const [sidebarOpen,    setSidebarOpen]    = useState(prefs.sidebarOpen ?? true)
  const [advancedOpen,   setAdvancedOpen]   = useState(false)

  // Pre-computed reverse map (who references whom)
  const reverseMap = useMemo(() => cubeData ? buildReverseMap(cubeData) : {}, [cubeData])

  // ── Reachable set (focus) ─────────────────────────────────────────────────────
  // Anything reachable from the focused node (or module) through the selected
  // edge kinds, depth-limited. Node ids may be cubes, `proc:<name>` or `dim:<name>`.
  const selectedType = selectedCube?.startsWith('proc:') ? 'process' : selectedCube?.startsWith('dim:') ? 'dim' : 'cube'
  // Modules = cubes sharing a group key (from the configured regex, or the
  // underscore-prefix fallback). Used for the module lens.
  const modulesMap = useMemo(() => cubeData ? computePrefixGroups(Object.keys(cubeData), groupRegex) : {}, [cubeData, groupRegex])
  const modules = useMemo(() => Object.keys(modulesMap).sort(), [modulesMap])
  // Where a trace starts: the module's cubes, the phase's processes, or the clicked cube.
  const focusSeeds = useMemo(() => {
    if (!cubeData) return null
    if (moduleFocus) {
      const seeds = modulesMap[moduleFocus] ?? []
      return seeds.length ? seeds : null
    }
    if (phaseFocus?.processes?.length) {
      const seeds = phaseFocus.processes.map(p => `proc:${p}`).filter(id => processData[id.slice(5)])
      if (seeds.length) return seeds
    }
    return selectedCube ? [selectedCube] : null
  }, [moduleFocus, phaseFocus, selectedCube, cubeData, processData, modulesMap])

  const traceCtx = useMemo(() => ({ cubeData, processData, dimData, reverseMap, processCallers }),
    [cubeData, processData, dimData, reverseMap, processCallers])

  // A dimension filter (a 'dim' step in the thread) narrows the trace you're on, not the whole model.
  const reachableSet = useMemo(() => (focusSeeds
    ? narrowToDim(getReachable(focusSeeds, traceDepth, traceKinds, traceCtx), dimFilter, focusSeeds, cubeData ?? {}, processData ?? {})
    : null), [focusSeeds, traceDepth, traceKinds, traceCtx, dimFilter, cubeData, processData])

  // How much each Steps away setting would bring in, shown on its button before you click it.
  const stepCounts = useMemo(() => (focusSeeds
    ? [1, 2, 3, 4].map(d => narrowToDim(getReachable(focusSeeds, d, traceKinds, traceCtx), dimFilter, focusSeeds, cubeData ?? {}, processData ?? {}).size - focusSeeds.length)
    : null), [focusSeeds, traceKinds, traceCtx, dimFilter, cubeData, processData])

  // What the trace reached, by kind (folded helper processes included).
  const reachBreakdown = useMemo(() => {
    if (!reachableSet || !focusSeeds) return null
    const seeds = new Set(focusSeeds)
    const out = { cubes: 0, processes: 0, dims: 0 }
    for (const id of reachableSet) {
      if (seeds.has(id)) continue
      if (id.startsWith('proc:')) out.processes++
      else if (id.startsWith('dim:')) out.dims++
      else out.cubes++
    }
    return out
  }, [reachableSet, focusSeeds])

  const transitiveCount = reachableSet ? reachableSet.size - 1 : 0
  const reachableCapped = reachableSet ? reachableSet.size >= MAX_FOCUS_NODES : false
  const focusLabel = phaseFocus ? phaseFocus.label : moduleFocus ? `module ${moduleFocus}` : (selectedCube?.replace(/^(proc|dim):/, '') ?? '')

  // ── Interactions ──────────────────────────────────────────────────────────────
  // ── Trail: every drill since the full map, like browser history ─────────────
  // Each drill adds a step (revisiting a cube adds it again — it is a path, not a
  // set); Back removes the last step; clicking a step jumps back to it. Leaving
  // focus (Full map, Esc, empty canvas) clears it. A drill changes focus only —
  // the relayout's fitView moves the camera once; a second animation of our own
  // slid nodes under the pointer and lost clicks.
  const pushTrail = useCallback((entry) => setTrail(t => pushStep(t, entry)), [])

  const focusModule = useCallback((key) => {
    if (!key) return
    setModuleFocus(key)
    setSelectedCube(null)
    setFocused(true)
    setDimmedIds(new Set())
    setDimFilter(null)
    pushTrail({ kind: 'module', id: key })
  }, [pushTrail, setDimFilter])

  const onNodeClick = useCallback((_, node) => {
    if (node.type === 'group') { focusModule(node.data.label); return }
    setSelectedCube(node.id)
    setModuleFocus(null)
    setPhaseFocus(null)
    setFocused(true)
    setDimFilter(null)
    pushTrail({ kind: 'node', id: node.id })
  }, [focusModule, pushTrail, setDimFilter])

  const onNodeDoubleClick = useCallback((_, node) => {
    if (node.type === 'cube') {
      const hasRules = cubeData?.[node.id]?.hasRules
      openTab(hasRules
        ? { id: rulesTabId(srv, node.id),      type: 'rules',      label: node.id, server: srv, cube: node.id }
        : { id: `cubeeditor:${srv}:${node.id}`, type: 'cubeeditor', label: node.id, server: srv, cube: node.id }
      )
      return
    }
    if (node.type === 'process') {
      const name = node.id.slice('proc:'.length)
      openTab({ id: processTabId(srv, name), type: 'process', label: name, server: srv, name, content: null })
      return
    }
    if (node.type === 'dim') {
      const dim = node.id.slice('dim:'.length)
      openTab({ id: dimensionTabId(srv, dim, dim), type: 'dimension', label: dim, server: srv, dimension: dim })
    }
  }, [cubeData, openTab, srv])

  const onPaneClick = useCallback(() => {
    setModuleFocus(null); setSelectedCube(null); setPhaseFocus(null); setDimmedIds(new Set()); setFocused(false); setTrail([]); setDimFilter(null)
  }, [setDimFilter])

  const exitFocus = useCallback(() => {
    setModuleFocus(null); setSelectedCube(null); setPhaseFocus(null); setDimmedIds(new Set()); setFocused(false); setTrail([]); setDimFilter(null)
  }, [setDimFilter])

  // Esc exits focus / module view
  useEffect(() => {
    if (!focused) return
    const onKey = (e) => { if (e.key === 'Escape') exitFocus() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, exitFocus])

  // Detail-panel links drill the same way as a map click
  const navigateTo = useCallback((name) => {
    setModuleFocus(null)
    setPhaseFocus(null)
    setSelectedCube(name)
    setFocused(true)
    setDimFilter(null)
    pushTrail({ kind: 'node', id: name })
  }, [pushTrail, setDimFilter])

  const goToTrail = useCallback((index) => {
    const entry = trail[index]
    if (!entry || index === trail.length - 1) return
    setTrail(backTo(trail, index))
    setPhaseFocus(null)
    setDimmedIds(new Set())
    // A 'dim' step filters the cube or module before it.
    const base = [...trail.slice(0, index + 1)].reverse().find(e => e.kind !== 'dim')
    setDimFilter(entry.kind === 'dim' ? entry.id : null)
    if (!base) { exitFocus(); return }
    if (base.kind === 'module') { setModuleFocus(base.id); setSelectedCube(null) }
    else { setModuleFocus(null); setSelectedCube(base.id) }
    setFocused(true)
  }, [trail, exitFocus, setDimFilter])

  const trailBack = useCallback(() => {
    if (previousStep(trail)) goToTrail(trail.length - 2)
    else exitFocus()
  }, [trail, goToTrail, exitFocus])

  // Backspace or Alt+← steps back (not while typing in a field)
  useEffect(() => {
    if (!focused) return
    const onKey = (e) => {
      const el = e.target
      if (el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName)) return
      if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); trailBack() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, trailBack])

  // ── Dim filter ────────────────────────────────────────────────────────────────
  // Clicking a cube's dimension narrows the map you're on to the cubes that use it — a step in the
  // thread, so Back (or an earlier name in the thread) removes it. Clicking it again removes it too.
  const handleFilterDim = (dim) => {
    if (dimFilter === dim) { trailBack(); return }
    setDimFilter(dim)
    setDimmedIds(new Set())
    if (!focused && !selectedCube && !moduleFocus) return   // full map: plain filter
    setTrail(t => [...t.filter(e => !(e.kind === 'dim' && t.indexOf(e) === t.length - 1)), { kind: 'dim', id: dim }])
  }

  return {
    selectedCube, setSelectedCube,
    moduleFocus, setModuleFocus,
    trail, setTrail,
    focused, setFocused,
    phaseFocus, setPhaseFocus,
    dimmedIds, setDimmedIds,
    showLegend, setShowLegend,
    sidebarOpen, setSidebarOpen,
    advancedOpen, setAdvancedOpen,
    reverseMap, selectedType, modulesMap, modules, focusSeeds,
    reachableSet, stepCounts, reachBreakdown,
    transitiveCount, reachableCapped, focusLabel,
    pushTrail, focusModule, onNodeClick, onNodeDoubleClick, onPaneClick,
    exitFocus, navigateTo, goToTrail, trailBack, handleFilterDim,
  }
}
