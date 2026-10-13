// ── Lens.rows — a TM1 cellset as tidy rows ────────────────────────────────────
// The one data helper every building block uses. Input: an execMDX result
// ({ Axes: [{ Tuples: [{ Members: [{ Name, UniqueName }] }] }], Cells: [{ Ordinal, Value }] }).
// Output: one object per row tuple —
//   { _label: 'East Region', _members: ['East Region'], organization: 'East Region',
//     'Y2 / Actual': 123, ... }
// Columns are labelled by their member names joined with ' / '. A one-axis
// result becomes a single row. Missing cells are null. When the result says
// which cells TM1 calculates (rule or consolidation), each row also carries
// _input: { [column label]: true when the cell can be typed into }.

// '[organization].[organization].[100]' → 'organization'
function dimOf(member, i) {
  const u = member && member.UniqueName
  const m = typeof u === 'string' ? /^\[([^\]]+)\]/.exec(u) : null
  return m ? m[1] : 'dim' + (i + 1)
}

export function rows(cellset) {
  const axes = (cellset && cellset.Axes) || []
  const cells = (cellset && cellset.Cells) || []
  const colTuples = (axes[0] && axes[0].Tuples) || []
  const rowTuples = (axes[1] && axes[1].Tuples) || []
  const colLabels = colTuples.map(t => (t.Members || []).map(m => m.Name).join(' / '))
  const nCols = colLabels.length
  const byOrdinal = new Map(cells.map(c => [c.Ordinal, c.Value === undefined ? null : c.Value]))
  const valueAt = ord => (byOrdinal.has(ord) ? byOrdinal.get(ord) : null)
  const flags = cells.some(c => 'RuleDerived' in c || 'Consolidated' in c)
    ? new Map(cells.map(c => [c.Ordinal, !(c.RuleDerived || c.Consolidated)])) : null
  const addInput = (row, base) => {
    if (!flags) return row
    row._input = {}
    colLabels.forEach((label, c) => { row._input[label] = flags.get(base + c) === true })
    return row
  }

  if (!rowTuples.length) {
    if (!nCols) return []
    const one = { _label: '', _members: [] }
    colLabels.forEach((label, c) => { one[label] = valueAt(c) })
    return [addInput(one, 0)]
  }
  return rowTuples.map((t, r) => {
    const members = t.Members || []
    const row = { _label: members.map(m => m.Name).join(' / '), _members: members.map(m => m.Name) }
    members.forEach((m, i) => { row[dimOf(m, i)] = m.Name })
    colLabels.forEach((label, c) => { row[label] = valueAt(r * nCols + c) })
    return addInput(row, r * nCols)
  })
}

// Number formats shared by every component.
export function format(value, kind = 'number') {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—'
  const v = Number(value)
  const sign = v < 0 ? '−' : ''
  const a = Math.abs(v)
  switch (kind) {
    case 'k$': return sign + '$' + (a / 1000).toLocaleString(undefined, { maximumFractionDigits: a < 100000 ? 1 : 0 }) + 'k'
    case '$': return sign + '$' + a.toLocaleString(undefined, { maximumFractionDigits: 0 })
    case '%': return sign + (a * 100).toFixed(1) + '%'
    case 'pct-points': return sign + a.toFixed(1) + '%'
    default: return sign + a.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
}

// Variance helper: is `actual` better than `compare`? Costs are better when lower.
export function better(actual, compare, { cost = false } = {}) {
  const d = Number(actual) - Number(compare)
  return cost ? d <= 0 : d >= 0
}

// A UTC time from TM1 ('2026-10-13T01:33:00Z') in the viewer's own time zone:
// today → '2:33 pm', another day → '13 Oct, 2:33 pm'. Blank or unreadable → ''.
export function localTime(utc, now = new Date()) {
  const d = new Date(String(utc || ''))
  if (!utc || Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === now.toDateString() ? time : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + time
}
