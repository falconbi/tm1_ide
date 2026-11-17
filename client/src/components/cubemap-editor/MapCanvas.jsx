import { ReactFlow, Background, Controls } from '@xyflow/react'
import { GitBranch, Play, ArrowLeft, ChevronRight, X } from 'lucide-react'
import { FIT_MIN_ZOOM_FULL } from '@/lib/cubemap-editor/layout.js'
import CubeNode from './graph/CubeNode'
import GroupNode from './graph/GroupNode'
import ProcessNode from './graph/ProcessNode'
import DimNode from './graph/DimNode'
import { edgeTypes } from './graph/edgeTypes'
import SvgMarkers from './graph/SvgMarkers'
import Legend from './Legend'
import ShowBar from './ShowBar'
import reachText from './reachText'

const nodeTypes = { cube: CubeNode, group: GroupNode, process: ProcessNode, dim: DimNode }

export default function MapCanvas({ canvasRef, dark, modelReady, filters, selection, run, layoutState, open }) {
  const { cubeData, dimData, scope, traceDepth, setTraceDepth } = filters
  const {
    selectedCube, focused, phaseFocus, moduleFocus, trail, trailBack, exitFocus, goToTrail,
    onNodeClick, onNodeDoubleClick, onPaneClick, showLegend, setShowLegend,
    stepCounts, transitiveCount, reachBreakdown, reachableCapped, focusLabel,
  } = selection
  const {
    showBar, runEntries, runEntry, startShow, runSeq, runIdx, runStep, playing,
    setRunIdx, setPlaying, speed, setSpeed, follow, setFollow, stopShow,
    processInfo, stepInfoOpen, setStepInfoOpen, saveSession, setMapMode,
  } = run
  const { visibleNodes, visibleEdges, onNodesChange, onEdgesChange } = layoutState
  const { openProcessCtx, openRulesCtx, openCubeCtx, openDimensionCtx } = open

  return (
    <div ref={canvasRef} className="cubemap-root" style={{ flex: 1, position: 'relative' }}>
      <SvgMarkers />
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
  )
}
