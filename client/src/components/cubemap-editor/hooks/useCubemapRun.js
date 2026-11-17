import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useReactFlow } from '@xyflow/react'
import { buildRunSequence, buildPhaseSequence } from '@/lib/run-sequence'
import { getCubemapSession, saveCubemapSession } from '@/lib/cubemap-session'
import { NODE_W, NODE_H, FIT_MAX_ZOOM, FIT_MIN_ZOOM_FULL } from '@/lib/cubemap-editor/layout.js'
import { processSummariesQuery } from '@/hooks/useApi'

// Show playback (sequence, step, speed, follow), the per-tab session that
// restores the player and camera, and the deep links from the rules editor and
// the runbook.
export default function useCubemapRun({
  srv, tab, patchTab, canvasRef, modelReady,
  cubeData, processData, dimData, chores, processCallers,
  selection, filters,
}) {
  const {
    selectedCube, setSelectedCube, focused, setFocused, phaseFocus, setPhaseFocus,
    trail, setTrail, setDimmedIds, setModuleFocus,
    sidebarOpen, setSidebarOpen,
  } = selection
  const { scope, setScope, showDims, allTI, setAllTI, showProcesses, setShowProcesses, setDimFilter } = filters

  const queryClient = useQueryClient()
  const { fitView, setCenter, getNode, getViewport, setViewport } = useReactFlow()

  const [showBar,        setShowBar]        = useState(false)
  const [processInfo,    setProcessInfo]    = useState({})
  const [stepInfoOpen,   setStepInfoOpen]   = useState(false)
  const [runbookOpen,    setRunbookOpen]    = useState(false)
  const [runEntry,       setRunEntry]       = useState('')    // 'process:<name>' | 'chore:<name>'
  const [runSeq,         setRunSeq]         = useState(null)
  const [runScope,       setRunScope]       = useState(null)
  const [runIdx,         setRunIdx]         = useState(0)
  const [playing,        setPlaying]        = useState(false)
  const [speed,          setSpeed]          = useState(1)
  const [follow,         setFollow]         = useState(false)

  const playbackReturnRef = useRef(null)
  const showRunningRef = useRef(false)

  // Process summary/header/parameters for the Show details card.
  useEffect(() => {
    if (!showBar) return
    let cancelled = false
    queryClient.fetchQuery({ ...processSummariesQuery(srv), staleTime: 0 })
      .then(d => { if (!cancelled && Array.isArray(d.processes)) setProcessInfo(Object.fromEntries(d.processes.map(x => [x.process, x]))) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [showBar, srv, queryClient])

  // The runbook is a docked panel — refit the map when it opens/closes.
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.08, duration: 250, maxZoom: FIT_MAX_ZOOM, minZoom: FIT_MIN_ZOOM_FULL }), 120)
    return () => clearTimeout(t)
  }, [runbookOpen, fitView])

  // Explicit Fit to screen — allowed to go below the automatic minimum.
  const fitToScreen = useCallback(() => {
    fitView({ padding: 0.08, duration: 350, maxZoom: FIT_MAX_ZOOM, minZoom: FIT_MIN_ZOOM_FULL })
  }, [fitView])

  // Restore this tab's player/phase/camera when coming back from a rules or process tab.
  const didRestoreRef = useRef(false)
  useEffect(() => {
    if (didRestoreRef.current || !modelReady || !cubeData || !processData) return
    const saved = getCubemapSession(tab?.id)   // read now: leaving the old copy may have saved after this one rendered
    didRestoreRef.current = true
    if (!saved) return
    if (saved.scope) setScope(saved.scope)
    if (saved.sidebarOpen != null) setSidebarOpen(saved.sidebarOpen)
    if (saved.runbookOpen != null) setRunbookOpen(!!saved.runbookOpen)
    if (saved.phaseFocus) setPhaseFocus(saved.phaseFocus)
    if (Array.isArray(saved.trail)) setTrail(saved.trail)
    if (saved.dimFilter) setDimFilter(saved.dimFilter)
    if (saved.selectedCube && (cubeData[saved.selectedCube] || processData[saved.selectedCube.slice(5)] || dimData[saved.selectedCube.slice(4)])) {
      setSelectedCube(saved.selectedCube)
      setFocused(!!saved.focused)
    }
    if (saved.runEntry && saved.showBar) {
      setRunEntry(saved.runEntry)
      setShowBar(true)
      setStepInfoOpen(!!saved.stepInfoOpen)
      const [kind, ...rest] = String(saved.runEntry).split(':')
      const seq = kind === 'phase'
        ? buildPhaseSequence(saved.phaseFocus, processData, cubeData, chores)
        : buildRunSequence({ kind, name: rest.join(':') }, processData, cubeData, chores)
      setRunSeq(seq)
      setRunIdx(Math.min(saved.runIdx ?? 0, Math.max(0, seq.length - 1)))
      setPlaying(false)
      const nodes = new Set(saved.runScope?.nodes ?? [...new Set(seq.flatMap(x => x.nodes ?? []))])
      const edges = new Set(saved.runScope?.edges ?? [...new Set(seq.flatMap(x => x.edges ?? []))])
      setRunScope({ nodes, edges })
    }
    if (saved.viewport) setTimeout(() => setViewport(saved.viewport, { duration: 0 }), 250)
  }, [modelReady, cubeData, processData, dimData, chores, setViewport, tab?.id, setDimFilter, setFocused, setPhaseFocus, setScope, setSelectedCube, setSidebarOpen, setTrail])

  // Keep the session current; the cleanup also catches a tab switch.
  const sessionRef = useRef(null)
  useEffect(() => {
    sessionRef.current = { runEntry, runIdx, runScope, phaseFocus, selectedCube, focused, scope, sidebarOpen, showBar, stepInfoOpen, runbookOpen, trail, dimFilter: filters.dimFilter }
  })
  const saveSession = useCallback(() => {
    const st = sessionRef.current
    if (!st) return
    saveCubemapSession(tab?.id, {
      ...st,
      runScope: st.runScope ? { nodes: [...st.runScope.nodes], edges: [...st.runScope.edges] } : null,
      viewport: getViewport(),
    })
  }, [tab?.id, getViewport])
  useEffect(() => () => saveSession(), [saveSession])

  // Deep link from the Rules editor's Data Sources strip: focus this cube.
  useEffect(() => {
    if (!tab?.focusCube || !tab?.focusAt || !cubeData) return
    if (!cubeData[tab.focusCube]) return
    setSelectedCube(tab.focusCube)
    setModuleFocus(null)
    setPhaseFocus(null)
    setFocused(true)
    setDimmedIds(new Set())
    // Arriving from the Rules editor starts a fresh trail at this cube — not
    // appended to the last visit's trail, so Back always returns here.
    setTrail([{ kind: 'node', id: tab.focusCube }])
    patchTab(tab.id, { focusCube: null, focusAt: null })
  }, [tab?.focusAt, tab?.focusCube, cubeData, patchTab, setDimmedIds, setFocused, setModuleFocus, setPhaseFocus, setSelectedCube, setTrail, tab?.id])

  // Deep link from the runbook: focus every process in a phase at once.
  useEffect(() => {
    if (!tab?.focusProcesses?.length || !tab?.focusAt || !cubeData) return
    setPhaseFocus({ label: tab.phaseLabel || 'Phase', processes: tab.focusProcesses, entries: tab.phaseEntries ?? [], kind: tab.phaseKind ?? 'phase' })
    setRunEntry('phase:current')
    setRunSeq(null)
    setPlaying(false)
    setSelectedCube(null)
    setModuleFocus(null)
    setFocused(true)
    setDimmedIds(new Set())
    setTrail([])   // a runbook phase is its own view; drills from it start a new trail
    patchTab(tab.id, { focusProcesses: null, phaseLabel: null, phaseEntries: null, phaseKind: null, focusAt: null })
  }, [tab?.focusAt, tab?.focusProcesses, tab?.phaseLabel, tab?.phaseEntries, tab?.phaseKind, cubeData, patchTab, setDimmedIds, setFocused, setModuleFocus, setPhaseFocus, setSelectedCube, setTrail, tab?.id])

  // ── Show playback ───────────────────────────────────────────────────────────
  // Entry points: chores, then processes nothing else calls, longest run first
  const runEntries = useMemo(() => {
    const procs = Object.keys(processData)
      .filter(n => !(processCallers[n]?.length) && processData[n].steps.length)
      .map(n => ({ key: `process:${n}`, label: n, len: buildRunSequence({ kind: 'process', name: n }, processData, cubeData ?? {}, chores).length }))
      .sort((a, b) => b.len - a.len || a.label.localeCompare(b.label))
    const phaseEntry = phaseFocus
      ? [{ key: 'phase:current', label: `▶ ${phaseFocus.kind === 'process' ? 'Process' : phaseFocus.kind === 'chore' ? 'Chore' : 'Phase'} — ${phaseFocus.label}`, len: buildPhaseSequence(phaseFocus, processData, cubeData ?? {}, chores).length }]
      : []
    return [...phaseEntry, ...chores.map(c => ({ key: `chore:${c.name}`, label: `⏱ ${c.name}${c.active ? '' : ' (inactive)'}` })), ...procs]
  }, [phaseFocus, processData, processCallers, cubeData, chores])

  const startShow = useCallback((key) => {
    if (!key || !cubeData) return
    const [kind, ...rest] = key.split(':')
    const raw = kind === 'phase'
      ? buildPhaseSequence(phaseFocus, processData, cubeData, chores)
      : buildRunSequence({ kind, name: rest.join(':') }, processData, cubeData, chores)
    const seq = raw.filter(it => showDims || !(it.nodes ?? []).some(n => n.startsWith('dim:')) || (it.edges ?? []).length === 0)
    playbackReturnRef.current = { phaseFocus, selectedCube, focused, allTI, showProcesses, sidebarOpen }
    const nodes = new Set(), edges = new Set()
    for (const it of seq) { (it.nodes ?? []).forEach(n => nodes.add(n)); (it.edges ?? []).forEach(e => edges.add(e)) }
    setRunScope({ nodes, edges })
    setFocused(false); setSelectedCube(null); setModuleFocus(null); setDimFilter(null)
    setSidebarOpen(false)   // give the movie the canvas
    if (kind !== 'phase') setPhaseFocus(null)
    setRunEntry(key); setRunSeq(seq); setRunIdx(0); setPlaying(true)
    patchTab(tab?.id, { focusProcesses: null, phaseLabel: null, phaseEntries: null, phaseKind: null, focusCube: null, focusAt: null })
    showRunningRef.current = true
  }, [cubeData, processData, chores, showDims, phaseFocus, allTI, focused, patchTab, selectedCube, setDimFilter, setFocused, setModuleFocus, setPhaseFocus, setSelectedCube, setSidebarOpen, showProcesses, sidebarOpen, tab?.id])

  useEffect(() => { if (!runSeq) showRunningRef.current = false }, [runSeq])

  const stopShow = useCallback(() => {
    setPlaying(false); setRunSeq(null); setRunEntry(null); setRunIdx(0); setStepInfoOpen(false); setShowBar(false); setRunScope(null)
    const prev = playbackReturnRef.current
    if (prev) {
      setPhaseFocus(prev.phaseFocus)
      setSelectedCube(prev.selectedCube)
      setFocused(prev.focused)
      setAllTI(prev.allTI)
      setShowProcesses(prev.showProcesses)
      setSidebarOpen(prev.sidebarOpen ?? true)
    }
    playbackReturnRef.current = null
    showRunningRef.current = false
  }, [setAllTI, setFocused, setPhaseFocus, setSelectedCube, setShowProcesses, setSidebarOpen])

  // The three tabs at the top of the sidebar: one mode at a time.
  const mapMode = showBar ? 'run' : runbookOpen ? 'runbook' : 'map'
  const setMapMode = useCallback(mode => {
    if (mode !== 'run' && showBar) stopShow()
    setRunbookOpen(mode === 'runbook')
    if (mode === 'run') setShowBar(true)
  }, [showBar, stopShow])

  useEffect(() => {
    if (!playing || !runSeq) return
    if (runIdx >= runSeq.length - 1) { setPlaying(false); return }
    const tm = setTimeout(() => setRunIdx(i => i + 1), 1600 / speed)
    return () => clearTimeout(tm)
  }, [playing, runIdx, runSeq, speed])

  const runStep = runSeq?.[runIdx] ?? null

  // Follow never zooms — it pans at the current zoom, and only when the step's nodes are off-screen
  useEffect(() => {
    if (!runStep || !follow || !canvasRef.current) return
    const pts = runStep.nodes.map(id => getNode(id)).filter(Boolean)
    if (!pts.length) return
    const { x: vx, y: vy, zoom } = getViewport()
    const { width, height } = canvasRef.current.getBoundingClientRect()
    const margin = 40
    const onScreen = pts.every(n => {
      const sx = n.position.x * zoom + vx, sy = n.position.y * zoom + vy
      return sx >= margin && sy >= margin && sx + NODE_W * zoom <= width - margin && sy + NODE_H * zoom <= height - margin
    })
    if (onScreen) return
    const cx = pts.reduce((s, n) => s + n.position.x + NODE_W / 2, 0) / pts.length
    const cy = pts.reduce((s, n) => s + n.position.y + NODE_H / 2, 0) / pts.length
    setCenter(cx, cy, { zoom, duration: 400 })
  }, [runStep, follow, getNode, getViewport, setCenter, canvasRef])

  // active = this step; trail = everything earlier steps touched
  const runHighlight = useMemo(() => {
    if (!showBar || !runSeq || !runStep) return null
    const trailNodes = new Set(), trailEdges = new Set()
    for (let i = 0; i < runIdx; i++) { runSeq[i].nodes.forEach(n => trailNodes.add(n)); runSeq[i].edges.forEach(e => trailEdges.add(e)) }
    return { nodes: new Set(runStep.nodes), edges: new Set(runStep.edges), trailNodes, trailEdges }
  }, [runSeq, runStep, runIdx, showBar])

  return {
    showBar, setShowBar,
    processInfo, stepInfoOpen, setStepInfoOpen,
    runbookOpen, setRunbookOpen,
    runEntry, setRunEntry,
    runSeq, setRunSeq,
    runScope, setRunScope,
    runIdx, setRunIdx,
    playing, setPlaying,
    speed, setSpeed,
    follow, setFollow,
    runStep, runEntries, runHighlight, mapMode, setMapMode,
    startShow, stopShow, fitToScreen, saveSession,
    showRunningRef,
  }
}
