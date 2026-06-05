import { useRef, useMemo, useCallback, useEffect } from 'react'
import { useStore } from '@/store'
import { useCubeDimensions } from '@/hooks/useApi'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'
import { Download } from 'lucide-react'
import { toast } from 'sonner'

ModuleRegistry.registerModules([AllCommunityModule])

const lightTheme = themeBalham.withPart(colorSchemeLight).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })
const darkTheme  = themeBalham.withPart(colorSchemeDark).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })

function parseDimFromUniqueName(un) {
  return un?.match(/^\[([^\]]+)\]/)?.[1] ?? ''
}

function isConsolidatedType(t) {
  if (t == null) return false
  const s = String(t).toLowerCase().trim()
  return s === 'c' || s === '3' || s === 'consolidated' || s === 'cons' || t === 3 || t === '3' || (typeof t === 'string' && s.includes('cons'))
}

function parseCellset(data) {
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
      return c ? (c.FormattedValue ?? c.Value ?? '') : ''
    })
  )

  // Editable in the UI is based purely on the axis tuples: if every member on the row and col
  // for this cell is a leaf (not C), then the cell position is editable from the client point of view.
  // This is what an experienced TM1 dev expects for leaf elements.
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

function buildGridData(parsed) {
  if (!parsed) return { colDefs: [], rowData: [] }
  const { cols, rows, rowDimNames, grid, colIsConsolidated, rowIsConsolidated, cellUpdateable } = parsed
  const rowDimCount = rowDimNames.length || 1

  const rowColDefs = Array.from({ length: rowDimCount }, (_, i) => ({
    field: `__row_${i}__`,
    headerName: rowDimNames[i] ?? '',
    pinned: 'left',
    width: 160,
    minWidth: 60,
    resizable: true,
    editable: false,
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
      field: `c${i}`,
      headerName: c,
      width: 110,
      minWidth: 60,
      resizable: true,
      valueFormatter: p => (p.value === '' || p.value == null) ? '—' : String(p.value),
      cellStyle: p => {
        const ri = p.node.rowIndex ?? 0
        const updatable = cellUpdateable?.[ri]?.[i]
        const isLocked = updatable === false || (updatable == null && (colIsConsolidated[i] || (rowIsConsolidated[ri] ?? false)))
        if (isLocked) return { color: '#9ca3af', background: 'rgba(100,100,100,0.06)', fontStyle: 'italic' }
        if (p.value === '' || p.value == null) return { color: '#888' }
        return {}
      },
    })),
  ]

  const rowData = grid.map((row, ri) => {
    const obj = {}
    const members = rows[ri] ?? []
    Array.from({ length: rowDimCount }, (_, i) => { obj[`__row_${i}__`] = members[i] ?? '' })
    row.forEach((v, ci) => { obj[`c${ci}`] = v })
    return obj
  })

  return { colDefs, rowData }
}

async function writeCell(server, cube, coords, slicerCoords, value, cubeDimOrder = []) {
  let allDims
  if (cubeDimOrder && cubeDimOrder.length > 0) {
    const coordMap = new Map()
    ;[...(coords || []), ...(slicerCoords || [])].forEach(c => {
      if (c?.dim) coordMap.set(c.dim, c.name)
    })
    allDims = cubeDimOrder.map(dim => {
      const element = coordMap.get(dim)
      if (!element) {
        throw new Error(`Missing member for dimension "${dim}" — place all cube dimensions on rows, columns, or filter to enable writeback for this view`)
      }
      return { dim, element }
    })
  } else {
    allDims = [...(coords || []), ...(slicerCoords || [])].map(c => ({ dim: c.dim, element: c.name }))
  }
  // Always send the raw value from the editor (string for string cells, numeric-looking strings for numeric cells).
  // TM1 Update accepts string values for both numeric and string cells (it parses where needed).
  const res = await fetch('/api/cells/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server, cube, dims: allDims, value }),
  })
  const d = await res.json()
  if (!res.ok) throw new Error(d.error || 'Write failed')
  return d
}

export default function ResultGrid({ axes, cells, truncated, onReady, server, cube, slicerCoords, writable, dimOrder }) {
  const { dark } = useStore()
  const gridRef = useRef(null)
  const gridWrapRef = useRef(null)
  const writeMode = !!writable && !!server && !!cube
  const { data: fetched = [] } = useCubeDimensions(server, cube)
  const cubeDimOrder = useMemo(() => (dimOrder && dimOrder.length ? dimOrder : fetched) || [], [dimOrder, fetched])

  const colAxis = axes?.find(a => a.Ordinal === 0)
  const rowAxis = axes?.find(a => a.Ordinal === 1)
  const colTuples = colAxis?.Tuples ?? []
  const rowTuples = rowAxis?.Tuples ?? []

  const parsed = useMemo(() => {
    if (!axes?.length || !cells) return null
    return parseCellset({ Axes: axes, Cells: cells })
  }, [axes, cells])

  const { colDefs: baseColDefs, rowData } = useMemo(() => buildGridData(parsed), [parsed])

  // For loaded views (e.g. Default), the cellset may include title axes (Ordinal >1) with the fixed member.
  // Extract them as additional slicers so coverage and coords include them.
  const additionalSlicers = useMemo(() => {
    const sl = []
    if (axes) {
      axes.forEach(ax => {
        if ((ax.Ordinal ?? 0) > 1 && ax.Tuples && ax.Tuples.length > 0) {
          (ax.Tuples[0]?.Members ?? []).forEach(m => {
            const dim = parseDimFromUniqueName(m.UniqueName)
            if (dim) sl.push({ dim, name: m.Name })
          })
        }
      })
    }
    return sl
  }, [axes])

  const effectiveSlicers = useMemo(() => [...(slicerCoords || []), ...additionalSlicers], [slicerCoords, additionalSlicers])

  // Determine if the current result + slicers give us a full coordinate for every cube dimension.
  // This is required before we actually perform writes (otherwise we can't build a valid Tuple@odata.bind).
  // We compute it here (after parsed is declared) to avoid stale closure bugs.
  const providedDimSet = useMemo(() => {
    const s = new Set()
    if (parsed?.cellCoords?.length > 0) {
      // All cells share the same axis structure
      const sample = parsed.cellCoords[0]?.[0] ?? []
      sample.forEach(c => c?.dim && s.add(c.dim))
    }
    effectiveSlicers.forEach(c => c?.dim && s.add(c.dim))
    // Also scan all axes in the cellset (e.g. title/ordinal 2 for loaded views) for dims
    if (axes) {
      axes.forEach(ax => {
        (ax.Tuples ?? []).forEach(t => {
          (t.Members ?? []).forEach(m => {
            const d = parseDimFromUniqueName(m.UniqueName)
            if (d) s.add(d)
          })
        })
      })
    }
    return s
  }, [parsed, effectiveSlicers, axes])

  const hasFullCoverage = cubeDimOrder.length > 0 && cubeDimOrder.every(dim => providedDimSet.has(dim))
  const canWrite = useMemo(() => writeMode && hasFullCoverage, [writeMode, hasFullCoverage])

  const colDefs = useMemo(() => {
    if (!writeMode) return baseColDefs
    return baseColDefs.map(cd => {
      if (cd.field?.startsWith('__row_')) return cd
      const ci = parseInt(cd.field?.slice(1) ?? '-1')
      return {
        ...cd,
        editable: (p) => {
          const ri = p.node?.rowIndex ?? 0
          return parsed?.cellUpdateable?.[ri]?.[ci] ?? false
        },
        singleClickEdit: true,
        cellEditor: 'agTextCellEditor',
        cellStyle: (p) => {
          const baseStyle = typeof cd.cellStyle === 'function' ? cd.cellStyle(p) : {};
          const ri = p.node?.rowIndex ?? 0;
          const updatable = parsed?.cellUpdateable?.[ri]?.[ci] ?? false;
          if (writeMode && updatable && !hasFullCoverage) {
            return {
              ...baseStyle,
              background: 'rgba(234, 179, 8, 0.08)',
              borderLeft: '2px solid #ca8a04',
            };
          }
          return baseStyle;
        },
      }
    })
  }, [baseColDefs, writeMode, parsed, hasFullCoverage])

  const handleExportCSV = () => gridRef.current?.api?.exportDataAsCsv()

  const handleCellValueChanged = useCallback(async (p) => {
    if (!writeMode || !server || !cube) return
    const field = p.colDef?.field ?? ''
    const ci = field.startsWith('c') ? parseInt(field.slice(1)) : -1
    const ri = p.node?.rowIndex ?? 0
    if (ci < 0 || !parsed?.cellCoords?.[ri]?.[ci]) return
    const cellUpdatable = parsed.cellUpdateable?.[ri]?.[ci] ?? false
    if (!cellUpdatable) { toast.error('Cannot write to consolidated or rules-calculated cell'); return }
    if (!canWrite) {
      toast.error('This view does not specify all cube dimensions — place every dimension on rows, columns, or filter (with a member) then Refresh to enable writeback')
      // revert since we cannot complete the write
      try {
        const f = p.colDef?.field
        if (p.node && f != null) {
          const d = { ...p.node.data, [f]: p.oldValue }
          p.node.setData(d)
        }
      } catch {
        /* ignore revert failures */
      }
      return
    }
    try {
      await writeCell(server, cube, parsed.cellCoords[ri][ci], effectiveSlicers, p.newValue, cubeDimOrder)
    } catch (e) {
      toast.error(e.message)
      // revert the local change in the grid since server did not accept it
      try {
        const f = p.colDef?.field
        if (p.node && f != null) {
          const d = { ...p.node.data, [f]: p.oldValue }
          p.node.setData(d)
        }
      } catch {
        /* ignore revert failures */
      }
    }
  }, [writeMode, canWrite, server, cube, parsed, effectiveSlicers, cubeDimOrder])

  const handlePaste = useCallback(async (e) => {
    if (!writeMode || !server || !cube || !parsed) return
    const text = e.clipboardData?.getData('text/plain'); if (!text?.trim()) return
    e.preventDefault()

    const grid = gridRef.current?.api
    const focusedCell = grid?.getFocusedCell()
    if (!focusedCell) return

    const startRow = focusedCell.rowIndex ?? 0
    // Use colDef.field for consistency (colId may differ in some ag-grid configs)
    const startCol = focusedCell.column
    const startColDef = startCol?.getColDef ? startCol.getColDef() : (startCol?.colDef ?? {})
    const startColField = startColDef.field ?? startCol?.getColId?.() ?? ''
    const allCols = grid.getColumnDefs?.() ?? colDefs
    const dataCols = allCols.filter(cd => !cd.field?.startsWith('__row_')).map(cd => cd.field)
    const startColIdx = dataCols.indexOf(startColField)
    if (startColIdx < 0) return

    const pasteRows = text.trim().split(/\r?\n/).map(r => r.split('\t'))
    const writes = []
    const updates = []

    for (let dr = 0; dr < pasteRows.length; dr++) {
      for (let dc = 0; dc < pasteRows[dr].length; dc++) {
        const ri = startRow + dr
        const ci = startColIdx + dc
        if (ri >= rowData.length || ci >= dataCols.length) continue
        const cellUpdatable = parsed.cellUpdateable?.[ri]?.[ci] ?? false
        if (!cellUpdatable) continue
        const coords = parsed.cellCoords?.[ri]?.[ci]
        if (!coords) continue
        const value = pasteRows[dr][dc]
        writes.push({ coords, value, ri, ci, field: dataCols[ci] })
        updates.push({ rowIndex: ri, field: dataCols[ci], value })
      }
    }

    if (!writes.length) { toast.error('No writable cells in paste range'); return }

    // Optimistic update
    const toastId = toast.loading(`Writing ${writes.length} cell(s)…`)
    try {
      await Promise.all(writes.map(w => writeCell(server, cube, w.coords, effectiveSlicers, w.value, cubeDimOrder)))
      // Update grid display
      updates.forEach(u => {
        const node = grid.getDisplayedRowAtIndex(u.rowIndex)
        if (node) { const d = { ...node.data, [u.field]: u.value }; node.setData(d) }
      })
      toast.success(`${writes.length} cell(s) written`, { id: toastId })
    } catch (e) { toast.error(e.message, { id: toastId }) }
  }, [writeMode, server, cube, parsed, rowData, colDefs, effectiveSlicers, cubeDimOrder])

  // Attach paste listener in capture phase on the grid wrapper so paste is reliably
  // intercepted for writeback even when ag-grid internals are focused.
  useEffect(() => {
    const el = gridWrapRef.current
    if (!el || !writeMode) return
    const capturePaste = (e) => {
      handlePaste(e)
    }
    el.addEventListener('paste', capturePaste, true)
    return () => el.removeEventListener('paste', capturePaste, true)
  }, [writeMode, handlePaste])

  return (
    <div ref={gridWrapRef} className="flex flex-col h-full min-h-0">
      {truncated && (
        <div className="px-3 py-1 text-[10px] text-yellow-500 bg-yellow-500/10 border-b border-border shrink-0">
          Results capped at 50,000 cells — refine your query to see all data
        </div>
      )}
      <div className="text-[10px] text-muted-foreground px-3 py-1 border-b border-border shrink-0 flex items-center justify-between gap-2">
        <span>
          {colTuples.length} col{colTuples.length !== 1 ? 's' : ''} × {Math.max(rowTuples.length, 1)} row{Math.max(rowTuples.length, 1) !== 1 ? 's' : ''}
          {'  ·  '}{cells.length} cell{cells.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1.5">
          {writable && !hasFullCoverage && (
            <span className="text-[10px] text-amber-500">This view does not specify all cube dimensions — place every dimension on rows, columns or filter (with a member) then Refresh to enable editing</span>
          )}
          {writable && hasFullCoverage && (
            <span className="text-[10px] text-muted-foreground/60">Grey cells are consolidated or rules — read only</span>
          )}
          {colDefs.length > 0 && (
            <button onClick={handleExportCSV}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border hover:bg-muted transition-colors">
              <Download size={10} /> CSV
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {colDefs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs select-none">No data returned</div>
        ) : (
          <AgGridReact
            ref={gridRef}
            theme={dark ? darkTheme : lightTheme}
            columnDefs={colDefs}
            rowData={rowData}
            suppressMovableColumns
            enableCellTextSelection={!writeMode}
            singleClickEdit={writeMode}
            suppressClipboardPaste={writeMode}
            stopEditingWhenCellsLoseFocus
            defaultColDef={{ sortable: false }}
            onCellValueChanged={handleCellValueChanged}
            onFirstDataRendered={(p) => { p.api.autoSizeAllColumns(); onReady?.(p.api) }}
          />
        )}
      </div>
    </div>
  )
}
