import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  Box, Eye, Play, Pause, StepBack, StepForward, SkipBack, Clapperboard, Map as MapIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { loadSettings } from '@/lib/formatters/settings.js'

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

// ── Typed adjacency (P1): reachability through rules AND TI edges ─────────────
// A node id is a cube name, `proc:<name>` or `dim:<name>`. `kinds` selects which
// edge types the traversal follows, so "graph from here" can walk the process
// network (reads/writes/calls/dim changes) as well as rule links.
const MAX_FOCUS_NODES = 250

const TRACE_KIND_DEFAULTS = { rule: true, feeder: true, read: true, write: true, dimwrite: true, call: true, dimuse: true }

function getNeighbors(id, ctx, kinds) {
  const { cubeData, processData, dimData, reverseMap, processCallers } = ctx
  const n = []
  const add = (x) => n.push(x)
  if (id.startsWith('proc:')) {
    const p = processData[id.slice(5)]
    if (!p) return n
    if (kinds.read) p.reads.forEach(add)
    if (kinds.write) p.writes.forEach(add)
    if (kinds.dimwrite) (p.dimWrites ?? []).forEach(d => add(`dim:${d}`))
    if (kinds.call) {
      p.calls.forEach(c => add(`proc:${c}`))
      ;(processCallers[id.slice(5)] ?? []).forEach(c => add(`proc:${c}`))
    }
  } else if (id.startsWith('dim:')) {
    const name = id.slice(4)
    if (kinds.dimwrite) {
      for (const [pn, p] of Object.entries(processData)) {
        if ((p.dimWrites ?? []).includes(name)) add(`proc:${pn}`)
      }
    }
    if (kinds.dimuse && dimData?.[name]) dimData[name].cubes.forEach(add)
  } else {
    const d = cubeData[id]
    if (!d) return n
    if (kinds.rule) { (d.ruleCalcRefs ?? []).forEach(add); (reverseMap[id] ?? []).forEach(add) }
    if (kinds.feeder) (d.ruleFeederRefs ?? []).forEach(add)
    if (kinds.read) (d.tiReaders ?? []).forEach(pn => add(`proc:${pn}`))
    if (kinds.write) (d.tiWriters ?? []).forEach(pn => add(`proc:${pn}`))
  }
  return n
}

function getReachable(startIds, depth, kinds, ctx) {
  const result = new Set(startIds)
  let frontier = [...startIds]
  for (let d = 0; d < depth; d++) {
    const next = []
    for (const id of frontier) {
      for (const nid of getNeighbors(id, ctx, kinds)) {
        if (result.size >= MAX_FOCUS_NODES) break
        if (!result.has(nid)) { result.add(nid); next.push(nid) }
      }
      if (result.size >= MAX_FOCUS_NODES) break
    }
    frontier = next
    if (!next.length || result.size >= MAX_FOCUS_NODES) break
  }
  return result
}

// ── Show playback: the designed run order, from the scanner's code-order steps ─────────────────────
// Walks an entry process (or chore) depth-first: each read/write/dimension change in code order, and
// each ExecuteProcess dives into the callee and comes back. Loops inside a process play once — this is
// the order the code is written in, not a replay of a real run.

const RUN_SEQ_MAX = 400

function buildRunSequence(entry, processData, cubeData, chores) {
  const items = []
  // Rules behind a cube a process reads: its own DB() refs, and the feeders that feed it
  const ruleContext = (cube) => {
    const d = cubeData[cube]
    if (!d?.hasRules) return { nodes: [], edges: [] }
    const nodes = [], edges = []
    for (const t of d.ruleCalcRefs ?? []) { nodes.push(t); edges.push(`calc:${cube}:${t}`) }
    for (const [src, sd] of Object.entries(cubeData)) {
      if ((sd.ruleFeederRefs ?? []).includes(cube)) { nodes.push(src); edges.push(`feeder:${src}:${cube}`) }
    }
    return { nodes, edges }
  }

  const visit = (proc, caller, path, intro) => {
    if (items.length >= RUN_SEQ_MAX) return
    const node = `proc:${proc}`
    if (path.includes(proc)) {
      items.push({ path, nodes: [node], edges: [], caption: `${proc} is already running further up — recursive call not followed` })
      return
    }
    const here = [...path, proc]
    items.push({
      path: here, nodes: [node], edges: caller ? [`call:${caller}:${proc}`] : [],
      caption: intro ?? (caller ? `${caller} calls ${proc}` : `${proc} starts`),
    })
    const steps = processData[proc]?.steps ?? []
    steps.forEach((s, i) => {
      if (items.length >= RUN_SEQ_MAX) return
      if (s.kind === 'read') {
        const rc = ruleContext(s.target)
        items.push({
          path: here, nodes: [node, s.target, ...rc.nodes], edges: [`read:${s.target}:${proc}`, ...rc.edges],
          caption: `${proc} reads ${s.target}` + (rc.edges.length ? ' — rule-calculated live, not a step' : ''),
        })
      } else if (s.kind === 'write') {
        items.push({ path: here, nodes: [node, s.target], edges: [`write:${proc}:${s.target}`], caption: `${proc} writes ${s.target}` })
      } else if (s.kind === 'dimwrite') {
        items.push({ path: here, nodes: [node, `dim:${s.target}`], edges: [`dimwrite:${proc}:${s.target}`], caption: `${proc} changes dimension ${s.target}` })
      } else if (s.kind === 'call') {
        visit(s.target, proc, here)
        if (i < steps.length - 1) items.push({ path: here, nodes: [node], edges: [], caption: `${s.target} done — back in ${proc}` })
      }
    })
  }

  if (entry.kind === 'chore') {
    const tasks = chores.find(c => c.name === entry.name)?.processes ?? []
    tasks.forEach((proc, i) => visit(proc, null, [`⏱ ${entry.name}`], `Chore ${entry.name} — task ${i + 1} of ${tasks.length}: ${proc}`))
  } else {
    visit(entry.name, null, [])
  }
  return items
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

function safeRegex(source) {
  try { return new RegExp(source) } catch { return null }
}

// Group cube ids by a configurable key. With a regex the group key is the first
// capture group (or the whole match if there are no groups); without one it
// falls back to the prefix before the first underscore.
function computePrefixGroups(nodeIds, regexSource) {
  const groups = {}
  const re = regexSource ? safeRegex(regexSource) : null
  for (const id of nodeIds) {
    if (id.startsWith('proc:') || id.startsWith('dim:')) continue
    let key = null
    if (re) {
      const m = id.match(re)
      if (m) key = m[1] ?? m[0]
    } else {
      const idx = id.indexOf('_')
      if (idx > 1) key = id.slice(0, idx)
    }
    if (key == null || key === '') continue
    key = key.toUpperCase()   // CON / Con / con are one module
    if (!groups[key]) groups[key] = []
    groups[key].push(id)
  }
  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length >= 2))
}

function applyGrouping(laidOut, showClusters, regexSource) {
  if (!showClusters) return laidOut
  const groups = computePrefixGroups(laidOut.map(n => n.id), regexSource)
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
      pointerEvents: 'auto',
      cursor: 'pointer',
      transition: 'border-color 0.15s',
    }} title={`Focus module ${data.label}`}>
      <div style={{
        position: 'absolute', top: 6, left: 10,
        fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: data.color, display: 'flex', alignItems: 'center', gap: 5, pointerEvents: 'none',
      }}>
        {data.label}
        <span style={{ fontWeight: 400, opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>{data.count}</span>
      </div>
    </div>
  )
}

function ProcessNode({ data }) {
  const { label } = data
  return (
    <div style={{
      width: NODE_W, height: NODE_H, borderRadius: 8,
      border: '1.5px dashed #10b981', background: 'rgba(16,185,129,0.07)',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 12px', cursor: 'pointer', overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
    }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Workflow size={12} style={{ color: '#10b981', flexShrink: 0 }} />
      <span style={{
        fontSize: 11, fontWeight: 500, color: 'var(--cm-text)', fontFamily: 'monospace',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>{label}</span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
}

// A dimension some process changes — pill-shaped so it never reads as a cube
function DimNode({ data }) {
  return (
    <div style={{
      width: NODE_W, height: NODE_H - 14, borderRadius: 999,
      border: '1.5px solid #8b5cf6', background: 'rgba(139,92,246,0.07)',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 14px', cursor: 'pointer', overflow: 'hidden',
    }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Layers size={12} style={{ color: '#8b5cf6', flexShrink: 0 }} />
      <span style={{
        fontSize: 11, fontWeight: 500, color: 'var(--cm-text)', fontFamily: 'monospace',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>{data.label}</span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
}

const nodeTypes = { cube: CubeNode, group: GroupNode, process: ProcessNode, dim: DimNode }

// ── Custom edges ──────────────────────────────────────────────────────────────

function RuleCalcEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: selected ? '#fbbf24' : '#b45309', strokeWidth: selected ? 2.5 : 1.5, opacity: 0.85 }} markerEnd={`url(#arrowCalc${selected ? 'Sel' : ''})`} />
}

function RuleFeederEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#475569', strokeWidth: 1.5, strokeDasharray: '5 4', opacity: 0.6 }} markerEnd="url(#arrowFeeder)" />
}

function ProcessWriteEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#10b981', strokeWidth: 1.5, opacity: 0.8 }} markerEnd="url(#arrowWrite)" />
}

function ProcessReadEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#0ea5e9', strokeWidth: 1.5, strokeDasharray: '6 4', opacity: 0.7 }} markerEnd="url(#arrowRead)" />
}

function ProcessDimWriteEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#8b5cf6', strokeWidth: 1.5, opacity: 0.8 }} markerEnd="url(#arrowDim)" />
}

function DimUsedByEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#8b5cf6', strokeWidth: 1, strokeDasharray: '2 4', opacity: 0.5 }} markerEnd="url(#arrowDim)" />
}

function ProcessCallEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#10b981', strokeWidth: 1.5, strokeDasharray: '3 3', opacity: 0.55 }} markerEnd="url(#arrowCall)" />
}

const edgeTypes = { rule_calc: RuleCalcEdge, rule_feeder: RuleFeederEdge, process_write: ProcessWriteEdge, process_read: ProcessReadEdge, process_call: ProcessCallEdge, process_dimwrite: ProcessDimWriteEdge, dim_used_by: DimUsedByEdge }
const PROCESS_EDGE_TYPES = new Set(['process_write', 'process_read', 'process_call', 'process_dimwrite', 'dim_used_by'])

function SvgMarkers() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        <marker id="arrowCalc"    markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#b45309" /></marker>
        <marker id="arrowCalcSel" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#fbbf24" /></marker>
        <marker id="arrowFeeder"  markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#475569" /></marker>
        <marker id="arrowWrite"   markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#10b981" /></marker>
        <marker id="arrowRead"    markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#0ea5e9" /></marker>
        <marker id="arrowDim"     markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#8b5cf6" /></marker>
        <marker id="arrowCall"    markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#10b981" /></marker>
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
        { el: <div style={{ width: 20, height: 1.5, background: '#10b981' }} />,                       label: 'TI writes to cube'       },
        { el: <div style={{ width: 20, borderTop: '1.5px dashed #0ea5e9' }} />,                        label: 'Cube read by TI'         },
        { el: <div style={{ width: 20, height: 1.5, background: '#8b5cf6' }} />,                       label: 'TI changes dimension'    },
        { el: <div style={{ width: 20, borderTop: '1.5px dotted #8b5cf6' }} />,                        label: 'Dimension used by cube (focus)' },
        { el: <div style={{ width: 20, borderTop: '1.5px dashed #10b981' }} />,                        label: 'Process calls process'  },
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
  onOpenRules, onOpenCube,
  processCallers = {},
  onFilterDim, dimFilter,
  traceDepth, setTraceDepth, traceKinds, setTraceKinds, transitiveCount,
}) {
  if (!cube || !cubeData) return null
  const { dims, hasRules, ruleCalcRefs, ruleFeederRefs, tiWriters = [], tiReaders = [], ruleLoc = 0 } = cubeData
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
        {tiReaders.length > 0 && <StatChip label="TI readers" value={tiReaders.length} />}
      </div>

      {/* Trace depth */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--cm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }} title="How many hops to follow from this cube through the edge kinds selected below (rules AND TI reads/writes/calls/dimension usage).">
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

      {/* Follow kinds */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--cm-border)' }} title="Edge kinds the trace follows. Untick to cut whole relationship types out of the reachable graph.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
          <Zap size={10} style={{ color: 'var(--cm-text-muted)' }} />
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--cm-text-muted)', opacity: 0.65 }}>Follow</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {[
            { k: 'rule',     label: 'Rules' },
            { k: 'feeder',   label: 'Feeders' },
            { k: 'read',     label: 'TI reads' },
            { k: 'write',    label: 'TI writes' },
            { k: 'call',     label: 'Calls' },
            { k: 'dimwrite', label: 'Dim changes' },
            { k: 'dimuse',   label: 'Dim usage' },
          ].map(o => (
            <label key={o.k} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--cm-text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!traceKinds[o.k]} onChange={() => setTraceKinds({ ...traceKinds, [o.k]: !traceKinds[o.k] })} />
              {o.label}
            </label>
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
            {tiWriters.map(p => {
              const callers = processCallers[p] ?? []
              return (
                <div key={p}>
                  <FlowItem label={p} onClick={() => onNavigate(`proc:${p}`)}
                    icon={<Workflow size={10} style={{ flexShrink: 0, color: 'var(--cm-link)' }} />}
                  />
                  {callers.length > 0 && (
                    <div style={{ padding: '0 12px 0 30px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cm-text-muted)', opacity: 0.5 }}>
                      called by
                    </div>
                  )}
                  {callers.map(c => (
                    <div key={c} style={{ paddingLeft: 18 }}>
                      <FlowItem label={c} onClick={() => onNavigate(`proc:${c}`)} color="var(--cm-text-muted)" />
                    </div>
                  ))}
                </div>
              )
            })}
          </Section>
        )}

        {tiReaders.length > 0 && (
          <Section title="Read by (TI)" count={tiReaders.length} icon={<Zap size={9} style={{ color: 'var(--cm-text-muted)', opacity: 0.65 }} />}>
            {tiReaders.map(p => (
              <FlowItem key={p} label={p} onClick={() => onNavigate(`proc:${p}`)}
                icon={<Workflow size={10} style={{ flexShrink: 0, color: '#0ea5e9' }} />}
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
  const themeVersion = useStore(s => s.themeVersion)
  const srv  = tab?.server ?? storeServer
  const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('tm1-token') ?? '') : ''

  // Configurable cube grouping key (regex) — reloads whenever settings are saved.
  const groupRegex = useMemo(() => loadSettings().cubeMap?.groupRegex ?? '', [themeVersion])

  const [cubeData,       setCubeData]       = useState(null)
  const [processCallers, setProcessCallers] = useState({})
  const [processData,    setProcessData]    = useState({})
  const [dimData,        setDimData]        = useState({})
  const [chores,         setChores]         = useState([])
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState(null)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Per-server view prefs (layout, toggles, trace depth/kinds) persisted to localStorage.
  const prefsKey = `tm1-cubemap-prefs:${srv}`
  const prefs = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(prefsKey)) ?? {} } catch { return {} }
  }, [prefsKey])

  const [selectedCube,   setSelectedCube]   = useState(null)
  const [moduleFocus,    setModuleFocus]    = useState(null)
  const [focused,        setFocused]        = useState(false)
  const [traceKinds,     setTraceKinds]     = useState({ ...TRACE_KIND_DEFAULTS, ...(prefs.traceKinds ?? {}) })
  const [search,         setSearch]         = useState('')
  const [showFeeders,    setShowFeeders]     = useState(prefs.showFeeders ?? true)
  const [showCalc,       setShowCalc]        = useState(prefs.showCalc ?? true)
  const [layout,         setLayout]         = useState(prefs.layout ?? 'LR')
  const [dimmedIds,      setDimmedIds]      = useState(new Set())
  const [dimFilter,      setDimFilter]      = useState(null)
  const [traceDepth,     setTraceDepth]     = useState(prefs.traceDepth ?? 1)
  const [showLegend,     setShowLegend]     = useState(prefs.showLegend ?? false)
  const [showMiniMap,    setShowMiniMap]    = useState(prefs.showMiniMap ?? true)
  const [showClusters,   setShowClusters]   = useState(prefs.showClusters ?? false)
  const [dimSpotlight,   setDimSpotlight]   = useState('')
  const [showProcesses,  setShowProcesses]  = useState(prefs.showProcesses ?? true)
  const [allTI,          setAllTI]          = useState(prefs.allTI ?? false)
  const [showDims,       setShowDims]       = useState(prefs.showDims ?? true)
  // Show playback
  const [showBar,        setShowBar]        = useState(false)
  const [runEntry,       setRunEntry]       = useState('')    // 'process:<name>' | 'chore:<name>'
  const [runSeq,         setRunSeq]         = useState(null)
  const [runIdx,         setRunIdx]         = useState(0)
  const [playing,        setPlaying]        = useState(false)
  const [speed,          setSpeed]          = useState(1)
  const [follow,         setFollow]         = useState(false)
  const canvasRef = useRef(null)

  const { fitView, setCenter, getNode, getViewport } = useReactFlow()

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
      setProcessCallers(d.processCallers ?? {})
      setProcessData(d.processes ?? {})
      setDimData(d.dims ?? {})
      setChores(d.chores ?? [])
    } catch (e) {
      setError(e.message)
      toast.error(`CubeMap: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [srv, token])

  useEffect(() => { fetchModel() }, [fetchModel])

  // Persist view prefs for this server
  useEffect(() => {
    try {
      localStorage.setItem(prefsKey, JSON.stringify({
        layout, showCalc, showFeeders, showClusters, showDims, showProcesses, allTI,
        showMiniMap, showLegend, traceDepth, traceKinds,
      }))
    } catch {}
  }, [prefsKey, layout, showCalc, showFeeders, showClusters, showDims, showProcesses, allTI, showMiniMap, showLegend, traceDepth, traceKinds])

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
  const reachableSet = useMemo(() => {
    if (!cubeData) return null
    const ctx = { cubeData, processData, dimData, reverseMap, processCallers }
    if (moduleFocus) {
      const seeds = modulesMap[moduleFocus] ?? []
      if (!seeds.length) return null
      return getReachable(seeds, traceDepth, traceKinds, ctx)
    }
    if (!selectedCube) return null
    return getReachable([selectedCube], traceDepth, traceKinds, ctx)
  }, [moduleFocus, selectedCube, traceDepth, traceKinds, cubeData, processData, dimData, reverseMap, processCallers, modulesMap])

  // ── Build graph ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cubeData) return

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
          for (const dimName of cubeData[id]?.dims ?? []) {
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
          if (showCalc) (d?.ruleCalcRefs ?? []).forEach(t => addEdge('rule_calc', id, t))
          if (showFeeders) (d?.ruleFeederRefs ?? []).forEach(t => addEdge('rule_feeder', id, t))
        }
      }
      setNodes(applyGrouping(applyDagreLayout(rawNodes, rawEdges, layout), showClusters, groupRegex))
      setEdges(rawEdges)
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

    setNodes(applyGrouping(applyDagreLayout(rawNodes, rawEdges, layout), showClusters, groupRegex))
    setEdges(rawEdges)
    if (!focused) { setSelectedCube(null); setDimmedIds(new Set()) }
  }, [cubeData, processData, dimData, allTI, showDims, showProcesses, showCalc, showFeeders, layout, dimFilter, showClusters, groupRegex, focused, selectedCube, traceDepth, traceKinds, reachableSet])

  // ── Fit view ──────────────────────────────────────────────────────────────────
  // (not while Show is running — the camera holds still there; startShow does one fit itself)
  const showRunningRef = useRef(false)
  useEffect(() => {
    if (nodes.length && !showRunningRef.current) setTimeout(() => fitView({ padding: 0.12, duration: 400 }), 50)
  }, [nodes.length, layout, dimFilter, focused, selectedCube])

  // ── Show playback ───────────────────────────────────────────────────────────
  // Entry points: chores, then processes nothing else calls, longest run first
  const runEntries = useMemo(() => {
    const procs = Object.keys(processData)
      .filter(n => !(processCallers[n]?.length) && processData[n].steps.length)
      .map(n => ({ key: `process:${n}`, label: n, len: buildRunSequence({ kind: 'process', name: n }, processData, cubeData ?? {}, chores).length }))
      .sort((a, b) => b.len - a.len || a.label.localeCompare(b.label))
    return [...chores.map(c => ({ key: `chore:${c.name}`, label: `⏱ ${c.name}${c.active ? '' : ' (inactive)'}` })), ...procs]
  }, [processData, processCallers, cubeData, chores])

  const startShow = useCallback((key) => {
    if (!key || !cubeData) return
    const [kind, ...rest] = key.split(':')
    const seq = buildRunSequence({ kind, name: rest.join(':') }, processData, cubeData, chores)
      .filter(it => showDims || !it.nodes.some(n => n.startsWith('dim:')) || it.edges.length === 0)
    // the playback needs every process on the map
    setAllTI(true); setShowProcesses(true); setFocused(false); setSelectedCube(null); setModuleFocus(null); setDimFilter(null)
    setRunEntry(key); setRunSeq(seq); setRunIdx(0); setPlaying(true)
    showRunningRef.current = true
    // one fit once the All TI layout has rendered, then the camera stays where the user puts it
    setTimeout(() => fitView({ padding: 0.08, duration: 400 }), 250)
  }, [cubeData, processData, chores, showDims, fitView])

  useEffect(() => { if (!runSeq) showRunningRef.current = false }, [runSeq])

  const stopShow = useCallback(() => { setPlaying(false); setRunSeq(null); setShowBar(false) }, [])

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
    if (!runSeq || !runStep) return null
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
  const focusModule = useCallback((key) => {
    if (!key) return
    setModuleFocus(key)
    setSelectedCube(null)
    setFocused(true)
    setDimmedIds(new Set())
    const n = getNode(`__group__${key}`)
    if (n) setCenter(n.position.x + n.style?.width / 2, n.position.y + (n.style?.height ?? 0) / 2, { duration: 350, zoom: 1.1 })
  }, [getNode, setCenter])

  const onNodeClick = useCallback((_, node) => {
    if (node.type === 'group') { focusModule(node.data.label); return }
    setSelectedCube(node.id)
    setModuleFocus(null)
    setFocused(true)
    const n = getNode(node.id)
    if (n) setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { duration: 350, zoom: 1.2 })
  }, [getNode, setCenter, focusModule])

  const onNodeDoubleClick = useCallback((_, node) => {
    if (node.type === 'cube') {
      const hasRules = cubeData?.[node.id]?.hasRules
      openTab(hasRules
        ? { id: `rules:${srv}:${node.id}`,      type: 'rules',      label: node.id, server: srv, cube: node.id }
        : { id: `cubeeditor:${srv}:${node.id}`, type: 'cubeeditor', label: node.id, server: srv, cube: node.id }
      )
      return
    }
    if (node.type === 'process') {
      const name = node.id.slice('proc:'.length)
      openTab({ id: `process:${srv}:${name}`, type: 'process', label: name, server: srv, name, content: null })
      return
    }
    if (node.type === 'dim') {
      const dim = node.id.slice('dim:'.length)
      openTab({ id: `dimension:${srv}:${dim}`, type: 'dimension', label: dim, server: srv, dimension: dim })
    }
  }, [cubeData, openTab, srv])

  const onPaneClick = useCallback(() => {
    setModuleFocus(null); setSelectedCube(null); setDimmedIds(new Set()); setFocused(false)
  }, [])

  const exitFocus = useCallback(() => {
    setModuleFocus(null); setSelectedCube(null); setDimmedIds(new Set()); setFocused(false)
  }, [])

  // Esc exits focus / module view
  useEffect(() => {
    if (!focused) return
    const onKey = (e) => { if (e.key === 'Escape') exitFocus() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, exitFocus])

  const navigateTo = useCallback((name) => {
    setModuleFocus(null)
    setSelectedCube(name)
    setFocused(true)
    const found = nodes.find(n => n.id === name)
    if (found) setCenter(found.position.x + NODE_W / 2, found.position.y + NODE_H / 2, { duration: 400, zoom: 1.2 })
  }, [nodes, setCenter])

  // ── Open tab actions ──────────────────────────────────────────────────────────
  const openRules   = (cube)  => openTab({ id: `rules:${srv}:${cube}`,           type: 'rules',      label: cube,    server: srv, cube })
  const openCube    = (cube)  => openTab({ id: `cubeeditor:${srv}:${cube}`,       type: 'cubeeditor', label: cube,    server: srv, cube })

  // ── Dim filter ────────────────────────────────────────────────────────────────
  const handleFilterDim = (dim) => { setDimFilter(p => p === dim ? null : dim); setModuleFocus(null); setSelectedCube(null); setFocused(false) }

  // ── Sidebar list ──────────────────────────────────────────────────────────────
  const filteredCubes = useMemo(() => {
    if (!cubeData) return []
    const q = search.toLowerCase()
    return Object.keys(cubeData).filter(n => !q || n.toLowerCase().includes(q)).sort()
  }, [cubeData, search])

  const transitiveCount = reachableSet ? reachableSet.size - 1 : 0
  const reachableCapped = reachableSet ? reachableSet.size >= MAX_FOCUS_NODES : false
  const focusLabel = moduleFocus ? `module ${moduleFocus}` : (selectedCube?.replace(/^(proc|dim):/, '') ?? '')

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
      <div className="cubemap-root" style={{
        width: 222, borderRight: '1px solid var(--cm-border)',
        background: 'var(--cm-panel-bg)', display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        {/* Toolbar */}
        <div style={{ padding: '8px 8px 6px', borderBottom: '1px solid var(--cm-border)', background: 'var(--cm-toolbar)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Network size={14} style={{ color: 'var(--cm-icon)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cm-text)', flex: 1 }}>Cube Map</span>
            <button onClick={() => setShowBar(v => !v)} title="Show — step through a run" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: showBar ? '#f59e0b' : 'var(--cm-icon)', borderRadius: 4, display: 'flex', alignItems: 'center' }}>
              <Clapperboard size={12} />
            </button>
            <button onClick={() => setShowLegend(v => !v)} title="Legend" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: showLegend ? 'var(--cm-link)' : 'var(--cm-icon)', borderRadius: 4, display: 'flex', alignItems: 'center' }}>
              <BookOpen size={12} />
            </button>
            <button onClick={() => setShowMiniMap(v => !v)} title="Overview map" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: showMiniMap ? 'var(--cm-link)' : 'var(--cm-icon)', borderRadius: 4, display: 'flex', alignItems: 'center' }}>
              <MapIcon size={12} />
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <Toggle active={showCalc}      onClick={() => setShowCalc(v => !v)}      color="#b45309" label="Rules" />
            <Toggle active={showFeeders}   onClick={() => setShowFeeders(v => !v)}   color="#475569" label="Feeders" dashed />
            <Toggle active={showClusters}  onClick={() => setShowClusters(v => !v)}  color="#6366f1" label="Groups" title={groupRegex ? `Group by regex: ${groupRegex}` : 'Group by prefix before first underscore'} />
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
            <Toggle active={showProcesses} onClick={() => setShowProcesses(v => !v)} color="#10b981" label="TI" />
            <Toggle active={allTI && showProcesses} onClick={() => { setAllTI(v => !v); setShowProcesses(true) }} color="#0ea5e9" label="All TI" />
            {allTI && showProcesses && <Toggle active={showDims} onClick={() => setShowDims(v => !v)} color="#8b5cf6" label="Dims" />}
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
            {allTI && showProcesses && <><span>·</span><span>{nodes.filter(n => n.type === 'process').length} processes</span></>}
            <span>·</span>
            <span>{edges.length} links</span>
            {dimFilter && <span>· {nodes.length} visible</span>}
          </div>
        )}
      </div>

      {/* ── Graph canvas ───────────────────────────────────────────────────── */}
      <div ref={canvasRef} className="cubemap-root" style={{ flex: 1, position: 'relative' }}>
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
          {showMiniMap && (
            <MiniMap
              nodeColor={n => {
                if (n.type === 'group') return 'transparent'
                if (n.data?.hasRules) return dark ? '#78350f' : '#fde68a'
                return dark ? '#1e2a3a' : '#dbeafe'
              }}
              maskColor={dark ? 'rgba(8,8,16,0.72)' : 'rgba(241,245,249,0.72)'}
            />
          )}
        </ReactFlow>
        {showLegend && <Legend />}
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
          />
        )}
        {focused && (selectedCube || moduleFocus) && (
          <div style={{
            position: 'absolute', top: 10, left: 10, zIndex: 5,
            background: 'var(--cm-panel-bg)', border: '1px solid var(--cm-border)',
            borderRadius: 7, padding: '6px 10px', fontSize: 11, color: 'var(--cm-text)',
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}>
            <GitBranch size={12} style={{ color: 'var(--cm-link)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Focused on <b style={{ color: 'var(--cm-link)' }}>{focusLabel}</b>
              {transitiveCount > 0 && <span style={{ color: 'var(--cm-text-muted)' }}> · {transitiveCount} connected{reachableCapped ? ' (capped)' : ''}</span>}
            </span>
            {moduleFocus && (
              <div style={{ display: 'flex', gap: 2 }} title="How many hops to follow through the selected edge kinds">
                {[1, 2, 3, 4].map(d => (
                  <button key={d} onClick={() => setTraceDepth(d)} style={{
                    padding: '1px 5px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
                    background: d === traceDepth ? 'var(--cm-sel-bg)' : 'none',
                    border: `1px solid ${d === traceDepth ? 'var(--cm-link)' : 'var(--cm-border)'}`,
                    color: d === traceDepth ? 'var(--cm-link)' : 'var(--cm-text-muted)',
                  }}>{d}</button>
                ))}
              </div>
            )}
            <button onClick={exitFocus} title="Exit focus — show full map" style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: 'var(--cm-icon)', borderRadius: 4, display: 'flex', alignItems: 'center',
            }}>
              <X size={12} />
            </button>
          </div>
        )}
      </div>

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
            onOpenCube={() => openCube(selectedCube)}
            processCallers={processCallers}
            onFilterDim={handleFilterDim}
            dimFilter={dimFilter}
            traceDepth={traceDepth}
            setTraceDepth={setTraceDepth}
            traceKinds={traceKinds}
            setTraceKinds={setTraceKinds}
            transitiveCount={transitiveCount}
          />
        </div>
      )}
    </div>
  )
}

// ── Show bar ─────────────────────────────────────────────────────────────────

function ShowBar({ entries, entry, onEntry, seq, idx, step, playing, onPlay, onPrev, onNext, onRestart, speed, onSpeed, follow, onFollow, onClose }) {
  const btn = { background: 'none', border: '1px solid var(--cm-border)', borderRadius: 4, cursor: 'pointer', padding: '3px 6px', color: 'var(--cm-text)', display: 'flex', alignItems: 'center' }
  return (
    <div style={{
      position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
      width: 'min(680px, calc(100% - 24px))', boxSizing: 'border-box',
      background: 'var(--cm-panel-bg)', border: '1px solid var(--cm-border)', borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)', padding: '8px 10px', fontSize: 11, color: 'var(--cm-text)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Clapperboard size={13} style={{ color: '#f59e0b', flexShrink: 0 }} />
        <select value={entry} onChange={e => onEntry(e.target.value)} title="Where the run starts" style={{
          flex: 1, minWidth: 140, fontSize: 11, padding: '3px 4px', background: 'var(--cm-node-bg)',
          color: 'var(--cm-text)', border: '1px solid var(--cm-border)', borderRadius: 4,
        }}>
          <option value="" disabled>Start from…</option>
          {entries.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
        </select>
        <button style={btn} onClick={onRestart} disabled={!seq} title="Back to the start"><SkipBack size={12} /></button>
        <button style={btn} onClick={onPrev}    disabled={!seq} title="Previous step"><StepBack size={12} /></button>
        <button style={{ ...btn, borderColor: '#f59e0b', color: '#f59e0b' }} onClick={onPlay} disabled={!entries.length} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button style={btn} onClick={onNext}    disabled={!seq} title="Next step"><StepForward size={12} /></button>
        <select value={speed} onChange={e => onSpeed(Number(e.target.value))} title="Speed" style={{ fontSize: 11, padding: '2px', background: 'var(--cm-node-bg)', color: 'var(--cm-text)', border: '1px solid var(--cm-border)', borderRadius: 4 }}>
          {[0.5, 1, 2, 4].map(s => <option key={s} value={s}>{s}×</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--cm-text-muted)', cursor: 'pointer' }} title="Pan (never zoom) to a step when it's off-screen">
          <input type="checkbox" checked={follow} onChange={e => onFollow(e.target.checked)} /> Follow
        </label>
        <button style={{ ...btn, border: 'none' }} onClick={onClose} title="Close Show"><X size={12} /></button>
      </div>
      {!entries.length && <div style={{ color: 'var(--cm-text-muted)' }}>No entry points — no process here reads, writes or calls anything.</div>}
      {step && (
        <>
          <div style={{ fontSize: 10, color: 'var(--cm-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {step.path.join('  ›  ')}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cm-text-muted)', flexShrink: 0 }}>{idx + 1} / {seq.length}</span>
            <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{step.caption}</span>
          </div>
          {idx === seq.length - 1 && (
            <div style={{ fontSize: 10, color: 'var(--cm-text-muted)', opacity: 0.75 }}>
              End of run. Order follows the code as written — loops play once; it's not a replay of a real run.
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Toggle helper ─────────────────────────────────────────────────────────────

function Toggle({ active, onClick, color, label, dashed, title }) {
  return (
    <button onClick={onClick} title={title} style={{
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
