import dagre from '@dagrejs/dagre'

export const NODE_W = 192
export const NODE_H = 52
export const FIT_MAX_ZOOM = 1.1
export const FIT_MIN_ZOOM_FULL = 0.05

export function applyDagreLayout(nodes, edges, direction = 'LR') {
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
