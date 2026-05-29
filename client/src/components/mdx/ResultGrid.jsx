import { useRef, useMemo } from 'react'
import { useStore } from '@/store'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'
import { Download } from 'lucide-react'

ModuleRegistry.registerModules([AllCommunityModule])

const lightTheme = themeBalham.withPart(colorSchemeLight).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })
const darkTheme  = themeBalham.withPart(colorSchemeDark).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })

function parseDimFromUniqueName(un) {
  return un?.match(/^\[([^\]]+)\]/)?.[1] ?? ''
}

export function parseCellset(data) {
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
    cols.map((_, ci) => {
      const c = cellMap[ri * numCols + ci]
      return c ? (c.FormattedValue ?? c.Value ?? '') : ''
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
      field: `c${i}`, headerName: c, width: 110, minWidth: 60, resizable: true, type: 'numericColumn',
      valueFormatter: p => (p.value === '' || p.value == null) ? '—' : String(p.value),
      cellStyle: p => (p.value === '' || p.value == null) ? { color: '#888' } : {},
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

export default function ResultGrid({ axes, cells, truncated, onReady }) {
  const { dark } = useStore()
  const gridRef = useRef(null)

  const colAxis = axes?.find(a => a.Ordinal === 0)
  const rowAxis = axes?.find(a => a.Ordinal === 1)
  const colTuples = colAxis?.Tuples ?? []
  const rowTuples = rowAxis?.Tuples ?? []

  const parsed = useMemo(() => {
    if (!axes?.length || !cells) return null
    return parseCellset({ Axes: axes, Cells: cells })
  }, [axes, cells])

  const { colDefs, rowData } = useMemo(() => buildGridData(parsed), [parsed])

  const handleExportCSV = () => {
    gridRef.current?.api?.exportDataAsCsv()
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {truncated && (
        <div className="px-3 py-1 text-[10px] text-yellow-500 bg-yellow-500/10 border-b border-border shrink-0">
          Results capped at 50,000 cells — refine your query to see all data
        </div>
      )}
      <div className="text-[10px] text-muted-foreground px-3 py-1 border-b border-border shrink-0 flex items-center justify-between">
        <span>
          {colTuples.length} col{colTuples.length !== 1 ? 's' : ''} × {Math.max(rowTuples.length, 1)} row{Math.max(rowTuples.length, 1) !== 1 ? 's' : ''}
          {'  •  '}{cells.length} cell{cells.length !== 1 ? 's' : ''}
        </span>
        {colDefs.length > 0 && (
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border hover:bg-muted transition-colors"
            title="Export visible results as CSV"
          >
            <Download size={10} /> CSV
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {colDefs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs select-none">
            No data returned
          </div>
        ) : (
          <AgGridReact
            ref={gridRef}
            theme={dark ? darkTheme : lightTheme}
            columnDefs={colDefs}
            rowData={rowData}
            suppressMovableColumns
            enableCellTextSelection
            defaultColDef={{ sortable: false }}
            onFirstDataRendered={(p) => {
              p.api.autoSizeAllColumns()
              onReady?.(p.api)
            }}
          />
        )}
      </div>
    </div>
  )
}
