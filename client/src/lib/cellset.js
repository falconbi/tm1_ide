/**
 * cellset — pure helpers for turning a TM1 cellset (from ExecuteMDX / view
 * execution) into flat grid data. Extracted from ResultGrid so they're
 * unit-testable and shared. No React, no aliased imports.
 */

export function parseDimFromUniqueName(un) {
  return un?.match(/^\[([^\]]+)\]/)?.[1] ?? ''
}

export function isConsolidatedType(t) {
  if (t == null) return false
  const s = String(t).toLowerCase().trim()
  return s === 'c' || s === '3' || s === 'consolidated' || s === 'cons' || t === 3 || t === '3' || (typeof t === 'string' && s.includes('cons'))
}

export function parseCellset(data, useFormat = true) {
  if (!data?.Axes?.length) return null
  const colAx = data.Axes.find(a => a.Ordinal === 0)
  const rowAx = data.Axes.find(a => a.Ordinal === 1)
  if (!colAx) return null

  const colTuples = colAx.Tuples ?? []
  const rowTuples = rowAx ? (rowAx.Tuples ?? []) : []

  const cols = colTuples.map(t => (t.Members ?? []).map(m => m.Name).join(' / '))
  const rowDimNames = (rowTuples[0]?.Members ?? []).map(m => parseDimFromUniqueName(m.UniqueName))
  const rows = rowTuples.map(t => (t.Members ?? []).map(m => m.Name))

  // Extract dim names from column tuples
  const colDimNames = (colTuples[0]?.Members ?? []).map(m => parseDimFromUniqueName(m.UniqueName))

  // Per-col: is any member a consolidation?
  const colIsConsolidated = colTuples.map(t =>
    (t.Members ?? []).some(m => isConsolidatedType(m.Type))
  )
  // Per-row: is any member a consolidation?
  const rowIsConsolidated = rowTuples.map(t =>
    (t.Members ?? []).some(m => isConsolidatedType(m.Type))
  )

  const numCols = cols.length
  const cellMap = {}
  ;(data.Cells ?? []).forEach(c => { cellMap[c.Ordinal] = c })

  const grid = (rows.length ? rows : [[]]).map((_, ri) =>
    cols.map((_, ci) => {
      const c = cellMap[ri * numCols + ci]
      if (!c) return ''
      // numFormat on → TM1's FormattedValue; off → the raw server Value
      return useFormat ? (c.FormattedValue ?? c.Value ?? '') : (c.Value ?? c.FormattedValue ?? '')
    })
  )

  // Editable in the UI is based purely on the axis tuples: if every member on the row and col
  // for this cell is a leaf (not C), then the cell position is editable from the client point of view.
  // We do not second-guess with the Updateable bitmask here (it can have other bits or be
  // conservative for certain execute paths / string cells / views). If the write actually fails
  // TM1 will return a real error which we show as a toast + revert the cell.
  const cellUpdateable = (rows.length ? rows : [[]]).map((_, ri) =>
    cols.map((_, ci) => {
      return !(colIsConsolidated[ci] || (rowIsConsolidated[ri] ?? false))
    })
  )

  // Full member coords per cell for writeback
  const cellCoords = (rows.length ? rows : [[]]).map((_, ri) =>
    cols.map((_, ci) => {
      const rowMembers = (rowTuples[ri]?.Members ?? []).map(m => ({
        dim: parseDimFromUniqueName(m.UniqueName), name: m.Name
      }))
      const colMembers = (colTuples[ci]?.Members ?? []).map(m => ({
        dim: parseDimFromUniqueName(m.UniqueName), name: m.Name
      }))
      return [...rowMembers, ...colMembers]
    })
  )

  return { cols, rows, rowDimNames, colDimNames, grid, cellCoords, cellUpdateable, colIsConsolidated, rowIsConsolidated }
}