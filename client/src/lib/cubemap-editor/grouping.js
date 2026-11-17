import { NODE_W, NODE_H } from './layout.js'

export const GROUP_COLORS = [
  { border: '#3b82f6', bg: 'rgba(59,130,246,0.05)'  },
  { border: '#10b981', bg: 'rgba(16,185,129,0.05)'  },
  { border: '#8b5cf6', bg: 'rgba(139,92,246,0.05)'  },
  { border: '#f59e0b', bg: 'rgba(245,158,11,0.05)'  },
  { border: '#06b6d4', bg: 'rgba(6,182,212,0.05)'   },
  { border: '#ec4899', bg: 'rgba(236,72,153,0.05)'  },
  { border: '#84cc16', bg: 'rgba(132,204,22,0.05)'  },
  { border: '#f97316', bg: 'rgba(249,115,22,0.05)'  },
]

export const CLUSTER_PAD = 22

function safeRegex(source) {
  try { return new RegExp(source) } catch { return null }
}

// Group cube ids by a configurable key. With a regex the group key is the first
// capture group (or the whole match if there are no groups); without one it
// falls back to the prefix before the first underscore.
export function computePrefixGroups(nodeIds, regexSource) {
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

export function applyGrouping(laidOut, showClusters, regexSource) {
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
