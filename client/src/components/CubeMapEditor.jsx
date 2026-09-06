import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow,
  ReactFlowProvider, Handle, Position,
  getBezierPath, BaseEdge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import { useStore } from '../store'
import {
  Network, ChevronRight, Search, X, RefreshCw, ArrowRight, Layers,
  Code2, Workflow, Filter, GitBranch, Zap, BookOpen,
  Box, Eye,
} from 'lucide-react'
import { toast } from 'sonner'

// ── Layout ────────────────────────────────────────────────────────────────────

const NODE_W = 192
const NODE_H = 52

function applyDagreLayout(nodes, edges, direction = 'LR') {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 64, ranksep: 112, marginx: 40, marginy: 40 })
  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map(n => {
    const { x, y } = g.node(n.id)
    return { ...n, position: { x: x - NODE_W / 2, y: y - NODE_H / 2 } }
  })
}

// ── Graph algorithms ──────────────────────────────────────────────────────────


function buildReverseMap(cubeData) {
  const rev = {}
  for (const [src, d] of Object.entries(cubeData)) {
    for (const tgt of [...(d.ruleCalcRefs ?? []), ...(d.ruleFeederRefs ?? [])]) {
      if (!rev[tgt]) rev[tgt] = []
      if (!rev[tgt].includes(src)) rev[tgt].push(src)
    }
  }
  return rev
}

function getTransitiveSet(name, depth, cubeData, reverseMap) {
  const result = new Set([name])
  let frontier = [name]
  for (let d = 0; d < depth; d++) {
    const next = []
    for (const n of frontier) {
      for (const ref of [...(cubeData[n]?.ruleCalcRefs ?? []), ...(cubeData[n]?.ruleFeederRefs ?? [])]) {
        if (!result.has(ref) && cubeData[ref]) { result.add(ref); next.push(ref) }
      }
      for (const ref of (reverseMap[n] ?? [])) {
        if (!result.has(ref) && cubeData[ref]) { result.add(ref); next.push(ref) }
      }
    }
    frontier = next
    if (!next.length) break
  }
  return result
}

// ── Prefix clustering ─────────────────────────────────────────────────────────

const GROUP_COLORS = [
  { border: '#3b82f6', bg: 'rgba(59,130,246,0.05)'  },
  { border: '#10b981', bg: 'rgba(16,185,129,0.05)'  },
  { border: '#8b5cf6', bg: 'rgba(139,92,246,0.05)'  },
  { border: '#f59e0b', bg: 'rgba(245,158,11,0.05)'  },
  { border: '#06b6d4', bg: 'rgba(6,182,212,0.05)'   },
  { border: '#ec4899', bg: 'rgba(236,72,153,0.05)'  },
  { border: '#84cc16', bg: 'rgba(132,204,22,0.05)'  },
  { border: '#f97316', bg: 'rgba(249,115,22,0.05)'  },
]

const CLUSTER_PAD = 22

function computePrefixGroups(nodeIds) {
  const groups = {}
  for (const id of nodeIds) {
    const idx = id.indexOf('_')
    if (idx > 1) {
      const prefix = id.slice(0, idx)
      if (!groups[prefix]) groups[prefix] = []
      groups[prefix].push(id)
    }
  }
  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length >= 2))
}

function applyGrouping(laidOut, showClusters) {
  if (!showClusters) return laidOut
  const groups = computePrefixGroups(laidOut.map(n => n.id))
  if (!Object.keys(groups).length) return laidOut

  const memberIds  = new Set(Object.values(groups).flat())
  const parentNodes = []
  const childNodes  = []

  Object.entries(groups).forEach(([prefix, ids], i) => {
    const color   = GROUP_COLORS[i % GROUP_COLORS.length]
    const members = laidOut.filter(n => ids.includes(n.id))

    const minX = Math.min(...members.map(n => n.position.x)) - CLUSTER_PAD
    const minY = Math.min(...members.map(n => n.position.y)) - CLUSTER_PAD - 14
    const maxX = Math.max(...members.map(n => n.position.x + NODE_W)) + CLUSTER_PAD
    const maxY = Math.max(...members.map(n => n.position.y + NODE_H)) + CLUSTER_PAD

    parentNodes.push({
      id: `__group__${prefix}`, type: 'group',
      position: { x: minX, y: minY },
      style: { width: maxX - minX, height: maxY - minY },
      data: { label: prefix, count: ids.length, color: color.border, bg: color.bg },
      zIndex: -1, selectable: false, draggable: false,
    })

    members.forEach(n => childNodes.push({
      ...n,
      parentId: `__group__${prefix}`,
      extent:   'parent',
      position: { x: n.position.x - minX, y: n.position.y - minY },
    }))
  })

  return [...parentNodes, ...childNodes, ...laidOut.filter(n => !memberIds.has(n.id))]
}

// ── Custom node: Cube ─────────────────────────────────────────────────────────

function CubeNode({ data, selected }) {
  const { label, hasRules, ruleLoc = 0, dimCount = 0, isSpotlit } = data
  const barH = hasRules ? Math.max(4, Math.min(16, 4 + Math.round(Math.log1p(ruleLoc) * 2.5))) : 0

  return (
    <div style={{
      width: NODE_W, height: NODE_H, borderRadius: 8, position: 'relative',
      border: isSpotlit ? '2px solid #60a5fa'
            : selected  ? '2px solid #60a5fa'
            : '1.5px solid var(--cm-border)',
      background: selected ? 'var(--cm-sel-bg)'
                : 'var(--cm-node-bg)',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 12px', cursor: 'pointer', overflow: 'hidden',
      boxShadow: isSpotlit ? '0 0 0 3px rgba(96,165,250,0.28), 0 2px 10px rgba(96,165,250,0.15)'
               : selected  ? '0 0 0 3px rgba(96,165,250,0.18)'
               : '0 1px 4px rgba(0,0,0,0.2)',
      transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
    }}>
      {barH > 0 && (
        <div style={{
          position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
          width: 3, height: `${barH}px`,
          background: '#f59e0b',
          borderRadius: '4px 0 0 4px',
        }} />
      )}
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Layers size={13} style={{ color: hasRules ? '#f59e0b' : 'var(--cm-icon)', flexShrink: 0 }} />
      <span style={{
        fontSize: 12, fontWeight: 500, color: 'var(--cm-text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>{label}</span>
      {dimCount > 0 && (
        <span style={{ fontSize: 9, color: 'var(--cm-text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
          {dimCount}d
        </span>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
}

function GroupNode({ data }) {
  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 10,
      border: `1.5px solid ${data.color}55`,
      background: data.bg,
      pointerEvents: 'none',
    }}>
      <div style={{
        position: 'absolute', top: 6, left: 10,
        fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: data.color, display: 'flex', alignItems: 'center', gap: 5,
      }}>
        {data.label}
        <span style={{ fontWeight: 400, opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>{data.count}</span>
      </div>
    </div>
  )
}

const nodeTypes = { cube: CubeNode, group: GroupNode }

// ── Custom edges ──────────────────────────────────────────────────────────────

function RuleCalcEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: selected ? '#fbbf24' : '#b45309', strokeWidth: selected ? 2.5 : 1.5, opacity: 0.85 }} markerEnd={`url(#arrowCalc${selected ? 'Sel' : ''})`} />
}

function RuleFeederEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#475569', strokeWidth: 1.5, strokeDasharray: '5 4', opacity: 0.6 }} markerEnd="url(#arrowFeeder)" />
}

const edgeTypes = { rule_calc: RuleCalcEdge, rule_feeder: RuleFeederEdge }

function SvgMarkers() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        <marker id="arrowCalc"    markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#b45309" /></marker>
        <marker id="arrowCalcSel" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#fbbf24" /></marker>
        <marker id="arrowFeeder"  markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#475569" /></marker>
      </defs>
    </svg>
  )
}


// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div style={{
      position: 'absolute', bottom: 44, right: 10, zIndex: 5,
      background: 'var(--cm-panel-bg)', border: '1px solid var(--cm-border)',
      borderRadius: 7, padding: '8px 12px', fontSize: 10, color: 'var(--cm-text-muted)',
      display: 'flex', flexDirection: 'column', gap: 6,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }}>
      <span style={{ fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Legend</span>
      {[
        { el: <div style={{ width: 20, height: 1.5, background: '#b45309' }} />,                      label: 'Rule DB() reference'     },
        { el: <div style={{ width: 20, borderTop: '1.5px dashed #475569' }} />,                       label: 'Feeder reference'        },
        { el: <div style={{ width: 3, height: 10, background: '#f59e0b', borderRadius: 2 }} />,       label: 'Has rules (bar = LOC)'   },
        { el: <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#60a5fa' }} />,     label: 'Dim spotlight match'   },
      ].map(({ el, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{el}</div>
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Detail panel helpers ──────────────────────────────────────────────────────

function Section({ title, count, icon, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ padding: '0 12px 4px', display: 'flex', alignItems: 'center', gap: 4 }}>
        {icon}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cm-text-muted)', opacity: 0.65 }}>
          {title}
        </span>
        {count !== undefined && (
          <span style={{ fontSize: 10, color: 'var(--cm-text-muted)', opacity: 0.4, marginLeft: 1 }}>{count}</span>
        )}
      </div>
      {children}
    </div>
  )
}

function FlowItem({ label, onClick, color, icon }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 5, width: '100%',
      padding: '3px 12px', background: 'none', border: 'none', cursor: 'pointer',
      textAlign: 'left', fontSize: 11, color: color ?? 'var(--cm-link)',
    }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--cm-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      {icon ?? <ArrowRight size={10} style={{ flexShrink: 0 }} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  )
}

function DimItem({ name, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 5, width: '100%',
      padding: '3px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
      background: active ? 'var(--cm-sel-bg)' : 'none',
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--cm-hover)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? 'var(--cm-sel-bg)' : 'none' }}
    >
      <div style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: active ? 'var(--cm-link)' : 'var(--cm-text-muted)', opacity: active ? 1 : 0.5 }} />
      <span style={{ fontSize: 11, color: active ? 'var(--cm-link)' : 'var(--cm-text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      {active && <Filter size={8} style={{ color: 'var(--cm-link)', flexShrink: 0 }} />}
    </button>
  )
}

function ActionBtn({ icon, label, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
      flex: 1, padding: '4px 6px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
      background: 'var(--cm-node-bg)', border: '1px solid var(--cm-border)', color: 'var(--cm-text)',
      transition: 'border-color 0.1s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--cm-link)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--cm-border)'}
    >
      {icon} {label}
    </button>
  )
}

function StatChip({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--cm-text)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 9, color: 'var(--cm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 1 }}>{label}</span>
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  cube, cubeData, reverseMap,
  onNavigate, onClose,
  onOpenRules, onOpenCube, onOpenProcess,
  onFilterDim, dimFilter,
  traceDepth, setTraceDepth, transitiveCount,
}) {
  if (!cube || !cubeData) return null
  const { dims, hasRules, ruleCalcRefs, ruleFeederRefs, tiWriters = [], ruleLoc = 0 } = cubeData
  const incomingCalc = (reverseMap[cube] ?? []).filter(n => n !== cube)

  return (
    <div style={{
      width: 272, borderLeft: '1px solid var(--cm-border)',
      background: 'var(--cm-panel-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--cm-border)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Layers size={13} style={{ color: hasRules ? '#f59e0b' : 'var(--cm-icon)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cm-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cube}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--cm-icon)', display: 'flex' }}>
          <X size={13} />
        </button>
      </div>

      {/* Open actions */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--cm-border)', display: 'flex', gap: 5 }}>
        {hasRules && <ActionBtn icon={<Code2 size={11} />} label="Rules"    onClick={onOpenRules} title="Open rules editor" />}
        <ActionBtn icon={<Box size={11} />}       label="Cube"     onClick={onOpenCube}  title="Open cube editor" />
      </div>

      {/* Stats */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--cm-border)', display: 'flex', gap: 14, justifyContent: 'flex-start' }}>
        <StatChip label="dims"      value={dims.length} />
        {hasRules          && <StatChip label="rule LOC" value={ruleLoc} />}
        {transitiveCount > 0 && <StatChip label="connected" value={transitiveCount} />}
        {tiWriters.length > 0 && <StatChip label="TI writers" value={tiWriters.length} />}
      </div>

      {/* Trace depth */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--cm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
          <GitBranch size={10} style={{ color: 'var(--cm-text-muted)' }} />
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--cm-text-muted)', opacity: 0.65 }}>Trace depth</span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {[1, 2, 3, 4].map(d => (
            <button key={d} onClick={() => setTraceDepth(d)} style={{
              flex: 1, padding: '3px 0', fontSize: 11, fontWeight: d === traceDepth ? 700 : 400,
              borderRadius: 4, cursor: 'pointer',
              background: d === traceDepth ? 'var(--cm-sel-bg)' : 'none',
              border: `1px solid ${d === traceDepth ? 'var(--cm-link)' : 'var(--cm-border)'}`,
              color: d === traceDepth ? 'var(--cm-link)' : 'var(--cm-text-muted)',
              transition: 'all 0.1s',
            }}>{d}</button>
          ))}
        </div>
      </div>

      {/* Scrollable sections */}
      <div style={{ overflow: 'auto', flex: 1, paddingTop: 8 }}>

        <Section title="Dimensions" icon={<Filter size={9} style={{ color: 'var(--cm-text-muted)', opacity: 0.65 }} />}>
          {dims.map(d => (
            <DimItem key={d} name={d} active={dimFilter === d} onClick={() => onFilterDim(d)} />
          ))}
        </Section>

        {ruleCalcRefs.length > 0 && (
          <Section title="Reads from (rules)" count={ruleCalcRefs.length}>
            {ruleCalcRefs.map(ref => <FlowItem key={ref} label={ref} onClick={() => onNavigate(ref)} />)}
          </Section>
        )}

        {incomingCalc.length > 0 && (
          <Section title="Referenced by" count={incomingCalc.length}>
            {incomingCalc.map(ref => (
              <FlowItem key={ref} label={ref} onClick={() => onNavigate(ref)} color="var(--cm-incoming)" />
            ))}
          </Section>
        )}

        {ruleFeederRefs.length > 0 && (
          <Section title="Feeders to" count={ruleFeederRefs.length}>
            {ruleFeederRefs.map(ref => <FlowItem key={ref} label={ref} onClick={() => onNavigate(ref)} />)}
          </Section>
        )}

        {hasRules && !ruleCalcRefs.length && !ruleFeederRefs.length && (
          <div style={{ padding: '2px 12px 10px', fontSize: 11, color: 'var(--cm-text-muted)' }}>
            Has rules — no inter-cube DB() refs found
          </div>
        )}

        {tiWriters.length > 0 && (
          <Section title="Written by (TI)" count={tiWriters.length} icon={<Zap size={9} style={{ color: 'var(--cm-text-muted)', opacity: 0.65 }} />}>
            {tiWriters.map(p => (
              <FlowItem key={p} label={p} onClick={() => onOpenProcess(p)}
                icon={<Workflow size={10} style={{ flexShrink: 0, color: 'var(--cm-link)' }} />}
              />
            ))}
          </Section>
        )}

      </div>
    </div>
  )
}

// ── Main inner component ──────────────────────────────────────────────────────

function CubeMapInner({ tab }) {
  const { server: storeServer, openTab } = useStore()
  const dark = useStore(s => s.dark)
  const srv  = tab?.server ?? storeServer
  const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('tm1-token') ?? '') : ''

  const [cubeData,       setCubeData]       = useState(null)
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState(null)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const [selectedCube,   setSelectedCube]   = useState(null)
  const [search,         setSearch]         = useState('')
  const [showFeeders,    setShowFeeders]     = useState(true)
  const [showCalc,       setShowCalc]        = useState(true)
  const [layout,         setLayout]         = useState('LR')
  const [dimmedIds,      setDimmedIds]      = useState(new Set())
  const [dimFilter,      setDimFilter]      = useState(null)
  const [traceDepth,     setTraceDepth]     = useState(1)
  const [showLegend,     setShowLegend]     = useState(false)
  const [showClusters,   setShowClusters]   = useState(false)
  const [dimSpotlight,   setDimSpotlight]   = useState('')

  const { fitView, setCenter, getNode } = useReactFlow()

  // ── Fetch ─────────────────────────────────────────────────────────────────────
  const fetchModel = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/cubemap/model?server=${encodeURIComponent(srv)}`, {
        headers: { 'x-ide-token': token },
      })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setCubeData(d.cubes)
    } catch (e) {
      setError(e.message)
      toast.error(`CubeMap: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [srv, token])

  useEffect(() => { fetchModel() }, [fetchModel])

  // Pre-computed reverse map (who references whom)
  const reverseMap = useMemo(() => cubeData ? buildReverseMap(cubeData) : {}, [cubeData])

  // ── Build graph ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cubeData) return

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

    setNodes(applyGrouping(applyDagreLayout(rawNodes, rawEdges, layout), showClusters))
    setEdges(rawEdges)
    setSelectedCube(null)
    setDimmedIds(new Set())
  }, [cubeData, showCalc, showFeeders, layout, dimFilter, showClusters])

  // ── Fit view ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (nodes.length) setTimeout(() => fitView({ padding: 0.12, duration: 400 }), 50)
  }, [nodes.length, layout, dimFilter])

  // ── Transitive set ────────────────────────────────────────────────────────────
  const transitiveSet = useMemo(() => {
    if (!selectedCube || !cubeData) return null
    return getTransitiveSet(selectedCube, traceDepth, cubeData, reverseMap)
  }, [selectedCube, traceDepth, cubeData, reverseMap])

  // ── Dimming ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCube) { setDimmedIds(new Set()); return }
    const connected = transitiveSet ?? new Set([selectedCube])
    setDimmedIds(new Set(nodes.map(n => n.id).filter(id => !connected.has(id))))
  }, [transitiveSet, selectedCube, nodes])

  // ── Visual node/edge state ────────────────────────────────────────────────────
  const spotQ = dimSpotlight.trim().toLowerCase()
  const spotActive = !!spotQ && !selectedCube

  const visibleNodes = useMemo(() => nodes.map(n => {
    if (n.type === 'group') return { ...n, selected: false }
    const isSpotlit = spotActive && cubeData?.[n.id]?.dims?.some(d => d.toLowerCase().includes(spotQ))
    const isDimmed  = dimmedIds.has(n.id) || (spotActive && !isSpotlit)
    return {
      ...n,
      data:  { ...n.data, isSpotlit: spotActive && isSpotlit },
      style: { ...n.style, opacity: isDimmed ? 0.15 : 1, transition: 'opacity 0.2s' },
      selected: n.id === selectedCube,
    }
  }), [nodes, dimmedIds, selectedCube, spotActive, spotQ, cubeData])

  const visibleEdges = useMemo(() => edges.map(e => ({
    ...e,
    style: {
      ...e.style,
      opacity: dimmedIds.size > 0 && dimmedIds.has(e.source) && dimmedIds.has(e.target) ? 0.05 : 1,
      transition: 'opacity 0.2s',
    },
    selected: false,
  })), [edges, dimmedIds])

  // ── Interactions ──────────────────────────────────────────────────────────────
  const onNodeClick = useCallback((_, node) => {
    if (node.type === 'group') return
    setSelectedCube(node.id)
    const n = getNode(node.id)
    if (n) setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { duration: 350, zoom: 1.2 })
  }, [getNode, setCenter])

  const onNodeDoubleClick = useCallback((_, node) => {
    if (node.type === 'group') return
    const hasRules = cubeData?.[node.id]?.hasRules
    openTab(hasRules
      ? { id: `rules:${srv}:${node.id}`,      type: 'rules',      label: node.id, server: srv, cube: node.id }
      : { id: `cubeeditor:${srv}:${node.id}`, type: 'cubeeditor', label: node.id, server: srv, cube: node.id }
    )
  }, [cubeData, openTab, srv])

  const onPaneClick = useCallback(() => {
    setSelectedCube(null); setDimmedIds(new Set())
  }, [])

  const navigateTo = useCallback((name) => {
    const found = nodes.find(n => n.id === name)
    if (!found) return
    setSelectedCube(name)
    setCenter(found.position.x + NODE_W / 2, found.position.y + NODE_H / 2, { duration: 400, zoom: 1.2 })
  }, [nodes, setCenter])

  // ── Open tab actions ──────────────────────────────────────────────────────────
  const openRules   = (cube)  => openTab({ id: `rules:${srv}:${cube}`,           type: 'rules',      label: cube,    server: srv, cube })
  const openCube    = (cube)  => openTab({ id: `cubeeditor:${srv}:${cube}`,       type: 'cubeeditor', label: cube,    server: srv, cube })
  const openProcess = (name)  => openTab({ id: `process:${srv}:${name}`,          type: 'process',    label: name,    server: srv, name, content: null })

  // ── Dim filter ────────────────────────────────────────────────────────────────
  const handleFilterDim = (dim) => { setDimFilter(p => p === dim ? null : dim); setSelectedCube(null) }

  // ── Sidebar list ──────────────────────────────────────────────────────────────
  const filteredCubes = useMemo(() => {
    if (!cubeData) return []
    const q = search.toLowerCase()
    return Object.keys(cubeData).filter(n => !q || n.toLowerCase().includes(q)).sort()
  }, [cubeData, search])

  const transitiveCount = transitiveSet ? transitiveSet.size - 1 : 0

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
      `}</style>

      <SvgMarkers />

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <div className="cubemap-root" style={{
        width: 222, borderRight: '1px solid var(--cm-border)',
        background: 'var(--cm-panel-bg)', display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        {/* Toolbar */}
        <div style={{ padding: '8px 8px 6px', borderBottom: '1px solid var(--cm-border)', background: 'var(--cm-toolbar)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Network size={14} style={{ color: 'var(--cm-icon)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cm-text)', flex: 1 }}>Cube Map</span>
            <button onClick={() => setShowLegend(v => !v)} title="Legend" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: showLegend ? 'var(--cm-link)' : 'var(--cm-icon)', borderRadius: 4, display: 'flex', alignItems: 'center' }}>
              <BookOpen size={12} />
            </button>
            <button onClick={fetchModel} disabled={loading} title="Refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--cm-icon)', borderRadius: 4, display: 'flex', alignItems: 'center' }}>
              <RefreshCw size={13} style={{ animation: loading ? 'cm-spin 1s linear infinite' : 'none' }} />
            </button>
          </div>

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
              <button onClick={() => setDimFilter(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--cm-link)', display: 'flex', alignItems: 'center' }}>
                <X size={9} />
              </button>
            </div>
          )}

          {/* Edge + cluster toggles */}
          <div style={{ display: 'flex', gap: 4 }}>
            <Toggle active={showCalc}     onClick={() => setShowCalc(v => !v)}     color="#b45309" label="Rules" />
            <Toggle active={showFeeders}  onClick={() => setShowFeeders(v => !v)}  color="#475569" label="Feeders" dashed />
            <Toggle active={showClusters} onClick={() => setShowClusters(v => !v)} color="#6366f1" label="Groups" />
          </div>

          {/* Layout */}
          <div style={{ display: 'flex', gap: 3 }}>
            {['LR', 'TB', 'BT', 'RL'].map(dir => (
              <button key={dir} onClick={() => setLayout(dir)} style={{
                flex: 1, fontSize: 9, padding: '2px 0', borderRadius: 3, cursor: 'pointer',
                background: layout === dir ? 'var(--cm-sel-bg)' : 'none',
                border: `1px solid ${layout === dir ? 'var(--cm-link)' : 'var(--cm-border)'}`,
                color: layout === dir ? 'var(--cm-link)' : 'var(--cm-text-muted)',
                transition: 'all 0.1s',
              }}>{dir}</button>
            ))}
          </div>
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
            <span>·</span>
            <span>{edges.length} links</span>
            {dimFilter && <span>· {nodes.length} visible</span>}
          </div>
        )}
      </div>

      {/* ── Graph canvas ───────────────────────────────────────────────────── */}
      <div className="cubemap-root" style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={0.04}
          maxZoom={3}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color={dark ? '#1e1e30' : '#cbd5e1'} gap={24} size={1} />
          <Controls />
          <MiniMap
            nodeColor={n => {
              if (n.type === 'group') return 'transparent'
              if (n.data?.hasRules) return dark ? '#78350f' : '#fde68a'
              return dark ? '#1e2a3a' : '#dbeafe'
            }}
            maskColor={dark ? 'rgba(8,8,16,0.72)' : 'rgba(241,245,249,0.72)'}
          />
        </ReactFlow>
        {showLegend && <Legend />}
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────────── */}
      {selectedCube && cubeData?.[selectedCube] && (
        <div className="cubemap-root">
          <DetailPanel
            cube={selectedCube}
            cubeData={cubeData[selectedCube]}
            reverseMap={reverseMap}
            onNavigate={navigateTo}
            onClose={() => { setSelectedCube(null); setDimmedIds(new Set()) }}
            onOpenRules={() => openRules(selectedCube)}
            onOpenCube={() => openCube(selectedCube)}
            onOpenProcess={openProcess}
            onFilterDim={handleFilterDim}
            dimFilter={dimFilter}
            traceDepth={traceDepth}
            setTraceDepth={setTraceDepth}
            transitiveCount={transitiveCount}
          />
        </div>
      )}
    </div>
  )
}

// ── Toggle helper ─────────────────────────────────────────────────────────────

function Toggle({ active, onClick, color, label, dashed }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, display: 'flex', alignItems: 'center', gap: 4,
      padding: '3px 6px', fontSize: 10, borderRadius: 4, cursor: 'pointer',
      border: `1px solid ${active ? color : 'var(--cm-border)'}`,
      background: active ? `${color}22` : 'none',
      color: active ? color : 'var(--cm-text-muted)',
      transition: 'all 0.1s',
    }}>
      <div style={{
        width: 16, flexShrink: 0,
        height: dashed ? 0 : 2,
        borderTop: dashed ? `2px dashed ${active ? color : 'var(--cm-text-muted)'}` : 'none',
        background: dashed ? 'none' : (active ? color : 'var(--cm-text-muted)'),
        borderRadius: dashed ? 0 : 1,
      }} />
      {label}
    </button>
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
