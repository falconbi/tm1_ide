// Roots and parent/child edges as TM1 returns them. Roots follow the element
// Index; children follow the edge order the server returns (that is what
// tm1.SetComponent's Before controls).
export function buildTree(elements, edges) {
  const sorted = [...elements].sort((a, b) => (a.Index ?? 0) - (b.Index ?? 0))
  const byName = {}
  for (const e of sorted) byName[e.Name] = e
  const childrenOf = {}
  const isChild = new Set()
  for (const edge of edges) {
    if (!childrenOf[edge.ParentName]) childrenOf[edge.ParentName] = []
    childrenOf[edge.ParentName].push(edge.ComponentName)
    isChild.add(edge.ComponentName)
  }
  const roots = sorted.filter(e => !isChild.has(e.Name)).map(e => e.Name)
  return { roots, childrenOf, byName }
}

// is `node` anywhere below `ancestor`? (used to refuse a drag that would make a loop)
export function isUnder(childrenOf, ancestor, node) {
  const stack = [...(childrenOf[ancestor] ?? [])]
  const seen = new Set()
  while (stack.length) {
    const c = stack.pop()
    if (c === node) return true
    if (seen.has(c)) continue
    seen.add(c)
    stack.push(...(childrenOf[c] ?? []))
  }
  return false
}

// The depth-first order the tree shows, with a depth for each element. Elements
// that no root reaches are appended last so nothing disappears from the grid.
export function buildTreeOrder(elements, edges) {
  const sorted = [...elements].sort((a, b) => (a.Index ?? 0) - (b.Index ?? 0))
  const childrenOf = {}
  const isChild = new Set()
  for (const edge of edges) {
    if (!childrenOf[edge.ParentName]) childrenOf[edge.ParentName] = []
    childrenOf[edge.ParentName].push(edge.ComponentName)
    isChild.add(edge.ComponentName)
  }
  const byName = Object.fromEntries(sorted.map(e => [e.Name, e]))
  const roots = sorted.filter(e => !isChild.has(e.Name)).map(e => e.Name)
  const result = []
  const visited = new Set()
  function dfs(name, depth) {
    if (visited.has(name)) return
    visited.add(name)
    const el = byName[name]
    if (el) result.push({ ...el, depth })
    for (const child of childrenOf[name] ?? []) dfs(child, depth + 1)
  }
  for (const r of roots) dfs(r, 0)
  for (const el of sorted) if (!visited.has(el.Name)) result.push({ ...el, depth: 0 })
  return result
}
