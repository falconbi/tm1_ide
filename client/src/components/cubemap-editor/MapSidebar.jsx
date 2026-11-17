import {
  Network, ChevronRight, ChevronDown, Search, X, RefreshCw,
  Filter, BookOpen, Milestone,
  Eye, Clapperboard, PanelLeftClose, PanelLeftOpen, Maximize2, RotateCw,
} from 'lucide-react'
import Toggle from './Toggle'

// Rotate cycles the dagre direction; the label is for the tooltip.
const LAYOUT_NEXT  = { LR: 'TB', TB: 'RL', RL: 'BT', BT: 'LR' }
const LAYOUT_LABEL = { LR: 'left to right', TB: 'top to bottom', RL: 'right to left', BT: 'bottom to top' }

export default function MapSidebar({ filters, selection, run, layoutState, groupRegex, loading, error, fetchModel, fitToScreen }) {
  const {
    search, setSearch, showFeeders, setShowFeeders, showCalc, setShowCalc,
    dimFilter, setDimFilter, traceKinds, setTraceKinds,
    dimSpotlight, setDimSpotlight, showProcesses, setShowProcesses, allTI, setAllTI,
    showDims, setShowDims, showLensActions, setShowLensActions, scope, setScope,
    prefixes, cubeData, filteredCubes, spotQ, spotlitCount,
  } = filters
  const {
    selectedCube, setSelectedCube, moduleFocus, setModuleFocus, trail, setTrail,
    focused, setFocused, phaseFocus, setPhaseFocus,
    showLegend, setShowLegend, sidebarOpen, setSidebarOpen, advancedOpen, setAdvancedOpen,
    modules, focusModule, exitFocus, navigateTo, trailBack,
  } = selection
  const { mapMode, setMapMode } = run
  const { nodes, edges, layout, setLayout, showClusters, setShowClusters } = layoutState

  // In a focused/phase/player map the Follow controls and the left Rules/Feeders/All TI
  // buttons must drive the same state, or one set of checkboxes appears locked.
  const focusMode = !!(focused || phaseFocus || run.runScope)
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

  if (!sidebarOpen) {
    return (
      <div className="cubemap-root" style={{ width: 34, borderRight: '1px solid var(--cm-border)', background: 'var(--cm-panel-bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8, flexShrink: 0 }}>
        <button onClick={() => setSidebarOpen(true)} title="Show the object list" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--cm-icon)', borderRadius: 4, display: 'flex' }}>
          <PanelLeftOpen size={14} />
        </button>
      </div>
    )
  }

  return (
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
  )
}
