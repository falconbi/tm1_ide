/**
 * view-cellset — pure helpers for turning a TM1 cellset into the View editor's
 * hierarchy/flat grid data. Extracted from ViewEditor so they're testable and
 * reusable. No React; relative imports only (no @/ alias) so node can run them.
 */
import { parseDimFromUniqueName } from './cellset.js'
import { stripTm1TypePrefix, applyTm1Format } from './tm1-rule-parser.js'
import { tm1NumericComparator } from './utils.js'

export function elementFromUniqueName(un) {
  return un?.match(/\[([^\]]+)\]$/)?.[1] ?? ''
}

export function lookupFormat(dim, elem, formatMap) {
  if (!elem) return null
  const scoped = formatMap[dim]?.[elem]
  if (scoped) return scoped
  for (const d of Object.keys(formatMap)) {
    const f = formatMap[d]?.[elem]
    if (f && typeof f === 'string') return f
  }
  return null
}

export function cellsetToHierarchyData(cellset, formatMap = {}, pageMembers = [], suppressZeros = 'none', useFormat = true) {
  if (!cellset?.Axes?.length) return null
  const colAxis = cellset.Axes.find(a => a.Ordinal === 0)
  const rowAxis = cellset.Axes.find(a => a.Ordinal === 1)
  if (!colAxis) return null

  const colTuples = colAxis.Tuples ?? []
  const rowTuples = rowAxis?.Tuples ?? []

  // Include members array so HierarchyGrid can build tuple keys for multi-dim cols
  let columns = colTuples.map((t, i) => ({
    id:      `c${i}`,
    label:   (t.Members ?? []).map(m => m.Name).join(' / '),
    members: (t.Members ?? []).map(m => m.Name),
  }))

  const cellMap = {}
  ;(cellset.Cells ?? []).forEach(c => { cellMap[c.Ordinal] = c })

  const isValEmpty = v => {
    if (v == null || v === 0) return true
    if (typeof v === 'string') {
      const t = v.trim()
      if (t === '') return true
      if (!isNaN(Number(t)) && Number(t) === 0) return true
    }
    return false
  }

  const supRows = suppressZeros === 'rows' || suppressZeros === 'all' || suppressZeros === true
  const supCols = suppressZeros === 'columns' || suppressZeros === 'all'

  const data = {}
  const colHasData = {}
  rowTuples.forEach((tuple, ri) => {
    const tupleKey = (tuple.Members ?? []).map(m => m.Name).join('::')
    if (!tupleKey) return

    if (supRows) {
      const cellsThisRow = columns.map((_, ci) => cellMap[ri * columns.length + ci])
      const allZero = cellsThisRow.every(c => isValEmpty(c?.Value))
      if (allZero) return
    }

    if (!data[tupleKey]) data[tupleKey] = {}
    columns.forEach((col, ci) => {
      const cell = cellMap[ri * columns.length + ci]
      if (!isValEmpty(cell?.Value)) colHasData[col.id] = true
      const colTuple = colTuples[ci]
      const colMembers = (colTuple?.Members ?? []).map(m => ({ dim: parseDimFromUniqueName(m.UniqueName), elem: elementFromUniqueName(m.UniqueName) || m.Name }))
      const rowMembers = (tuple?.Members ?? []).map(m => ({ dim: parseDimFromUniqueName(m.UniqueName), elem: elementFromUniqueName(m.UniqueName) || m.Name }))
      const allMembers = [...rowMembers, ...colMembers]
      let fmt = null
      for (const m of allMembers) {
        fmt = lookupFormat(m.dim, m.elem, formatMap)
        if (fmt) break
      }
      if (!fmt) {
        for (const p of pageMembers) {
          for (const d of Object.keys(formatMap)) {
            const f = formatMap[d]?.[p]
            if (f && typeof f === 'string') { fmt = f; break }
          }
          if (fmt) break
        }
      }
      const rawVal = cell?.Value
      const fv = cell?.FormattedValue
      // TM1 often returns Value:null with FormattedValue:"0.00" for zero cells —
      // derive a number so the format string is still applied (else 0 shows "0.00").
      const numVal = rawVal != null
        ? rawVal
        : (fv != null && fv !== '' && !Number.isNaN(Number(stripTm1TypePrefix(fv))) ? Number(stripTm1TypePrefix(fv)) : null)
      let display
      if (fmt && numVal != null) {
        display = useFormat ? applyTm1Format(numVal, fmt) : String(numVal)
      } else if (useFormat && fv != null && fv !== '') {
        display = stripTm1TypePrefix(fv)
      } else {
        display = rawVal ?? null
      }
      data[tupleKey][col.id] = display
      data[tupleKey][`${col.id}__u`] = cell?.Updateable ?? 1
      if (fmt?.startsWith('@')) {
        data[tupleKey][`${col.id}__fmt`] = '@'
        const colour = fmt.slice(1).trim()
        if (colour) data[tupleKey][`${col.id}__colour`] = colour
      }
    })
  })

  if (supCols && Object.keys(data).length) {
    const emptyColIds = columns.filter(col => !colHasData[col.id]).map(col => col.id)
    if (emptyColIds.length) {
      for (const key of Object.keys(data)) {
        for (const cid of emptyColIds) delete data[key][cid]
      }
      columns = columns.filter(c => !emptyColIds.includes(c.id))
    }
  }

  return { columns, data }
}

export function parseCellset(data, formatMap = {}, pageMembers = [], useFormat = true) {
  if (!data?.Axes?.length) return null
  const colAx = data.Axes.find(a => a.Ordinal === 0)
  const rowAx = data.Axes.find(a => a.Ordinal === 1)
  if (!colAx) return null

  const colTuples = colAx.Tuples ?? []
  const rowTuples = rowAx ? (rowAx.Tuples ?? []) : []

  const cols = colTuples.map(t => (t.Members ?? []).map(m => m.Name).join(' / '))
  const rowDimNames = (rowTuples[0]?.Members ?? []).map(m => parseDimFromUniqueName(m.UniqueName))
  const rows = rowTuples.map(t => (t.Members ?? []).map(m => m.Name))

  const numCols = cols.length
  const cellMap = {}
  ;(data.Cells ?? []).forEach(c => { cellMap[c.Ordinal] = c })

  const grid = (rows.length ? rows : [[]]).map((_, ri) =>
    colTuples.map((tuple, ci) => {
      const c = cellMap[ri * numCols + ci]
      if (!c) return ''
      // Look up the format via each member's dimension (formatMap is nested
      // {dim: {elem: fmt}}); check both row and column members.
      const colMembers = (tuple.Members ?? []).map(m => ({ dim: parseDimFromUniqueName(m.UniqueName), elem: elementFromUniqueName(m.UniqueName) || m.Name }))
      const rowMembers = (rowTuples[ri]?.Members ?? []).map(m => ({ dim: parseDimFromUniqueName(m.UniqueName), elem: elementFromUniqueName(m.UniqueName) || m.Name }))
      let fmt = null
      for (const m of [...rowMembers, ...colMembers]) { fmt = lookupFormat(m.dim, m.elem, formatMap); if (fmt) break }
      if (!fmt) {
        for (const p of pageMembers) {
          for (const d of Object.keys(formatMap)) {
            const f = formatMap[d]?.[p]
            if (f && typeof f === 'string') { fmt = f; break }
          }
          if (fmt) break
        }
      }
      if (fmt) {
        const fv = c.FormattedValue
        // Value may be null with FormattedValue "0.00" for zero cells — derive a number
        const num = c.Value != null
          ? c.Value
          : (fv != null && fv !== '' && !Number.isNaN(Number(stripTm1TypePrefix(fv))) ? Number(stripTm1TypePrefix(fv)) : c.Value)
        return num != null ? (useFormat ? applyTm1Format(num, fmt) : String(num)) : ''
      }
      const fv = c.FormattedValue
      if (useFormat && fv !== '' && fv != null) return stripTm1TypePrefix(fv)
      const v = c.Value
      return v != null ? String(v) : ''
    })
  )

  return { cols, rows, rowDimNames, grid }
}

export function buildGridData(parsed) {
  if (!parsed) return { colDefs: [], rowData: [] }
  const { cols, rows, rowDimNames, grid } = parsed
  const rowDimCount = rowDimNames.length || 1

  const rowColDefs = Array.from({ length: rowDimCount }, (_, i) => ({
    field: `__row_${i}__`,
    headerName: rowDimNames[i] ?? '',
    pinned: 'left',
    width: 160,
    minWidth: 60,
    resizable: true,
    cellStyle: (params) => {
      if (i < rowDimCount - 1 && params.node.rowIndex > 0) {
        const prev = params.api.getDisplayedRowAtIndex(params.node.rowIndex - 1)?.data?.[`__row_${i}__`]
        if (prev === params.value) return { fontWeight: 600, color: 'var(--ag-row-border-color, #ccc)' }
      }
      return { fontWeight: 600 }
    },
  }))

  const colDefs = [
    ...rowColDefs,
    ...cols.map((c, i) => ({
      field: `c${i}`, headerName: c, width: 110, minWidth: 60, resizable: true,
      comparator: tm1NumericComparator,
      valueFormatter: p => (p.value === '' || p.value == null) ? '—' : String(p.value),
      cellStyle: p => (p.value === '' || p.value == null) ? { color: '#888' } : {},
    })),
  ]

  const rowData = grid.map((row, ri) => {
    const obj = { __ri__: ri, __tupleKey__: (rows[ri] ?? []).join('::') }
    const members = rows[ri] ?? []
    Array.from({ length: rowDimCount }, (_, i) => { obj[`__row_${i}__`] = members[i] ?? '' })
    row.forEach((v, ci) => { obj[`c${ci}`] = v })
    return obj
  })

  return { colDefs, rowData }
}