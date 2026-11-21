// The plain-text summary of a change set: what someone pastes into a commit
// message, a ticket or an email. It used to live behind a "report" tab that
// showed the same entries the Change Sets panel already lists — the text was the
// only thing that tab added, so it lives here and the panel offers Copy.

// The one description of a log action, shared by the panel row and the summary.
export function autoDescription(action, objectName, detail) {
  switch (action) {
    case 'RULES_SAVED':        return `Rules updated for cube '${objectName}'`
    case 'PROCESS_SAVED':      return `Process '${objectName}' modified`
    case 'PROCESS_CREATED':    return `Process '${objectName}' created`
    case 'PROCESS_DELETED':    return `Process '${objectName}' deleted`
    case 'DIMENSION_CREATED':  return `Dimension '${objectName}' created`
    case 'DIMENSION_DELETED':  return `Dimension '${objectName}' deleted`
    case 'CUBE_CREATED':       return `Cube '${objectName}' created`
    case 'CUBE_DELETED':       return `Cube '${objectName}' deleted`
    case 'SUBSET_SAVED':       return `Subset '${objectName}' saved${detail ? ` in '${detail}'` : ''}`
    case 'SUBSET_DELETED':     return `Subset '${objectName}' deleted${detail ? ` from '${detail}'` : ''}`
    case 'VIEW_SAVED':         return `View '${objectName}' saved${detail ? ` in cube '${detail}'` : ''}`
    case 'VIEW_DELETED':       return `View '${objectName}' deleted${detail ? ` from cube '${detail}'` : ''}`
    case 'ELEMENT_ADDED':      return `Element '${objectName}' added${detail ? ` to '${detail}'` : ''}`
    case 'ELEMENT_DELETED':    return `Element '${objectName}' removed${detail ? ` from '${detail}'` : ''}`
    case 'ELEMENT_RENAMED':    return `Element renamed${detail ? ` in '${detail}'` : ''}`
    case 'ELEMENT_LINKED':     return `Element linked${detail ? ` — ${detail}` : ''}`
    case 'ATTRIBUTE_CREATED':  return `Attribute '${objectName}' added${detail ? ` to '${detail}'` : ''}`
    case 'ATTRIBUTE_DELETED':  return `Attribute '${objectName}' removed${detail ? ` from '${detail}'` : ''}`
    case 'ATTRIBUTE_VALUE_SET': return `Attribute value set — ${objectName}`
    case 'ASSERTION_ADDED':    return `Assertion '${objectName}' added`
    case 'ASSERTION_REMOVED':  return `Assertion '${objectName}' removed`
    case 'HIERARCHY_CREATED':  return `Hierarchy '${objectName}' created`
    case 'HIERARCHY_DELETED':  return `Hierarchy '${objectName}' deleted`
    case 'EDGE_REMOVED':       return `Parent relationship removed${detail ? ` in '${detail}'` : ''}`
    case 'PROCESS_RUN':        return `Process '${objectName}' run`
    default:                   return `${action.replace(/_/g, ' ').toLowerCase()} — ${objectName}`
  }
}

function fmtTime(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return ts }
}
function fmtDate(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) } catch { return ts }
}

// Group the entries the way a person reads them: cubes (with their views and
// rules), dimensions (with subsets), processes.
export function groupSessionEntries(entries) {
  const cubes = {}
  const dimensions = {}
  const processes = []
  for (const e of entries ?? []) {
    switch (e.object_type) {
      case 'view': {
        const cube = e.detail || '(unknown)'
        if (!cubes[cube]) cubes[cube] = { views: [], rules: [], cubeEntries: [] }
        cubes[cube].views.push(e)
        break
      }
      case 'rules': {
        if (!cubes[e.object_name]) cubes[e.object_name] = { views: [], rules: [], cubeEntries: [] }
        cubes[e.object_name].rules.push(e)
        break
      }
      case 'cube': {
        if (!cubes[e.object_name]) cubes[e.object_name] = { views: [], rules: [], cubeEntries: [] }
        cubes[e.object_name].cubeEntries.push(e)
        break
      }
      case 'subset': {
        const dim = e.detail || '(unknown)'
        if (!dimensions[dim]) dimensions[dim] = { subsets: [], entries: [] }
        dimensions[dim].subsets.push(e)
        break
      }
      case 'dimension': {
        const dim = e.detail || e.object_name
        if (!dimensions[dim]) dimensions[dim] = { subsets: [], entries: [] }
        dimensions[dim].entries.push(e)
        break
      }
      case 'process': {
        processes.push(e)
        break
      }
    }
  }
  return { cubes, dimensions, processes }
}

// The text a person can paste elsewhere.
export function buildSessionSummary({ session, entries, verboseLog = [] }) {
  const tree = groupSessionEntries(entries)
  const savesByKey = {}
  for (const e of verboseLog) {
    const key = `${e.object_type}::${e.object_name}::${e.action}`
    ;(savesByKey[key] ??= []).push(e)
  }

  const lines = []
  lines.push(`Change Set: ${session?.name ?? '(unnamed)'} — ${fmtDate(session?.started_at)}`)
  if (session?.description) lines.push(`Note: ${session.description}`)
  lines.push('─'.repeat(52))

  const writeEntries = (list, indent = 0) => {
    for (const e of list) {
      const saves = savesByKey[`${e.object_type}::${e.object_name}::${e.action}`] ?? []
      const suffix = saves.length > 1 ? ` (saved ${saves.length}x)` : ''
      lines.push(`${'  '.repeat(indent)}${fmtTime(e.timestamp)}  ${autoDescription(e.action, e.object_name, e.detail)}${suffix}`)
    }
  }

  for (const [cube, data] of Object.entries(tree.cubes)) {
    lines.push(`\n  ${cube}`)
    if (data.views.length) {
      lines.push(`    Views (${data.views.length})`)
      for (const e of data.views) lines.push(`      ${e.object_name}  ${fmtTime(e.timestamp)}`)
    }
    if (data.rules.length) writeEntries(data.rules, 3)
    if (data.cubeEntries.length) writeEntries(data.cubeEntries, 2)
  }

  for (const [dim, data] of Object.entries(tree.dimensions)) {
    lines.push(`\n  ${dim}`)
    if (data.subsets.length) {
      lines.push(`    Subsets (${data.subsets.length})`)
      for (const e of data.subsets) lines.push(`      ${e.object_name}  ${fmtTime(e.timestamp)}`)
    }
    writeEntries(data.entries, 2)
  }

  if (tree.processes.length) {
    lines.push(`\n  Processes (${tree.processes.length})`)
    writeEntries(tree.processes, 1)
  }

  lines.push(`\n${'─'.repeat(52)}`)
  lines.push(`${verboseLog.length} change${verboseLog.length !== 1 ? 's' : ''} total · ${(entries ?? []).length} objects`)
  return lines.join('\n')
}
