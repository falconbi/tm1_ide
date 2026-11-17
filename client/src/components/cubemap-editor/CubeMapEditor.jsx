import { useMemo, useRef } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '../../store'
import { loadSettings } from '@/lib/formatters/settings.js'
import RunbookDialog from '@/components/RunbookDialog'
import { rulesTabId, processTabId, dimensionTabId, viewTabId } from '@/lib/tab-ids'
import { prefixOf } from '@/lib/cubemap-editor/filters.js'
import useCubemapModel from './hooks/useCubemapModel'
import useCubemapFilters from './hooks/useCubemapFilters'
import useCubemapSelection from './hooks/useCubemapSelection'
import useCubemapRun from './hooks/useCubemapRun'
import useCubemapLayout from './hooks/useCubemapLayout'
import DetailPanel from './DetailPanel'
import MapSidebar from './MapSidebar'
import MapCanvas from './MapCanvas'

// Processes run from Lens buttons (each Lens declares the processes it may run) get a Lens badge.
// With Lens actions switched off they leave the map, with any helper that only they run, so the
// back-end flow (loads, recalculation, snapshots) stands out. Seeds — what you clicked — always stay.


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
    cubeDataAll: model.cubeDataAll,
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
    loading, error, scanError, modelReady, fetchModel, lensUsage,
  } = model
  const { cubeData, processData, dimData, scope, setScope, dimFilter, traceKinds, setTraceKinds } = filters
  const {
    selectedCube, setSelectedCube, dimmedIds, setDimmedIds, reverseMap, selectedType,
    transitiveCount, navigateTo, handleFilterDim,
  } = selection
  const { runbookOpen, setRunbookOpen, fitToScreen, saveSession } = run

  const layoutState = useCubemapLayout({
    prefs, prefsKey, groupRegex,
    processDataAll: model.processDataAll,
    processCallers: model.processCallers,
    lensUsage: model.lensUsage,
    cubeData, processData, dimData,
    allTI: filters.allTI, showDims: filters.showDims, showProcesses: filters.showProcesses,
    showCalc: filters.showCalc, showFeeders: filters.showFeeders, dimFilter,
    traceKinds, traceDepth: filters.traceDepth, showLensActions: filters.showLensActions,
    dimSpotlight: filters.dimSpotlight,
    selectedCube, focused: selection.focused, reachableSet: selection.reachableSet,
    focusSeeds: selection.focusSeeds, dimmedIds, setDimmedIds,
    runScope: run.runScope, runHighlight: run.runHighlight, showRunningRef: run.showRunningRef,
    showLegend: selection.showLegend, scope, sidebarOpen: selection.sidebarOpen,
  })
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

      <MapSidebar
        filters={filters}
        selection={selection}
        run={run}
        layoutState={layoutState}
        groupRegex={groupRegex}
        loading={loading}
        error={error}
        scanError={scanError}
        fetchModel={fetchModel}
        fitToScreen={fitToScreen}
      />

      <MapCanvas
        canvasRef={canvasRef}
        dark={dark}
        modelReady={modelReady}
        filters={filters}
        selection={selection}
        run={run}
        layoutState={layoutState}
        open={{ openProcessCtx, openRulesCtx, openCubeCtx, openDimensionCtx }}
      />

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