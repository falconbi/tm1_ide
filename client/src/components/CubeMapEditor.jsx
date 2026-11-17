import { useMemo, useRef } from 'react'
import {
  ReactFlow, Background, Controls,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '../store'
import {
  Network, ChevronRight, ChevronDown, Search, X, RefreshCw,
  Filter, GitBranch, BookOpen, Milestone,
  Eye, Play, Clapperboard, PanelLeftClose, PanelLeftOpen, Maximize2, ArrowLeft, RotateCw,
} from 'lucide-react'
import { loadSettings } from '@/lib/formatters/settings.js'
import RunbookDialog from '@/components/RunbookDialog'
import { rulesTabId, processTabId, dimensionTabId, viewTabId } from '@/lib/tab-ids'
import { FIT_MIN_ZOOM_FULL } from '@/lib/cubemap-editor/layout.js'
import { prefixOf } from '@/lib/cubemap-editor/filters.js'
import useCubemapModel from './cubemap-editor/hooks/useCubemapModel'
import useCubemapFilters from './cubemap-editor/hooks/useCubemapFilters'
import useCubemapSelection from './cubemap-editor/hooks/useCubemapSelection'
import useCubemapRun from './cubemap-editor/hooks/useCubemapRun'
import useCubemapLayout from './cubemap-editor/hooks/useCubemapLayout'
import CubeNode from './cubemap-editor/graph/CubeNode'
import GroupNode from './cubemap-editor/graph/GroupNode'
import ProcessNode from './cubemap-editor/graph/ProcessNode'
import DimNode from './cubemap-editor/graph/DimNode'
import { edgeTypes } from './cubemap-editor/graph/edgeTypes'
import SvgMarkers from './cubemap-editor/graph/SvgMarkers'
import Legend from './cubemap-editor/Legend'
import DetailPanel from './cubemap-editor/DetailPanel'
import ShowBar from './cubemap-editor/ShowBar'
import Toggle from './cubemap-editor/Toggle'
import reachText from './cubemap-editor/reachText'

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
  // Configurable cube grouping key (regex) — reloads whenever settings are saved.
  const groupRegex = useMemo(() => {
    void themeVersion
    return loadSettings().cubeMap?.groupRegex ?? ''
  }, [themeVersion])

  // Per-server view prefs (layout, toggles, trace depth/kinds) persisted to localStorage.
  const prefsKey = `tm1-cubemap-prefs:${srv}`
  const prefs = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(prefsKey)) ?? {} } catch { return {} }
  }, [prefsKey])

  const canvasRef = useRef(null)

  const model = useCubemapModel({ srv })
  const filters = useCubemapFilters({
    processDataAll: model.processDataAll,
    dimDataAll: model.dimDataAll,
    prefs,
  })
  const selection = useCubemapSelection({
    cubeData: filters.cubeData,
    processData: filters.processData,
    dimData: filters.dimData,
    processCallers: model.processCallers,
    groupRegex, prefs, srv, openTab,
    dimFilter: filters.dimFilter, setDimFilter: filters.setDimFilter,
    traceKinds: filters.traceKinds, traceDepth: filters.traceDepth,
  })
  const run = useCubemapRun({
    srv, tab, patchTab, canvasRef,
    modelReady: model.modelReady,
    cubeData: filters.cubeData,
    processData: filters.processData,
    dimData: filters.dimData,
    chores: model.chores,
    processCallers: model.processCallers,
    selection, filters,
  })

  const {
    processCallers, chores,
    loading, error, modelReady, fetchModel, lensUsage,
  } = model
  const {
    search, setSearch, showFeeders, setShowFeeders, showCalc, setShowCalc,
    dimFilter, setDimFilter, traceDepth, setTraceDepth, traceKinds, setTraceKinds,
    dimSpotlight, setDimSpotlight, showProcesses, setShowProcesses, allTI, setAllTI,
    showDims, setShowDims, showLensActions, setShowLensActions, scope, setScope,
    prefixes, cubeData, processData, dimData, filteredCubes, spotQ, spotlitCount,
  } = filters
  const {
    selectedCube, setSelectedCube, moduleFocus, setModuleFocus, trail, setTrail,
    focused, setFocused, phaseFocus, setPhaseFocus, dimmedIds, setDimmedIds,
    showLegend, setShowLegend, sidebarOpen, setSidebarOpen, advancedOpen, setAdvancedOpen,
    reverseMap, selectedType, modules, focusSeeds, reachableSet, stepCounts,
    reachBreakdown, transitiveCount, reachableCapped, focusLabel,
    focusModule, onNodeClick, onNodeDoubleClick, onPaneClick,
    exitFocus, navigateTo, goToTrail, trailBack, handleFilterDim,
  } = selection
  const {
    showBar, processInfo, stepInfoOpen, setStepInfoOpen,
    runbookOpen, setRunbookOpen, runEntry, runSeq,
    runScope, runIdx, setRunIdx, playing, setPlaying,
    speed, setSpeed, follow, setFollow, runStep, runEntries, runHighlight,
    mapMode, setMapMode, startShow, stopShow, fitToScreen, saveSession, showRunningRef,
  } = run

  const layoutState = useCubemapLayout({
    prefs, prefsKey, groupRegex,
    processDataAll: model.processDataAll,
    processCallers: model.processCallers,
    lensUsage: model.lensUsage,
    cubeData, processData, dimData,
    allTI, showDims, showProcesses, showCalc, showFeeders, dimFilter,
    traceKinds, traceDepth, showLensActions, dimSpotlight,
    selectedCube, focused, reachableSet, focusSeeds, dimmedIds, setDimmedIds,
    runScope, runHighlight, showRunningRef,
    showLegend, scope, sidebarOpen,
  })
  const {
    nodes, edges, onNodesChange, onEdgesChange,
    visibleNodes, visibleEdges, layout, setLayout, showClusters, setShowClusters,
  } = layoutState

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