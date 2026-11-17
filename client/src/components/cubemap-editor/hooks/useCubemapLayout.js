import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNodesState, useEdgesState, useReactFlow } from '@xyflow/react'
import { FIT_MAX_ZOOM, FIT_MIN_ZOOM_FULL, applyDagreLayout } from '@/lib/cubemap-editor/layout.js'
import { applyLensActions, processRoots, foldProcesses } from '@/lib/cubemap-editor/filters.js'
import { applyGrouping } from '@/lib/cubemap-editor/grouping.js'
import { PROCESS_EDGE_TYPES } from '../graph/edgeTypes'

// The drawn graph: which nodes, edges and clusters are on the canvas, dagre
// positions, the fit-to-screen camera, dimming/spotlight, and the process-chain
// folds. Also writes the per-server view prefs after any of the controls change.
export default function useCubemapLayout({
  prefs, prefsKey, groupRegex,
  processDataAll, processCallers, lensUsage,
  cubeData, processData, dimData,
  allTI, showDims, showProcesses, showCalc, showFeeders, dimFilter,
  traceKinds, traceDepth, showLensActions, dimSpotlight,
  selectedCube, focused, reachableSet, focusSeeds, dimmedIds, setDimmedIds,
  runScope, runHighlight, showRunningRef,
  showLegend, scope, sidebarOpen,
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [layout,         setLayout]         = useState(prefs.layout ?? 'LR')
  const [showClusters,   setShowClusters]   = useState(prefs.showClusters ?? false)
  const [expandedFolds,  setExpandedFolds]  = useState(() => new Set())   // process chains opened out on the map
  const [fitTick,        setFitTick]        = useState(0)   // bumped on every map rebuild; the fit effect watches it
  const toggleFold = useCallback(name => setExpandedFolds(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  }), [])

  const procRoots = useMemo(() => processRoots(processDataAll ?? {}, processCallers ?? {}), [processDataAll, processCallers])
  const { fitView } = useReactFlow()

  // ── Build graph ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cubeData) return

    // Playback scope: show only the processes/cubes/dims the run touches, so a
    // single-process movie is not shrunk to fit the whole model.
    if (runScope) {
      const isP = id => id.startsWith('proc:') && processData[id.slice(5)]
      const isD = id => id.startsWith('dim:') && dimData[id.slice(4)]
      const ids = [...runScope.nodes].filter(id => cubeData[id] || isP(id) || isD(id))
      const nodeSet = new Set(ids)
      const rawNodes = ids.map(id => {
        if (isP(id)) return { id, type: 'process', data: { label: id.slice(5) }, position: { x: 0, y: 0 } }
        if (isD(id)) return { id, type: 'dim', data: { label: id.slice(4) }, position: { x: 0, y: 0 } }
        const d = cubeData[id]
        return { id, type: 'cube', data: { label: id, hasRules: d?.hasRules, ruleLoc: d?.ruleLoc ?? 0, dimCount: d?.dims?.length ?? 0 }, position: { x: 0, y: 0 } }
      })
      // Build the edges from the run's own ids, so the Show highlight matches exactly.
      const EDGE_TYPE = { read: 'process_read', write: 'process_write', call: 'process_call', dimwrite: 'process_dimwrite', calc: 'rule_calc', feeder: 'rule_feeder', dimuse: 'dim_used_by' }
      const rawEdges = []
      for (const eid of runScope.edges) {
        const i1 = eid.indexOf(':')
        const kind = eid.slice(0, i1)
        const rest = eid.slice(i1 + 1)
        const i2 = rest.indexOf(':')
        if (i2 < 0) continue
        const a = rest.slice(0, i2), b = rest.slice(i2 + 1)
        const map = {
          read:      [a, `proc:${b}`],
          write:     [`proc:${a}`, b],
          call:      [`proc:${a}`, `proc:${b}`],
          dimwrite:  [`proc:${a}`, `dim:${b}`],
          calc:      [a, b],
          feeder:    [a, b],
          dimuse:    [`dim:${a}`, b],
        }[kind]
        if (!map) continue
        const [source, target] = map
        if (nodeSet.has(source) && nodeSet.has(target)) rawEdges.push({ id: eid, source, target, type: EDGE_TYPE[kind] })
      }
      setNodes(applyDagreLayout(rawNodes, rawEdges, layout))
      setEdges(rawEdges)
      setTimeout(() => fitView({ padding: 0.08, duration: 300, maxZoom: FIT_MAX_ZOOM, minZoom: FIT_MIN_ZOOM_FULL }), 80)
      return
    }

    // Focus mode: the reachable subgraph (cubes + processes + dims) around the
    // selected node or module, through the chosen edge kinds, laid out together.
    if (focused && reachableSet) {
      const inSet = new Set(reachableSet)
      const isP = id => id.startsWith('proc:') && processData[id.slice(5)]
      const isD = id => id.startsWith('dim:') && dimData[id.slice(4)]
      const rawNodes = [...reachableSet].map(id => {
        if (isP(id)) return { id, type: 'process', data: { label: id.slice(5) }, position: { x: 0, y: 0 } }
        if (isD(id)) return { id, type: 'dim', data: { label: id.slice(4) }, position: { x: 0, y: 0 } }
        const d = cubeData[id]
        return { id, type: 'cube', data: { label: id, hasRules: d?.hasRules, ruleLoc: d?.ruleLoc ?? 0, dimCount: d?.dims.length ?? 0 }, position: { x: 0, y: 0 } }
      })
      // Context dimensions: the dims the visible cubes use, shown even when no TI
      // changes them. Informative only — never used to pull in more cubes.
      if (traceKinds.dimuse) {
        for (const id of reachableSet) {
          if (isP(id) || isD(id)) continue
          for (const dimName of (cubeData[id]?.dims ?? []).filter(d => !dimFilter || d === dimFilter)) {
            const dimId = `dim:${dimName}`
            if (!inSet.has(dimId)) {
              inSet.add(dimId)
              rawNodes.push({ id: dimId, type: 'dim', data: { label: dimName }, position: { x: 0, y: 0 } })
            }
          }
        }
      }
      const rawEdges = []
      const addEdge = (type, source, target) => {
        if (inSet.has(source) && inSet.has(target)) rawEdges.push({ id: `${type}:${source}:${target}`, source, target, type })
      }
      for (const id of inSet) {
        if (isP(id)) {
          const name = id.slice(5), p = processData[name]
          p.reads.forEach(c => addEdge('process_read', c, id))
          p.writes.forEach(c => addEdge('process_write', id, c))
          ;(p.dimWrites ?? []).forEach(d => addEdge('process_dimwrite', id, `dim:${d}`))
          p.calls.forEach(c => addEdge('process_call', id, `proc:${c}`))
        } else if (isD(id)) {
          const name = id.slice(4)
          ;(dimData[name]?.cubes ?? []).forEach(c => addEdge('dim_used_by', id, c))
        } else {
          const d = cubeData[id]
          if (traceKinds.rule) (d?.ruleCalcRefs ?? []).forEach(t => addEdge('rule_calc', id, t))
          if (traceKinds.feeder) (d?.ruleFeederRefs ?? []).forEach(t => addEdge('rule_feeder', id, t))
        }
      }
      const L = applyLensActions(rawNodes, rawEdges, lensUsage, procRoots, showLensActions || !!runScope, focusSeeds ?? [])
      const f = runScope ? L : foldProcesses(L.nodes, L.edges, procRoots, expandedFolds, toggleFold)
      setNodes(applyGrouping(applyDagreLayout(f.nodes, f.edges, layout), showClusters, groupRegex))
      setEdges(f.edges)
      setFitTick(t => t + 1)
      return
    }

    const visibleSet = dimFilter
      ? new Set(Object.keys(cubeData).filter(n => cubeData[n].dims.includes(dimFilter)))
      : new Set(Object.keys(cubeData))

    const rawNodes = [...visibleSet].map(name => ({
      id: name, type: 'cube',
      data: {
        label: name,
        hasRules:  cubeData[name].hasRules,
        ruleLoc:   cubeData[name].ruleLoc ?? 0,
        dimCount:  cubeData[name].dims.length,
      },
      position: { x: 0, y: 0 },
    }))

    const rawEdges = []
    for (const src of visibleSet) {
      const d = cubeData[src]
      if (showCalc) {
        d.ruleCalcRefs.filter(t => visibleSet.has(t)).forEach(tgt =>
          rawEdges.push({ id: `calc:${src}:${tgt}`, source: src, target: tgt, type: 'rule_calc' })
        )
      }
      if (showFeeders) {
        d.ruleFeederRefs.filter(t => visibleSet.has(t)).forEach(tgt =>
          rawEdges.push({ id: `feeder:${src}:${tgt}`, source: src, target: tgt, type: 'rule_feeder' })
        )
      }
    }

    // All TI: every process that reads/writes a visible cube, plus the processes that call them
    // (transitively), laid out with the cubes so the data flow reads left to right:
    // cube --read--> process --write--> cube, and caller --call--> callee.
    // With Dims on, a changed dimension counts as visible when a visible cube uses it, so dimension-only
    // processes (period builders, rollovers) join the flow.
    if (allTI && showProcesses) {
      const dimSet = new Set(showDims
        ? Object.entries(dimData).filter(([, d]) => d.cubes.some(c => visibleSet.has(c))).map(([name]) => name)
        : [])
      const procSet = new Set(Object.entries(processData)
        .filter(([, p]) => [...p.reads, ...p.writes].some(c => visibleSet.has(c)) || (p.dimWrites ?? []).some(d => dimSet.has(d)))
        .map(([name]) => name))
      // plus everything that calls them and everything they call, transitively
      for (let grew = true; grew;) {
        grew = false
        for (const [name, p] of Object.entries(processData)) {
          if (!procSet.has(name) && p.calls.some(c => procSet.has(c))) { procSet.add(name); grew = true }
          if (procSet.has(name)) for (const c of p.calls) {
            if (!procSet.has(c) && processData[c]) { procSet.add(c); grew = true }
          }
        }
      }
      for (const dim of dimSet) {
        rawNodes.push({ id: `dim:${dim}`, type: 'dim', data: { label: dim }, position: { x: 0, y: 0 } })
        // dimension -> cube links only in focus mode; on the full map a shared dimension would wire to every cube
        if (focused) dimData[dim].cubes.filter(c => visibleSet.has(c)).forEach(c =>
          rawEdges.push({ id: `dimuse:${dim}:${c}`, source: `dim:${dim}`, target: c, type: 'dim_used_by' }))
      }
      for (const name of procSet) {
        const p = processData[name]
        rawNodes.push({ id: `proc:${name}`, type: 'process', data: { label: name }, position: { x: 0, y: 0 } })
        p.reads.filter(c => visibleSet.has(c)).forEach(c =>
          rawEdges.push({ id: `read:${c}:${name}`, source: c, target: `proc:${name}`, type: 'process_read' }))
        p.writes.filter(c => visibleSet.has(c)).forEach(c =>
          rawEdges.push({ id: `write:${name}:${c}`, source: `proc:${name}`, target: c, type: 'process_write' }))
        p.calls.filter(c => procSet.has(c)).forEach(c =>
          rawEdges.push({ id: `call:${name}:${c}`, source: `proc:${name}`, target: `proc:${c}`, type: 'process_call' }))
        ;(p.dimWrites ?? []).filter(d => dimSet.has(d)).forEach(d =>
          rawEdges.push({ id: `dimwrite:${name}:${d}`, source: `proc:${name}`, target: `dim:${d}`, type: 'process_dimwrite' }))
      }
    }

    const L = applyLensActions(rawNodes, rawEdges, lensUsage, procRoots, showLensActions || !!runScope)
    const f = runScope ? L : foldProcesses(L.nodes, L.edges, procRoots, expandedFolds, toggleFold)
    setNodes(applyGrouping(applyDagreLayout(f.nodes, f.edges, layout), showClusters, groupRegex))
    setEdges(f.edges)
    setFitTick(t => t + 1)
  }, [cubeData, processData, dimData, allTI, showDims, showProcesses, showCalc, showFeeders, layout, dimFilter, showClusters, groupRegex, focused, selectedCube, traceDepth, traceKinds, reachableSet, runScope, fitView, procRoots, expandedFolds, toggleFold, lensUsage, showLensActions, focusSeeds])

  // ── Fit view ──────────────────────────────────────────────────────────────────
  // (not while Show is running — the camera holds still there; startShow does one fit itself)
  useEffect(() => {
    // Every rebuild of the map (model, Show switches, Steps away, a click, a filter) fits it to the
    // screen — however small that makes it. Fit to screen does the same on demand.
    if (fitTick && !showRunningRef.current) setTimeout(() => fitView({ padding: 0.08, duration: 400, maxZoom: FIT_MAX_ZOOM, minZoom: FIT_MIN_ZOOM_FULL }), 50)
  }, [fitTick, fitView])

  // ── Dimming ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCube) { setDimmedIds(new Set()); return }
    const connected = reachableSet ?? new Set([selectedCube])
    setDimmedIds(new Set(nodes.filter(n => n.type === 'cube').map(n => n.id).filter(id => !connected.has(id))))
  }, [reachableSet, selectedCube, nodes])

  // Persist view prefs for this server (independent of the graph-building effects
  // above; runs after them only because this hook is called last).
  useEffect(() => {
    try {
      localStorage.setItem(prefsKey, JSON.stringify({
        layout, showCalc, showFeeders, showClusters, showDims, showProcesses, allTI,
        showLegend, traceDepth, traceKinds, scope, sidebarOpen, showLensActions,
      }))
    } catch { /* prefs read failed — defaults apply */ }
  }, [prefsKey, layout, showCalc, showFeeders, showClusters, showDims, showProcesses, allTI, showLegend, traceDepth, traceKinds, scope, sidebarOpen, showLensActions])

  // ── Visual node/edge state ────────────────────────────────────────────────────
  const spotQ = dimSpotlight.trim().toLowerCase()
  const spotActive = !!spotQ && !selectedCube

  const playNode = (n) => {
    if (!runHighlight || n.type === 'group') return n
    const active = runHighlight.nodes.has(n.id)
    const trail  = !active && runHighlight.trailNodes.has(n.id)
    return {
      ...n,
      className: active ? 'cm-play-active-node' : undefined,
      style: { ...n.style, opacity: active ? 1 : trail ? 0.55 : 0.12, transition: 'opacity 0.3s' },
    }
  }

  const visibleNodes = useMemo(() => nodes.map(n => playNode((() => {
    if (n.type === 'group' || n.type === 'process' || n.type === 'dim') return { ...n, selected: false }
    const isSpotlit = spotActive && cubeData?.[n.id]?.dims?.some(d => d.toLowerCase().includes(spotQ))
    const isDimmed  = dimmedIds.has(n.id) || (spotActive && !isSpotlit)
    return {
      ...n,
      data:  { ...n.data, isSpotlit: spotActive && isSpotlit },
      style: { ...n.style, opacity: isDimmed ? 0.15 : 1, transition: 'opacity 0.2s' },
      selected: n.id === selectedCube,
    }
  })())), [nodes, dimmedIds, selectedCube, spotActive, spotQ, cubeData, runHighlight])

  const visibleEdges = useMemo(() => edges.map(e => {
    if (runHighlight) {
      const cls = runHighlight.edges.has(e.id) ? 'cm-play-active' : runHighlight.trailEdges.has(e.id) ? 'cm-play-trail' : 'cm-play-dim'
      return { ...e, className: cls, selected: false, zIndex: cls === 'cm-play-active' ? 10 : 0 }
    }
    if (PROCESS_EDGE_TYPES.has(e.type)) return { ...e, selected: false }
    return {
      ...e,
      style: {
        ...e.style,
        opacity: dimmedIds.size > 0 && dimmedIds.has(e.source) && dimmedIds.has(e.target) ? 0.05 : 1,
        transition: 'opacity 0.2s',
      },
      selected: false,
    }
  }), [edges, dimmedIds, runHighlight])

  return {
    nodes, edges, onNodesChange, onEdgesChange,
    visibleNodes, visibleEdges,
    layout, setLayout, showClusters, setShowClusters,
    expandedFolds,
  }
}
