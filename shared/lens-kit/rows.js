// ── Lens.rows — a TM1 cellset as tidy rows ────────────────────────────────────
// The one data helper every building block uses. Input: an execMDX result
// ({ Axes: [{ Tuples: [{ Members: [{ Name, UniqueName }] }] }], Cells: [{ Ordinal, Value }] }).
// Output: one object per row tuple —
//   { _label: 'East Region', _members: ['East Region'], organization: 'East Region',
//     'Y2 / Actual': 123, ... }
// Columns are labelled by their member names joined with ' / '. A one-axis
// result becomes a single row. Missing cells are null.

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

  if (!rowTuples.length) {
    if (!nCols) return []
    const one = { _label: '', _members: [] }
    colLabels.forEach((label, c) => { one[label] = valueAt(c) })
    return [one]
  }
  return rowTuples.map((t, r) => {
    const members = t.Members || []
    const row = { _label: members.map(m => m.Name).join(' / '), _members: members.map(m => m.Name) }
    members.forEach((m, i) => { row[dimOf(m, i)] = m.Name })
    colLabels.forEach((label, c) => { row[label] = valueAt(r * nCols + c) })
    return row
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
