// Shared by the Step list, the Show playback and the runbook.

// ── Show playback: the designed run order, from the scanner's code-order steps ─────────────────────
// Walks an entry process (or chore) depth-first: each read/write/dimension change in code order, and
// each ExecuteProcess dives into the callee and comes back. Loops inside a process play once — this is
// the order the code is written in, not a replay of a real run.

export const RUN_SEQ_MAX = 400

export function buildRunSequence(entry, processData, cubeData, chores) {
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
      items.push({ path, nodes: [node], edges: [], kind: 'note', caption: `${proc} is already running further up — recursive call not followed` })
      return
    }
    const here = [...path, proc]
    items.push({
      path: here, nodes: [node], edges: caller ? [`call:${caller}:${proc}`] : [],
      kind: 'process',
      caption: intro ?? (caller ? `${caller} calls ${proc}` : `${proc} starts`),
    })
    const steps = processData[proc]?.steps ?? []
    steps.forEach((s, i) => {
      if (items.length >= RUN_SEQ_MAX) return
      if (s.kind === 'read') {
        const rc = ruleContext(s.target)
        items.push({
          path: here, nodes: [node, s.target, ...rc.nodes], edges: [`read:${s.target}:${proc}`, ...rc.edges],
          kind: 'read',
          caption: `${proc} reads ${s.target}` + (rc.edges.length ? ' — rule-calculated live, not a step' : ''),
        })
      } else if (s.kind === 'write') {
        items.push({ path: here, nodes: [node, s.target], edges: [`write:${proc}:${s.target}`], kind: 'write', measures: s.measures ?? [], caption: `${proc} writes ${s.target}${s.measures?.length ? ' — ' + s.measures.join(', ') : ''}` })
      } else if (s.kind === 'dimwrite') {
        items.push({ path: here, nodes: [node, `dim:${s.target}`], edges: [`dimwrite:${proc}:${s.target}`], kind: 'dimwrite', caption: `${proc} changes dimension ${s.target}` })
      } else if (s.kind === 'call') {
        visit(s.target, proc, here)
        if (i < steps.length - 1) items.push({ path: here, nodes: [node], edges: [], kind: 'note', caption: `${s.target} done — back in ${proc}` })
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



// A phase is a runbook step-list: its entries in the configured order, each process's
// own sequence, with a note marking the phase and the entry. Used by Show when the
// map is focused on a phase.
export function buildPhaseSequence(phase, processData, cubeData, chores) {
  if (!phase) return []
  const entries = phase.entries?.length ? phase.entries : (phase.processes ?? []).map(name => ({ type: 'process', name }))
  const items = []
  entries.forEach((e, i) => {
    if (items.length >= RUN_SEQ_MAX) return
    if (e.type === 'manual') {
      items.push({ path: [phase.label ?? 'Phase'], nodes: [], edges: [], kind: 'note', caption: `Manual — ${e.label ?? ''}` })
      return
    }
    if (phase.kind === 'phase' || entries.length > 1) {
      items.push({ path: [phase.label ?? 'Phase'], nodes: [], edges: [], kind: 'note', caption: `${phase.label ?? 'Phase'} — step ${i + 1}: ${e.name}` })
    }
    const seq = buildRunSequence({ kind: e.type === 'chore' ? 'chore' : 'process', name: e.name }, processData, cubeData, chores)
    for (const s of seq) {
      if (items.length >= RUN_SEQ_MAX) break
      items.push(s)
    }
  })
  return items
}
