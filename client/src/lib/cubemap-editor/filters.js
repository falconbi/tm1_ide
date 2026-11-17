export const prefixOf = name => String(name ?? '').split(/[\s_]/)[0]

export function applyLensActions(rawNodes, rawEdges, usage, roots, show, keep = []) {
  const isLens = name => !!usage[name]?.length
  const hide = new Set()
  if (!show) {
    for (const n of rawNodes) {
      if (n.type !== 'process' || keep.includes(n.id)) continue
      const name = n.id.slice(5)
      const rs = [...(roots[name] ?? [])]
      if (isLens(name) || (rs.length && rs.every(r => r !== name && isLens(r)))) hide.add(n.id)
    }
  }
  const nodes = rawNodes.filter(n => !hide.has(n.id)).map(n =>
    n.type === 'process' && isLens(n.id.slice(5)) ? { ...n, data: { ...n.data, lens: usage[n.id.slice(5)] } } : n)
  const edges = rawEdges.filter(e => !hide.has(e.source) && !hide.has(e.target))
  return { nodes, edges }
}

// ── Process folding ───────────────────────────────────────────────────────────
// A process another process calls is a helper of its caller's chain: on the map it folds into the
// top-level process(es) it belongs to (ones with no caller), which show "+n". Worked out from the
// code each load — nothing to maintain. A shared helper folds into every caller on screen; open a
// chain (its "+n") to show every step.

export function processRoots(processData, processCallers) {
  const memo = {}
  const rootsOf = (name, seen = new Set()) => {
    if (memo[name]) return memo[name]
    if (seen.has(name)) return new Set()          // call cycle — no root through here
    seen.add(name)
    const callers = (processCallers[name] ?? []).filter(c => processData[c])
    const out = new Set()
    if (!callers.length) out.add(name)
    else for (const c of callers) for (const r of rootsOf(c, seen)) out.add(r)
    if (!out.size) out.add(name)                  // only reachable through a cycle: treat as its own root
    memo[name] = out
    return out
  }
  return Object.fromEntries(Object.keys(processData).map(n => [n, rootsOf(n)]))
}

export function foldProcesses(rawNodes, rawEdges, roots, expanded, onToggleFold) {
  const present = new Set(rawNodes.filter(n => n.type === 'process').map(n => n.id.slice(5)))
  // helper name -> the top-level processes on screen it folds into (all of them, so a shared helper
  // like a recalculation request never draws a fan of call lines); opening any of those chains shows it
  const into = {}
  for (const name of present) {
    const rs = [...(roots[name] ?? [])].filter(r => r !== name && present.has(r))
    if (rs.length && !rs.some(r => expanded.has(r))) into[name] = rs
  }
  const count = {}
  for (const rs of Object.values(into)) for (const r of rs) count[r] = (count[r] ?? 0) + 1
  const mapIds = id => id.startsWith('proc:') && into[id.slice(5)] ? into[id.slice(5)].map(r => `proc:${r}`) : [id]
  const nodes = rawNodes.filter(n => !(n.type === 'process' && into[n.id.slice(5)])).map(n => {
    if (n.type !== 'process') return n
    const name = n.id.slice(5)
    const hidden = count[name] ?? 0
    return hidden > 0 || expanded.has(name)
      ? { ...n, data: { ...n.data, folded: hidden, expanded: expanded.has(name), onToggleFold: () => onToggleFold(name) } }
      : n
  })
  const seen = new Set(), edges = []
  for (const e of rawEdges) {
    for (const source of mapIds(e.source)) for (const target of mapIds(e.target)) {
      if (source === target) continue              // a call inside a folded chain
      const id = `${e.type}:${source}:${target}`
      if (seen.has(id)) continue
      seen.add(id)
      edges.push({ ...e, id, source, target })
    }
  }
  return { nodes, edges }
}

// ── Dimension filter ──────────────────────────────────────────────────────────
// Narrow a trace to the cubes that use one dimension, the processes that read or write those
// cubes, and that dimension itself. Seeds always stay so the view never loses its anchor.
export function narrowToDim(set, dim, seeds, cubeData, processData) {
  if (!set || !dim) return set
  const keepCube = id => cubeData[id]?.dims?.includes(dim)
  const out = new Set()
  for (const id of set) {
    if (seeds?.includes(id)) { out.add(id); continue }
    if (id.startsWith('dim:')) { if (id === `dim:${dim}`) out.add(id); continue }
    if (id.startsWith('proc:')) continue
    if (keepCube(id)) out.add(id)
  }
  for (const id of set) {
    if (!id.startsWith('proc:')) continue
    const p = processData[id.slice(5)]
    if (p && [...p.reads, ...p.writes].some(c => out.has(c))) out.add(id)
  }
  return out
}

// ── Prefix clustering ─────────────────────────────────────────────────────────
