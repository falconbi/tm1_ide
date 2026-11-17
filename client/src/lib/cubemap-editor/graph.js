export const MAX_FOCUS_NODES = 250

export function buildReverseMap(cubeData) {
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

export function getNeighbors(id, ctx, kinds) {
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

export function getReachable(startIds, depth, kinds, ctx) {
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

// Run sequence + Steps list live in @/lib/run-sequence and this file's dialogs below

// ── Lens actions ──────────────────────────────────────────────────────────────
