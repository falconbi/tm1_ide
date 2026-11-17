import { request } from '@/lib/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls,
  useNodesState, useEdgesState, useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '../store'
import { useLensProcessUsage } from '@/hooks/useApi'
import {
  Network, ChevronRight, ChevronDown, Search, X, RefreshCw,
  Filter, GitBranch, BookOpen, Milestone,
  Eye, Play, Clapperboard, PanelLeftClose, PanelLeftOpen, Maximize2, ArrowLeft, RotateCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { loadSettings } from '@/lib/formatters/settings.js'
import { buildRunSequence, buildPhaseSequence } from '@/lib/run-sequence'
import { pushStep, backTo, previousStep } from '@/lib/cubemap-trail'
import { getCubemapSession, saveCubemapSession } from '@/lib/cubemap-session'
import RunbookDialog from '@/components/RunbookDialog'
import { rulesTabId, processTabId, dimensionTabId, viewTabId } from '@/lib/tab-ids'
import { NODE_W, NODE_H, applyDagreLayout } from '@/lib/cubemap-editor/layout.js'
import { MAX_FOCUS_NODES, buildReverseMap, getReachable } from '@/lib/cubemap-editor/graph.js'
import { prefixOf, applyLensActions, processRoots, foldProcesses, narrowToDim } from '@/lib/cubemap-editor/filters.js'
import { computePrefixGroups, applyGrouping } from '@/lib/cubemap-editor/grouping.js'
import CubeNode from './cubemap-editor/graph/CubeNode'
import GroupNode from './cubemap-editor/graph/GroupNode'
import ProcessNode from './cubemap-editor/graph/ProcessNode'
import DimNode from './cubemap-editor/graph/DimNode'
import { edgeTypes, PROCESS_EDGE_TYPES } from './cubemap-editor/graph/edgeTypes'
import SvgMarkers from './cubemap-editor/graph/SvgMarkers'
import Legend from './cubemap-editor/Legend'
import DetailPanel from './cubemap-editor/DetailPanel'
import ShowBar from './cubemap-editor/ShowBar'
import Toggle from './cubemap-editor/Toggle'
import reachText from './cubemap-editor/reachText'

// ── Layout ────────────────────────────────────────────────────────────────────
const FIT_MAX_ZOOM = 1.1
const FIT_MIN_ZOOM_FULL = 0.05
const NO_LENS_USAGE = Object.freeze({})
const TRACE_KIND_DEFAULTS = { rule: true, feeder: true, read: true, write: true, dimwrite: true, call: true, dimuse: true }

// Processes run from Lens buttons (each Lens declares the processes it may run) get a Lens badge.
// With Lens actions switched off they leave the map, with any helper that only they run, so the
// back-end flow (loads, recalculation, snapshots) stands out. Seeds — what you clicked — always stay.


const nodeTypes = { cube: CubeNode, group: GroupNode, process: ProcessNode, dim: DimNode }

// Rotate cycles the dagre direction; the label is for the tooltip.
const LAYOUT_NEXT  = { LR: 'TB', TB: 'RL', RL: 'BT', BT: 'LR' }
const LAYOUT_LABEL = { LR: 'left to right', TB: 'top to bottom', RL: 'right to left', BT: 'bottom to top' }

// ── Main inner component ──────────────────────────────────────────────────────

function CubeMapInner({ tab }) {
  const { server: storeServer, openTab, openTabToSide, patchTab } = useStore()
  const dark = useStore(s => s.dark)
  const themeVersion = useStore(s => s.themeVersion)
  const srv  = tab?.server ?? storeServer
  const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('tm1-token') ?? '') : ''

  // Configurable cube grouping key (regex) — reloads whenever settings are saved.
  const groupRegex = useMemo(() => {
    void themeVersion
    return loadSettings().cubeMap?.groupRegex ?? ''
  }, [themeVersion])

  const [cubeDataAll,    setCubeData]       = useState(null)
  const [processCallers, setProcessCallers] = useState({})
  const [processDataAll, setProcessData]    = useState({})
  const [dimDataAll,     setDimData]        = useState({})
  const [chores,         setChores]         = useState([])
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState(null)
  const [modelReady,     setModelReady]     = useState(false)

  // Prefix scope: WFP / LAB / SYS… — hides the other model instead of just clustering it.
  const prefixes = useMemo(() => [...new Set([
    ...Object.keys(cubeDataAll ?? {}), ...Object.keys(processDataAll ?? {}),
  ].map(prefixOf).filter(Boolean))].sort(), [cubeDataAll, processDataAll])
  // NO_LENS_USAGE, not `= {}`: a fresh {} on every render would re-run the map build forever.
  const { data: lensUsage = NO_LENS_USAGE } = useLensProcessUsage(srv)
  const procRoots = useMemo(() => processRoots(processDataAll ?? {}, processCallers ?? {}), [processDataAll, processCallers])
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Per-server view prefs (layout, toggles, trace depth/kinds) persisted to localStorage.
  const prefsKey = `tm1-cubemap-prefs:${srv}`
  const prefs = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(prefsKey)) ?? {} } catch { return {} }
  }, [prefsKey])

  const [selectedCube,   setSelectedCube]   = useState(null)
  const [moduleFocus,    setModuleFocus]    = useState(null)
  const [trail,          setTrail]          = useState([])   // focus path since the full map — see Trail below
  const [focused,        setFocused]        = useState(false)
  const [traceKinds,     setTraceKinds]     = useState({ ...TRACE_KIND_DEFAULTS, ...(prefs.traceKinds ?? {}) })
  const [search,         setSearch]         = useState('')
  const [showFeeders,    setShowFeeders]     = useState(prefs.showFeeders ?? true)
  const [showCalc,       setShowCalc]        = useState(prefs.showCalc ?? true)
  const [layout,         setLayout]         = useState(prefs.layout ?? 'LR')
  const [dimmedIds,      setDimmedIds]      = useState(new Set())
  const [dimFilter,      setDimFilter]      = useState(null)
  const [traceDepth,     setTraceDepth]     = useState(prefs.traceDepth ?? 1)
  const [showLegend,     setShowLegend]     = useState(prefs.showLegend ?? true)
  const [showClusters,   setShowClusters]   = useState(prefs.showClusters ?? false)
  const [dimSpotlight,   setDimSpotlight]   = useState('')
  const [showProcesses,  setShowProcesses]  = useState(prefs.showProcesses ?? true)
  const [allTI,          setAllTI]          = useState(prefs.allTI ?? false)
  const [showDims,       setShowDims]       = useState(prefs.showDims ?? true)
  const [showLensActions, setShowLensActions] = useState(prefs.showLensActions ?? true)
  const [scope,          setScope]          = useState(prefs.scope ?? '')
  const [sidebarOpen,    setSidebarOpen]    = useState(prefs.sidebarOpen ?? true)
  const [advancedOpen,   setAdvancedOpen]   = useState(false)
  const [expandedFolds,  setExpandedFolds]  = useState(() => new Set())   // process chains opened out on the map
  const [fitTick,        setFitTick]        = useState(0)   // bumped on every map rebuild; the fit effect watches it
  const toggleFold = useCallback(name => setExpandedFolds(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  }), [])
  const cubeData = useMemo(() => (!cubeDataAll ? cubeDataAll : !scope ? cubeDataAll : Object.fromEntries(Object.entries(cubeDataAll).filter(([n]) => prefixOf(n) === scope))), [cubeDataAll, scope])
  const processData = useMemo(() => (!scope ? processDataAll : Object.fromEntries(Object.entries(processDataAll).filter(([n]) => prefixOf(n) === scope))), [processDataAll, scope])
  const dimData = useMemo(() => (!scope ? dimDataAll : Object.fromEntries(Object.entries(dimDataAll).filter(([n]) => prefixOf(n) === scope))), [dimDataAll, scope])

  // Show playback
  const [showBar,        setShowBar]        = useState(false)
  const [processInfo,    setProcessInfo]    = useState({})
  const [stepInfoOpen,   setStepInfoOpen]   = useState(false)
  const [runbookOpen,    setRunbookOpen]    = useState(false)
  const [phaseFocus,     setPhaseFocus]     = useState(null)
  const [runEntry,       setRunEntry]       = useState('')    // 'process:<name>' | 'chore:<name>'
  const [runSeq,         setRunSeq]         = useState(null)
  const [runScope,       setRunScope]       = useState(null)
  const [runIdx,         setRunIdx]         = useState(0)
  const [playing,        setPlaying]        = useState(false)
  const [speed,          setSpeed]          = useState(1)
  const [follow,         setFollow]         = useState(false)
  const canvasRef = useRef(null)
  const playbackReturnRef = useRef(null)

  const { fitView, setCenter, getNode, getViewport, setViewport } = useReactFlow()

  // ── Fetch ─────────────────────────────────────────────────────────────────────
  // Request counter: a slow older server switch must not overwrite a newer map.
  const modelRequestRef = useRef(0)
  const fetchModel = useCallback(async () => {
    const requestId = ++modelRequestRef.current
    setLoading(true); setError(null); setModelReady(false)
    try {
      const r = await request(`/api/cubemap/model?server=${encodeURIComponent(srv)}`, {
        headers: { 'x-ide-token': token },
      })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      if (requestId !== modelRequestRef.current) return
      setCubeData(d.cubes)
      setProcessCallers(d.processCallers ?? {})
      setProcessData(d.processes ?? {})
      setDimData(d.dims ?? {})
      setChores(d.chores ?? [])
      setModelReady(true)
    } catch (e) {
      if (requestId !== modelRequestRef.current) return
      setError(e.message)
      toast.error(`CubeMap: ${e.message}`)
    } finally {
      if (requestId === modelRequestRef.current) setLoading(false)
    }
  }, [srv, token])

  useEffect(() => { fetchModel() }, [fetchModel])
  useEffect(() => () => { modelRequestRef.current++ }, [])

  // Process summary/header/parameters for the Show details card.
  useEffect(() => {
    if (!showBar) return
    let cancelled = false
    request(`/api/process/summaries?server=${encodeURIComponent(srv)}`, { headers: { 'x-ide-token': token } })
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d.processes)) setProcessInfo(Object.fromEntries(d.processes.map(x => [x.process, x]))) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [showBar, srv, token])

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
  }, [modelReady, cubeData, processData, dimData, chores, setViewport, tab?.id])

  // Keep the session current; the cleanup also catches a tab switch.
  const sessionRef = useRef(null)
  useEffect(() => {
    sessionRef.current = { runEntry, runIdx, runScope, phaseFocus, selectedCube, focused, scope, sidebarOpen, showBar, stepInfoOpen, runbookOpen, trail, dimFilter }
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

  // Persist view prefs for this server
  useEffect(() => {
    try {
      localStorage.setItem(prefsKey, JSON.stringify({
        layout, showCalc, showFeeders, showClusters, showDims, showProcesses, allTI,
        showLegend, traceDepth, traceKinds, scope, sidebarOpen, showLensActions,
      }))
    } catch { /* prefs read failed — defaults apply */ }
  }, [prefsKey, layout, showCalc, showFeeders, showClusters, showDims, showProcesses, allTI, showLegend, traceDepth, traceKinds, scope, sidebarOpen, showLensActions])

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
  }, [tab?.focusAt, tab?.focusCube, cubeData, patchTab])

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
  }, [tab?.focusAt, tab?.focusProcesses, tab?.phaseLabel, tab?.phaseEntries, tab?.phaseKind, cubeData, patchTab])

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
  const showRunningRef = useRef(false)
  useEffect(() => {
    // Every rebuild of the map (model, Show switches, Steps away, a click, a filter) fits it to the
    // screen — however small that makes it. Fit to screen does the same on demand.
    if (fitTick && !showRunningRef.current) setTimeout(() => fitView({ padding: 0.08, duration: 400, maxZoom: FIT_MAX_ZOOM, minZoom: FIT_MIN_ZOOM_FULL }), 50)
  }, [fitTick, fitView])

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
  }, [cubeData, processData, chores, showDims, fitView, phaseFocus])

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
  }, [])

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
  }, [runStep, follow, getNode, getViewport, setCenter])

  // active = this step; trail = everything earlier steps touched
  const runHighlight = useMemo(() => {
    if (!showBar || !runSeq || !runStep) return null
    const trailNodes = new Set(), trailEdges = new Set()
    for (let i = 0; i < runIdx; i++) { runSeq[i].nodes.forEach(n => trailNodes.add(n)); runSeq[i].edges.forEach(e => trailEdges.add(e)) }
    return { nodes: new Set(runStep.nodes), edges: new Set(runStep.edges), trailNodes, trailEdges }
  }, [runSeq, runStep, runIdx])

  // ── Dimming ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCube) { setDimmedIds(new Set()); return }
    const connected = reachableSet ?? new Set([selectedCube])
    setDimmedIds(new Set(nodes.filter(n => n.type === 'cube').map(n => n.id).filter(id => !connected.has(id))))
  }, [reachableSet, selectedCube, nodes])

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
  }, [pushTrail])

  const onNodeClick = useCallback((_, node) => {
    if (node.type === 'group') { focusModule(node.data.label); return }
    setSelectedCube(node.id)
    setModuleFocus(null)
    setPhaseFocus(null)
    setFocused(true)
    setDimFilter(null)
    pushTrail({ kind: 'node', id: node.id })
  }, [focusModule, pushTrail])

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
  }, [])

  const exitFocus = useCallback(() => {
    setModuleFocus(null); setSelectedCube(null); setPhaseFocus(null); setDimmedIds(new Set()); setFocused(false); setTrail([]); setDimFilter(null)
  }, [])

  // In a focused/phase/player map the Follow controls and the left Rules/Feeders/All TI
  // buttons must drive the same state, or one set of checkboxes appears locked.
  const focusMode = !!(focused || phaseFocus || runScope)
  const rulesVisible = focusMode ? !!traceKinds.rule : showCalc
  const feedersVisible = focusMode ? !!traceKinds.feeder : showFeeders
  const tiKinds  = ['read', 'write', 'call']
  const dimKinds = ['dimwrite', 'dimuse']
  const tiVisible   = focusMode ? tiKinds.some(k => traceKinds[k]) : allTI
  const dimsVisible = focusMode ? dimKinds.some(k => traceKinds[k]) : (allTI && showDims)
  // On the full map dimensions only appear through processes; on a cube they can be followed directly.
  const dimsAvailable = focusMode || allTI
  const toggleRules = () => {
    const next = !rulesVisible
    setShowCalc(next)
    setTraceKinds(k => ({ ...k, rule: next }))
  }
  const toggleFeeders = () => {
    const next = !feedersVisible
    setShowFeeders(next)
    setTraceKinds(k => ({ ...k, feeder: next }))
  }
  // Each Show switch sets the full-map flag and the trace kinds together, so it means the same
  // thing on the full map and on a cube.
  const toggleTI = () => {
    const next = !tiVisible
    setAllTI(next)
    setShowProcesses(true)
    setTraceKinds(k => ({ ...k, read: next, write: next, call: next }))
  }
  const toggleDims = () => {
    const next = !dimsVisible
    setShowDims(next)
    setTraceKinds(k => ({ ...k, dimwrite: next, dimuse: next }))
  }

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
  }, [pushTrail])

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
  }, [trail, exitFocus])

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

  // ── Open tab actions ──────────────────────────────────────────────────────────
  // Save where the map is before any tab opens: opening a tab or a split can rebuild the Cube Map
  // before the old copy has saved, and it would come back at the full map.
  const openHere = (t, o) => { saveSession(); openTab(t, o) }
  const openSide = (t, o) => { saveSession(); openTabToSide(t, o) }
  const openRules   = (cube)  => openHere({ id: rulesTabId(srv, cube),           type: 'rules',      label: cube,    server: srv, cube })
  const openView    = (cube)  => openHere({ id: viewTabId(srv, cube, 'Default'),     type: 'cubeview',   label: cube,    server: srv, cube, viewName: 'Default' })
  // Drill-ins from the player/runbook keep the map visible beside them.
  // Alt-click "opens here" instead (the old replace-the-pane behaviour).
  const openProcessCtx   = (name, here) => (here ? openHere : openSide)({ id: processTabId(srv, name),   type: 'process',    label: name, server: srv, name, content: null })
  const openDimensionCtx = (dim, here)  => (here ? openHere : openSide)({ id: dimensionTabId(srv, dim, dim),  type: 'dimension',  label: dim,  server: srv, dimension: dim })
  const openRulesCtx     = (cube, here) => (here ? openHere : openSide)({ id: rulesTabId(srv, cube),     type: 'rules',      label: cube, server: srv, cube })
  const openCubeCtx      = (cube, here) => (here ? openHere : openSide)({ id: viewTabId(srv, cube, 'Default'), type: 'cubeview', label: cube, server: srv, cube, viewName: 'Default' })

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

  // ── Sidebar list ──────────────────────────────────────────────────────────────
  const filteredCubes = useMemo(() => {
    if (!cubeData) return []
    const q = search.toLowerCase()
    return Object.keys(cubeData).filter(n => !q || n.toLowerCase().includes(q)).sort()
  }, [cubeData, search])

  const transitiveCount = reachableSet ? reachableSet.size - 1 : 0
  const reachableCapped = reachableSet ? reachableSet.size >= MAX_FOCUS_NODES : false
  const focusLabel = phaseFocus ? phaseFocus.label : moduleFocus ? `module ${moduleFocus}` : (selectedCube?.replace(/^(proc|dim):/, '') ?? '')

  const spotlitCount = useMemo(() => {
    if (!spotQ || !cubeData) return 0
    return Object.values(cubeData).filter(d => d.dims.some(dim => dim.toLowerCase().includes(spotQ))).length
  }, [spotQ, cubeData])

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}>
      <style>{`
        .cubemap-root {
          --cm-border:     ${dark ? '#2a2a3a' : '#e2e8f0'};
          --cm-node-bg:    ${dark ? '#1e1e2e' : '#ffffff'};
          --cm-sel-bg:     ${dark ? '#1e3a5f' : '#eff6ff'};
          --cm-panel-bg:   ${dark ? '#14141e' : '#f8fafc'};
          --cm-text:       ${dark ? '#e2e8f0' : '#1e293b'};
          --cm-text-muted: ${dark ? '#94a3b8' : '#64748b'};
          --cm-icon:       ${dark ? '#64748b' : '#94a3b8'};
          --cm-link:       ${dark ? '#7dd3fc' : '#2563eb'};
          --cm-incoming:   ${dark ? '#c4b5fd' : '#7c3aed'};
          --cm-hover:      ${dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'};
          --cm-toolbar:    ${dark ? '#1a1a2a' : '#f1f5f9'};
        }
        .cubemap-root .react-flow__background { background: ${dark ? '#0e0e18' : '#f0f4f8'}; }
        .cubemap-root .react-flow__controls button { background: var(--cm-node-bg) !important; border-color: var(--cm-border) !important; color: var(--cm-text) !important; }
        .cubemap-root .react-flow__minimap { background: var(--cm-panel-bg) !important; border: 1px solid var(--cm-border) !important; }
        .cm-sidebar-item:hover { background: var(--cm-hover) !important; }
        .cm-sidebar-item.active { background: var(--cm-sel-bg) !important; }
        @keyframes cm-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes cm-flow { to { stroke-dashoffset: -24 } }
        .react-flow__edge.cm-play-dim   { opacity: 0.06; transition: opacity 0.3s; }
        .react-flow__edge.cm-play-trail { opacity: 0.35; transition: opacity 0.3s; }
        .react-flow__edge.cm-play-active path.react-flow__edge-path {
          stroke-width: 3.5px !important; stroke-dasharray: 8 4 !important; opacity: 1 !important;
          animation: cm-flow 0.6s linear infinite;
        }
        .react-flow__node.cm-play-active-node > div {
          box-shadow: 0 0 0 2.5px #f59e0b, 0 0 20px rgba(245,158,11,0.55) !important;
        }
      `}</style>

      <SvgMarkers />

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      {sidebarOpen ? (
      <div className="cubemap-root" style={{
        width: 222, borderRight: '1px solid var(--cm-border)',
        background: 'var(--cm-panel-bg)', display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        {/* Toolbar */}
        <div style={{ padding: '8px 8px 6px', borderBottom: '1px solid var(--cm-border)', background: 'var(--cm-toolbar)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Network size={14} style={{ color: 'var(--cm-icon)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cm-text)', flex: 1 }}>Cube Map</span>
            <button onClick={() => setSidebarOpen(false)} title="Hide the object list" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--cm-icon)', borderRadius: 4, display: 'flex', alignItems: 'center' }}>
              <PanelLeftClose size={13} />
            </button>
            <button onClick={() => setShowLegend(v => !v)} title={showLegend ? 'Hide the legend (what the lines and colours mean)' : 'Show the legend (what the lines and colours mean)'} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: showLegend ? 'var(--cm-link)' : 'var(--cm-icon)', borderRadius: 4, display: 'flex', alignItems: 'center' }}>
              <BookOpen size={12} />
            </button>
            <button onClick={fitToScreen} title="Fit the whole map to the screen" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--cm-icon)', borderRadius: 4, display: 'flex', alignItems: 'center' }}>
              <Maximize2 size={13} />
            </button>
            <button onClick={fetchModel} disabled={loading} title="Reload the model from the server" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--cm-icon)', borderRadius: 4, display: 'flex', alignItems: 'center' }}>
              <RefreshCw size={13} style={{ animation: loading ? 'cm-spin 1s linear infinite' : 'none' }} />
            </button>
          </div>

          {/* Mode tabs — the map, a process run played step by step, or the runbook */}
          <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 6, background: 'var(--cm-node-bg)', border: '1px solid var(--cm-border)' }}>
            {[
              { key: 'map',     label: 'Map',        icon: <Network size={11} />,      title: 'The model: cubes, and what connects them' },
              { key: 'run',     label: 'Play a run', icon: <Clapperboard size={11} />, title: 'Play a process or chore step by step across the map' },
              { key: 'runbook', label: 'Runbook',    icon: <Milestone size={11} />,    title: 'Each chore, step by step — what runs, in what order, and what it changes (read-only)' },
            ].map(t => {
              const active = mapMode === t.key
              return (
                <button key={t.key} onClick={() => setMapMode(t.key)} title={t.title} style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  padding: '3px 2px', fontSize: 10, borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                  background: active ? 'var(--cm-sel-bg)' : 'none',
                  border: `1px solid ${active ? 'var(--cm-link)' : 'transparent'}`,
                  color: active ? 'var(--cm-link)' : 'var(--cm-text-muted)',
                  fontWeight: active ? 600 : 400,
                }}>{t.icon}{t.label}</button>
              )
            })}
          </div>

          {/* Model — show one model's objects only (e.g. WFP) */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--cm-text-muted)' }} title="Show only one model's cubes and processes, by name prefix">
            <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.75 }}>Model</span>
            <select value={scope} onChange={e => { setScope(e.target.value); setSelectedCube(null); setFocused(false); setPhaseFocus(null); setModuleFocus(null); setTrail([]) }}
              style={{ flex: 1, minWidth: 0, fontSize: 11, padding: '3px 4px', background: 'var(--cm-node-bg)', color: 'var(--cm-text)', border: `1px solid ${scope ? 'var(--cm-link)' : 'var(--cm-border)'}`, borderRadius: 4, outline: 'none', cursor: 'pointer' }}>
              <option value="">All models</option>
              {prefixes.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={11} style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--cm-icon)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cubes…" style={{
              width: '100%', boxSizing: 'border-box', padding: '4px 8px 4px 24px', fontSize: 11,
              background: 'var(--cm-node-bg)', border: '1px solid var(--cm-border)',
              borderRadius: 5, color: 'var(--cm-text)', outline: 'none',
            }} />
          </div>

          {/* Dim spotlight search */}
          <div style={{ position: 'relative' }}>
            <Eye size={11} style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: spotQ ? 'var(--cm-link)' : 'var(--cm-icon)', pointerEvents: 'none' }} />
            <input value={dimSpotlight} onChange={e => setDimSpotlight(e.target.value)} placeholder="Spotlight dimension…" style={{
              width: '100%', boxSizing: 'border-box', padding: '4px 24px 4px 24px', fontSize: 11,
              background: spotQ ? 'rgba(125,211,252,0.08)' : 'var(--cm-node-bg)',
              border: `1px solid ${spotQ ? 'rgba(125,211,252,0.35)' : 'var(--cm-border)'}`,
              borderRadius: 5, color: 'var(--cm-text)', outline: 'none', transition: 'all 0.15s',
            }} />
            {dimSpotlight && (
              <button onClick={() => setDimSpotlight('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--cm-icon)', display: 'flex', alignItems: 'center' }}>
                <X size={9} />
              </button>
            )}
          </div>
          {spotQ && spotlitCount > 0 && (
            <div style={{ fontSize: 10, color: 'var(--cm-link)', paddingLeft: 2, marginTop: -2 }}>
              {spotlitCount} cube{spotlitCount !== 1 ? 's' : ''} contain this dimension
            </div>
          )}
          {spotQ && spotlitCount === 0 && (
            <div style={{ fontSize: 10, color: 'var(--cm-text-muted)', paddingLeft: 2, marginTop: -2, opacity: 0.6 }}>
              No cubes contain this dimension
            </div>
          )}

          {/* Active dim filter chip */}
          {dimFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: 'rgba(125,211,252,0.1)', border: '1px solid rgba(125,211,252,0.25)', borderRadius: 20, fontSize: 10, color: 'var(--cm-link)' }}>
              <Filter size={9} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dimFilter}</span>
              <button onClick={() => (trail[trail.length - 1]?.kind === 'dim' ? trailBack() : setDimFilter(null))} title="Remove the dimension filter" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--cm-link)', display: 'flex', alignItems: 'center' }}>
                <X size={9} />
              </button>
            </div>
          )}

          {/* Show — what the map draws, and what a cube's trace follows. Always the same four. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--cm-text-muted)', opacity: 0.75 }}>Show</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <Toggle active={rulesVisible}   onClick={toggleRules}    color="#b45309" label="Rules"   title="Rule links: a rule in one cube reading another cube with DB()" />
              <Toggle active={feedersVisible} onClick={toggleFeeders}  color="#475569" label="Feeders" dashed title="Feeder links: a cube's feeders pointing at another cube" />
              <Toggle active={tiVisible}      onClick={toggleTI}       color="#0ea5e9" label="Processes" title="TI processes: which cubes they read and write, and which processes they call" />
              <Toggle active={dimsVisible}    onClick={toggleDims}     color="#8b5cf6" label="Dimensions"
                disabled={!dimsAvailable}
                title={dimsAvailable ? 'Dimensions: the ones processes change, and (on a cube) the ones it uses' : 'Turn on Processes first — on the full map, dimensions are shown through the processes that change them'} />
              <Toggle active={showLensActions && tiVisible} onClick={() => setShowLensActions(v => !v)} color="#6366f1" label="Lens actions"
                disabled={!tiVisible}
                title={tiVisible ? 'Processes run from Lens buttons (Assign Person, Approve Hire…). Off: only the back-end processes — loads, recalculation, snapshots' : 'Turn on Processes first'} />
            </div>
          </div>

          {/* Layout direction + the less-used grouping controls */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setLayout(l => LAYOUT_NEXT[l] ?? 'LR')} title={`Rotate the map — now ${LAYOUT_LABEL[layout] ?? layout}`} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              fontSize: 10, padding: '2px 0', borderRadius: 3, cursor: 'pointer',
              background: 'none', border: '1px solid var(--cm-border)', color: 'var(--cm-text-muted)',
            }}><RotateCw size={10} />Rotate</button>
            <button onClick={() => setAdvancedOpen(v => !v)} title="Grouping by name and module focus" style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
              fontSize: 10, padding: '2px 0', borderRadius: 3, cursor: 'pointer',
              background: advancedOpen || showClusters || moduleFocus ? 'var(--cm-sel-bg)' : 'none',
              border: `1px solid ${showClusters || moduleFocus ? 'var(--cm-link)' : 'var(--cm-border)'}`,
              color: showClusters || moduleFocus ? 'var(--cm-link)' : 'var(--cm-text-muted)',
            }}>{advancedOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}Advanced</button>
          </div>
          {advancedOpen && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <Toggle active={showClusters}  onClick={() => setShowClusters(v => !v)}  color="#6366f1" label="Groups" title={groupRegex ? `Group by regex: ${groupRegex}` : 'Group by prefix before first underscore — a module is a sub-group, not the Model filter'} />
            {modules.length === 0 && (
              <span style={{ fontSize: 9, color: 'var(--cm-text-muted)', opacity: 0.65, lineHeight: 1.4 }}>
                No modules — Model already filters the model. Use a Group regex for a finer sub-group.
              </span>
            )}
            {modules.length > 0 && (
              <select
                value={moduleFocus ?? ''}
                onChange={e => e.target.value ? focusModule(e.target.value) : exitFocus()}
                title="Focus a module — cubes sharing a group key"
                style={{ fontSize: 10, padding: '2px 4px', background: 'var(--cm-node-bg)', color: 'var(--cm-text)', border: `1px solid ${moduleFocus ? 'var(--cm-link)' : 'var(--cm-border)'}`, borderRadius: 4, cursor: 'pointer', maxWidth: 130 }}
              >
                <option value="">Module…</option>
                {modules.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            </div>
          )}
        </div>

        {/* Cube list */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 12, fontSize: 11, color: 'var(--cm-text-muted)' }}>Loading…</div>}
          {error   && <div style={{ padding: 12, fontSize: 11, color: '#f87171' }}>{error}</div>}
          {filteredCubes.map(name => {
            const d = cubeData?.[name]
            const inDimFilter = dimFilter && d?.dims?.includes(dimFilter)
            const inSpotlight = spotQ && d?.dims?.some(dim => dim.toLowerCase().includes(spotQ))
            return (
              <button key={name}
                className={`cm-sidebar-item${selectedCube === name ? ' active' : ''}`}
                onClick={() => navigateTo(name)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 10px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', opacity: spotQ && !inSpotlight ? 0.35 : 1, transition: 'opacity 0.2s' }}
              >
                <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: inSpotlight ? '#60a5fa' : d?.hasRules ? '#f59e0b' : 'var(--cm-icon)' }} />
                <span style={{ fontSize: 11, color: selectedCube === name ? 'var(--cm-link)' : 'var(--cm-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </span>
                {inDimFilter && <Filter size={8} style={{ color: 'var(--cm-link)', flexShrink: 0 }} />}
                {(d?.ruleCalcRefs?.length > 0 || d?.ruleFeederRefs?.length > 0) && (
                  <ChevronRight size={10} style={{ color: 'var(--cm-icon)', flexShrink: 0 }} />
                )}
              </button>
            )
          })}
        </div>

        {/* Footer stats */}
        {cubeData && (
          <div style={{ padding: '5px 10px', borderTop: '1px solid var(--cm-border)', fontSize: 10, color: 'var(--cm-text-muted)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span>{Object.keys(cubeData).length} cubes</span>
            {allTI && showProcesses && <><span>·</span><span>{nodes.filter(n => n.type === 'process').length} processes</span></>}
            <span>·</span>
            <span>{edges.length} links</span>
            {dimFilter && <span>· {nodes.length} visible</span>}
          </div>
        )}
      </div>
      ) : (
        <div className="cubemap-root" style={{ width: 34, borderRight: '1px solid var(--cm-border)', background: 'var(--cm-panel-bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8, flexShrink: 0 }}>
          <button onClick={() => setSidebarOpen(true)} title="Show the object list" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--cm-icon)', borderRadius: 4, display: 'flex' }}>
            <PanelLeftOpen size={14} />
          </button>
        </div>
      )}

      {/* ── Graph canvas ───────────────────────────────────────────────────── */}
      <div ref={canvasRef} className="cubemap-root" style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          nodeClickDistance={5}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={0.04}
          maxZoom={3}
          fitView
          minZoom={FIT_MIN_ZOOM_FULL}
          proOptions={{ hideAttribution: true }}
        >
          <Background color={dark ? '#1e1e30' : '#cbd5e1'} gap={24} size={1} />
          <Controls />
        </ReactFlow>
        {showLegend && <Legend onClose={() => setShowLegend(false)} />}
        {modelReady && !selectedCube && !focused && !phaseFocus && !moduleFocus && !showBar && (
          <div style={{
            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 4,
            maxWidth: 'calc(100% - 20px)', padding: '5px 12px', borderRadius: 6, fontSize: 11,
            background: 'var(--cm-panel-bg)', border: '1px solid var(--cm-border)', color: 'var(--cm-text-muted)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)', pointerEvents: 'none', textAlign: 'center',
          }}>
            {scope ? 'Click a cube to see what feeds it and what it feeds.' : 'Pick a model, then click a cube to see what feeds it and what it feeds.'}
          </div>
        )}
        {showBar && (
          <ShowBar
            entries={runEntries} entry={runEntry} onEntry={startShow}
            seq={runSeq} idx={runIdx} step={runStep} playing={playing}
            onPlay={() => { if (runSeq && runIdx >= runSeq.length - 1) setRunIdx(0); if (runSeq) setPlaying(p => !p); else startShow(runEntry || runEntries[0]?.key) }}
            onPrev={() => { setPlaying(false); setRunIdx(i => Math.max(0, i - 1)) }}
            onNext={() => { setPlaying(false); setRunIdx(i => Math.min((runSeq?.length ?? 1) - 1, i + 1)) }}
            onRestart={() => { setRunIdx(0); setPlaying(false) }}
            speed={speed} onSpeed={setSpeed} follow={follow} onFollow={setFollow}
            onClose={stopShow}
            processInfo={processInfo} cubeData={cubeData} dimData={dimData}
            onOpenProcess={openProcessCtx} onOpenRules={openRulesCtx} onOpenCube={openCubeCtx} onOpenDimension={openDimensionCtx}
            onPause={() => setPlaying(false)}
            showInfo={stepInfoOpen} onToggleInfo={() => setStepInfoOpen(v => !v)} onBeforeNavigate={saveSession}
          />
        )}
        {focused && (selectedCube || moduleFocus || phaseFocus) && (
          <div style={{
            position: 'absolute', top: 10, left: 10, zIndex: 5, maxWidth: 'calc(100% - 20px)',
            background: 'var(--cm-panel-bg)', border: '1px solid var(--cm-border)',
            borderRadius: 7, padding: '6px 10px', fontSize: 11, color: 'var(--cm-text)',
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}>
            {phaseFocus ? (
              <>
                <GitBranch size={12} style={{ color: 'var(--cm-link)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {phaseFocus.kind === 'process' ? 'Process' : phaseFocus.kind === 'chore' ? 'Chore' : 'Phase'} <b style={{ color: 'var(--cm-link)' }}>{focusLabel}</b>
                  <span style={{ color: 'var(--cm-text-muted)' }}> · {phaseFocus.processes.length} process{phaseFocus.processes.length !== 1 ? 'es' : ''}</span>
                  {transitiveCount > 0 && <span style={{ color: 'var(--cm-text-muted)' }}> {reachText(reachBreakdown, reachableCapped)}</span>}
                </span>
                <button onClick={() => { setMapMode('run'); startShow('phase:current') }}
                  title="Play this chore step by step"
                  style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid #f59e0b', background: 'none', color: '#f59e0b', cursor: 'pointer', flexShrink: 0 }}>
                  <Play size={10} /> Play
                </button>
              </>
            ) : (
              <>
                <button onClick={trailBack} title="Back one step (Backspace / Alt+←)" style={{
                  background: 'none', border: '1px solid var(--cm-border)', borderRadius: 4, cursor: 'pointer',
                  padding: '1px 6px', color: 'var(--cm-text)', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, flexShrink: 0,
                }}>
                  <ArrowLeft size={11} /> Back
                </button>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  <button onClick={exitFocus} title="Show the full map (Esc)" style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--cm-link)', fontSize: 11, flexShrink: 0,
                  }}>
                    Full map{scope ? ` (${scope} only)` : ''}
                  </button>
                  {trail.map((e, i) => {
                    const last = i === trail.length - 1
                    const label = e.kind === 'module' ? `module ${e.id}` : e.kind === 'dim' ? `with ${e.id}` : e.id.replace(/^(proc|dim):/, '')
                    return (
                      <span key={`${e.kind}:${e.id}`} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                        <ChevronRight size={10} style={{ color: 'var(--cm-text-muted)', flexShrink: 0 }} />
                        {last
                          ? <b style={{ color: 'var(--cm-text)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }} title={label}>{label}</b>
                          : <button onClick={() => goToTrail(i)} title={`Back to ${label}`} style={{
                              background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--cm-link)', fontSize: 11,
                              overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160,
                            }}>{label}</button>}
                      </span>
                    )
                  })}
                  {transitiveCount > 0 && <span style={{ color: 'var(--cm-text-muted)', flexShrink: 0 }}>{reachText(reachBreakdown, reachableCapped)}</span>}
                </span>
              </>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, paddingLeft: 6, borderLeft: '1px solid var(--cm-border)' }}
              title="How far the map reaches from here: 1 = direct links only, 2 = their links too, and so on (through the kinds of link switched on under Show)">
                <span style={{ fontSize: 10, color: 'var(--cm-text-muted)', marginRight: 2, whiteSpace: 'nowrap' }}>Steps away</span>
                {[1, 2, 3, 4].map(d => (
                  <button key={d} onClick={() => setTraceDepth(d)}
                    title={stepCounts ? `${d} step${d > 1 ? 's' : ''} away: ${stepCounts[d - 1]} connected` : undefined}
                    style={{
                    padding: '1px 5px', fontSize: 10, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                    background: d === traceDepth ? 'var(--cm-sel-bg)' : 'none',
                    border: `1px solid ${d === traceDepth ? 'var(--cm-link)' : 'var(--cm-border)'}`,
                    color: d === traceDepth ? 'var(--cm-link)' : 'var(--cm-text-muted)',
                  }}>{d}{stepCounts && <span style={{ opacity: 0.7 }}> ({stepCounts[d - 1]})</span>}</button>
                ))}
            </div>
            <button onClick={exitFocus} title="Exit focus — show full map" style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: 'var(--cm-icon)', borderRadius: 4, display: 'flex', alignItems: 'center',
            }}>
              <X size={12} />
            </button>
          </div>
        )}
      </div>
        <RunbookDialog
          open={runbookOpen}
          onClose={() => setRunbookOpen(false)}
          server={srv}
          processData={processData}
          cubeData={cubeData}
          chores={chores}
          onOpenProcess={openProcessCtx}
          onOpenPhaseMap={(label, processes, entries, kind = 'phase') => {
            const pfx = processes[0] ? prefixOf(processes[0]) : ''
            if (pfx && pfx !== scope) setScope(pfx)
            openTab({ id: `cubemap:${srv}`, type: 'cubemap', label: 'Cube Map', server: srv, focusProcesses: processes, phaseLabel: label, phaseEntries: entries, phaseKind: kind, focusAt: Date.now() })
          }}
        />

      {/* ── Detail panel ───────────────────────────────────────────────────── */}
      {selectedCube && selectedType === 'cube' && cubeData?.[selectedCube] && (
        <div className="cubemap-root">
          <DetailPanel
            cube={selectedCube}
            cubeData={cubeData[selectedCube]}
            reverseMap={reverseMap}
            onNavigate={navigateTo}
            onClose={() => { setSelectedCube(null); setDimmedIds(new Set()) }}
            onOpenRules={() => openRules(selectedCube)}
            onOpenView={() => openView(selectedCube)}
            onOpenRulesSplit={() => openRulesCtx(selectedCube)}
            onOpenViewSplit={() => openCubeCtx(selectedCube)}
            processCallers={processCallers}
            onFilterDim={handleFilterDim}
            dimFilter={dimFilter}
            traceKinds={traceKinds}
            lensUsage={lensUsage}
            setTraceKinds={setTraceKinds}
            transitiveCount={transitiveCount}
          />
        </div>
      )}
    </div>
  )
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function CubeMapEditor({ tab }) {
  return (
    <ReactFlowProvider>
      <CubeMapInner tab={tab} />
    </ReactFlowProvider>
  )
}