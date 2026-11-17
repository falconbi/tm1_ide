import { useEffect, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { Check, Loader2, Plus, Upload } from 'lucide-react'
import { useStore } from '@/store'
import { useBulkDimImport } from '@/hooks/useApi'
import { parseTabDelimited } from '@/lib/dimension-editor/structure'
import { darkTheme, lightTheme } from './agGrid'

// ── Structure Grid (Element / Parent / Weight bulk editor) ────────────────────
export default function StructureGrid({ tab, elements, edges, hierarchy, onApplied }) {
  const dark = useStore(s => s.dark)
  const bulkImport = useBulkDimImport()
  const fileRef = useRef(null)
  const gridRef = useRef(null)

  // Initialise rows from existing elements + edges
  const initRows = useMemo(() => {
    if (!elements.length) return [{ name: '', type: 'N', parent: '', weight: 1 }]
    const edgeMap = {}
    edges.forEach(e => { if (!edgeMap[e.ComponentName]) edgeMap[e.ComponentName] = []; edgeMap[e.ComponentName].push({ parent: e.ParentName, weight: e.Weight ?? 1 }) })
    const rows = []
    elements.forEach(el => {
      const parents = edgeMap[el.Name] ?? [null]
      parents.forEach(p => rows.push({ name: el.Name, type: el.Type ?? 'N', parent: p?.parent ?? '', weight: p?.weight ?? 1 }))
    })
    return rows
  }, [elements, edges])

  const [rows, setRows] = useState(initRows)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => { setRows(initRows) }, [elements.length, edges.length])

  const colDefs = useMemo(() => [
    { field: 'name',   headerName: 'Element',  flex: 2, editable: true, cellStyle: { fontFamily: 'monospace' } },
    { field: 'type',   headerName: 'Type',     width: 80, editable: true, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['N', 'S', 'C'] },
      cellStyle: p => ({ color: p.value === 'C' ? '#f59e0b' : p.value === 'S' ? '#34d399' : '#60a5fa' }) },
    { field: 'parent', headerName: 'Parent',   flex: 2, editable: true, cellStyle: { fontFamily: 'monospace', color: '#9ca3af' } },
    { field: 'weight', headerName: 'Weight',   width: 80, editable: true, type: 'numericColumn' },
    { headerName: '', width: 36, pinned: 'right', cellRenderer: p => (
      <button onClick={() => setRows(r => r.filter((_, i) => i !== p.node.rowIndex))}
        className="text-muted-foreground hover:text-red-400 transition-colors px-1">×</button>
    )},
  ], [])

  const handlePaste = (e) => {
    const text = e.clipboardData?.getData('text/plain')
    if (!text) return
    const parsed = parseTabDelimited(text)
    if (!parsed.length) return
    e.preventDefault()
    setRows(r => [...r, ...parsed])
    setResult(null)
  }

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const parsed = parseTabDelimited(ev.target.result)
      setRows(r => [...r, ...parsed])
      setResult(null)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleApply = async () => {
    const validRows = rows.filter(r => r.name.trim())
    if (!validRows.length) return
    setApplying(true); setResult(null)
    try {
      const res = await bulkImport.mutateAsync({ server: tab.server, dimension: tab.dimension, hierarchy, rows: validRows })
      setResult(res.errors?.length ? `Applied with ${res.errors.length} error(s): ${res.errors[0]}` : `Applied ${validRows.length} row(s) successfully`)
      onApplied?.()
    } catch (e) { setResult(`Error: ${e.message}`) }
    finally { setApplying(false) }
  }

  return (
    <div className="flex flex-col h-full" onPaste={handlePaste}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/20 shrink-0 flex-wrap">
        <span className="text-xs text-muted-foreground">Paste from Excel (Name · Type · Parent · Weight) or upload CSV</span>
        <div className="flex-1" />
        <button onClick={() => setRows(r => [...r, { name: '', type: 'N', parent: '', weight: 1 }])}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors">
          <Plus size={10} /> Row
        </button>
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors">
          <Upload size={10} /> CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
        <button onClick={() => { setRows([]); setResult(null) }}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted transition-colors">
          Clear
        </button>
        <button onClick={handleApply} disabled={applying || !rows.some(r => r.name.trim())}
          className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity">
          {applying ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Apply to TM1
        </button>
      </div>
      {result && (
        <div className={`px-3 py-1.5 text-xs border-b border-border shrink-0 ${result.includes('Error') || result.includes('error') ? 'text-red-400 bg-red-950/20' : 'text-emerald-400 bg-emerald-950/20'}`}>
          {result}
        </div>
      )}
      {/* Grid */}
      <div className="flex-1 min-h-0">
        <AgGridReact
          ref={gridRef}
          theme={dark ? darkTheme : lightTheme}
          columnDefs={colDefs}
          rowData={rows}
          onCellValueChanged={p => setRows(r => r.map((row, i) => i === p.node.rowIndex ? { ...row, [p.column.colId]: p.newValue } : row))}
          defaultColDef={{ resizable: true }}
          stopEditingWhenCellsLoseFocus
        />
      </div>
    </div>
  )
}
