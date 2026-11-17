import { useCallback, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { Loader2, Plus, Upload, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { post } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAttrGrid, useWriteElementAttribute, useCreateAttrDef, useDeleteAttrDef, useBulkAttrImport } from '@/hooks/useApi'
import { buildTreeOrder } from '@/lib/dimension-editor/tree'
import { TYPE_ICON, TYPE_COLOR, COLOUR_HEX, TM1_FORMAT_PRESETS } from '@/lib/dimension-editor/constants'
import { ATTR_DEFAULT_COL, darkTheme, lightTheme } from '../agGrid'
import AttrHeader from './AttrHeader'
import NewAttrModal from './NewAttrModal'

const NO_ATTRS = []
const ATTR_WIDTHS_KEY = 'tm1-attr-widths'

export default function AttrGrid({ tab, elements, edges, hierarchy, search = '', indexMap = null }) {
  const dark      = useStore(s => s.dark)
  const [newAttr, setNewAttr]   = useState(false)
  const [formatPicker, setFormatPicker] = useState(null) // { element, value }
  const attrFileRef             = useRef(null)

  const { data: grid, isLoading, refetch } = useAttrGrid(tab.server, tab.dimension, hierarchy)
  const writeAttr                          = useWriteElementAttribute()
  const createAttr                         = useCreateAttrDef()
  const deleteAttr                         = useDeleteAttrDef()
  const bulkAttrImport                     = useBulkAttrImport()

  const handleCreateAttr = useCallback((name, type) => {
    setNewAttr(false)
    createAttr.mutate(
      { server: tab.server, dimension: tab.dimension, name, type, hierarchy },
      { onSuccess: () => refetch() }
    )
  }, [createAttr, tab, refetch, hierarchy])

  const handleDeleteAttr = useCallback((name) => {
    if (!window.confirm(`Delete attribute "${name}" and all its values?`)) return
    deleteAttr.mutate(
      { server: tab.server, dimension: tab.dimension, name, hierarchy },
      { onSuccess: () => refetch() }
    )
  }, [deleteAttr.mutate, tab, refetch, hierarchy])

  const handleConvertToAlias = useCallback(async (attrName) => {
    if (!window.confirm(`Convert "${attrName}" from String to Alias type?\n\nAll values will be preserved.`)) return
    try {
      const d = await post('/api/dimension/attribute/convert-to-alias', { server: tab.server, dimension: tab.dimension, attribute: attrName, hierarchy })
      toast.success(`Converted ${attrName} to Alias — ${d.converted} values preserved`)
      refetch()
    } catch (e) {
      toast.error(`Convert to Alias failed: ${e.message}`)
    }
  }, [tab, hierarchy, refetch])

  const attrs = grid?.attrs ?? NO_ATTRS

  // Column widths are the grid's state, not React state: rebuilding columnDefs
  // while a column is being dragged re-applies them and snaps the column back.
  // Read the saved sizes once, hand them to the grid at creation, then only
  // write on a finished resize — never re-render.
  const [initialWidths] = useState(() => {
    try { return JSON.parse(localStorage.getItem(ATTR_WIDTHS_KEY)) ?? {} } catch { return {} }
  })
  const savedWidthsRef = useRef(initialWidths)
  const saveAttrWidth = useCallback((name, width) => {
    savedWidthsRef.current = { ...savedWidthsRef.current, [name]: Math.max(80, Math.round(width)) }
    try { localStorage.setItem(ATTR_WIDTHS_KEY, JSON.stringify(savedWidthsRef.current)) } catch { /* private mode */ }
  }, [])
  const attrInitialState = useMemo(() => ({
    columnSizing: {
      columnSizingModel: Object.entries(initialWidths).map(([colId, width]) => ({ colId, width })),
    },
  }), [initialWidths])
  const onAttrColumnResized = useCallback(e => {
    if (e.finished && e.column && e.source === 'uiColumnResized') {
      saveAttrWidth(e.column.getColId(), e.column.getActualWidth())
    }
  }, [saveAttrWidth])

  const ordered = useMemo(() => buildTreeOrder(elements, edges), [elements, edges])

  const rows = useMemo(() => {
    let list = ordered
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(e => e.Name.toLowerCase().includes(q))
    }
    const vals = grid?.values ?? {}
    return list.map(el => ({ __name: el.Name, __type: el.Type, __depth: el.depth, __idx: indexMap?.[el.Name] ?? null, ...vals[el.Name] }))
  }, [ordered, search, grid, indexMap])

  const colDefs = useMemo(() => [
    {
      field: '__name',
      headerName: 'Element',
      pinned: 'left',
      initialWidth: 220,
      editable: false,
      cellRenderer: p => (
        <span style={{ paddingLeft: p.data.__depth * 14 }}>
          <span className={TYPE_COLOR[p.data.__type]}>{TYPE_ICON[p.data.__type]}</span>
          {' '}{p.value}
        </span>
      ),
    },
    // # Idx: the element's position in the dimension — click the header to sort by it
    ...(indexMap ? [{
      field: '__idx', headerName: 'Idx', pinned: 'left', initialWidth: 70, editable: false, sortable: true,
      type: 'rightAligned', cellClass: 'font-mono text-muted-foreground',
    }] : []),
    ...attrs.map(attr => {
      const isFormat = attr.Name.toLowerCase() === 'format'
      const isDescription = attr.Name.toLowerCase() === 'description'
      return {
      field: attr.Name,
      headerName: attr.Name,
      editable: !isFormat,
      resizable: true,
      initialWidth: isFormat ? 170 : isDescription ? 480 : 140,
      minWidth: 80,
      tooltipField: attr.Name,
      ...(isFormat ? { cellRenderer: p => (
        <button onClick={() => setFormatPicker({ element: p.data.__name, value: p.value ?? '' })}
          className="w-full text-left font-mono text-xs hover:text-primary truncate"
          title="Click to set format">
          {p.value || <span className="opacity-30 italic">click to set</span>}
        </button>
      )} : {}),
      headerComponent: AttrHeader,
      attrDef: { name: attr.Name, type: attr.Type },
      onConvertAttr: handleConvertToAlias,
      onDeleteAttr: handleDeleteAttr,
    }
    }),
  ], [attrs, handleDeleteAttr, handleConvertToAlias, indexMap])

  const onCellValueChanged = useCallback(p => {
    const element   = p.data.__name
    const attribute = p.colDef.field
    const attrDef   = attrs.find(a => a.Name === attribute)
    const type      = attrDef?.Type === 'Numeric' ? 'N' : 'S'
    writeAttr.mutate({ server: tab.server, dimension: tab.dimension, element, attribute, value: p.newValue ?? '', type, hierarchy },
      { onSuccess: () => { refetch(); if (attribute === 'Format') useStore.getState().bumpFormatVersion(tab.server, tab.dimension) }, onError: (e) => toast.error(`Failed to save ${attribute}: ${e.message}`) })
  }, [writeAttr, tab, attrs, hierarchy, refetch])

  const handleAttrPaste = useCallback(async (text) => {
    if (!text?.trim() || !attrs.length) return
    const lines = text.trim().split(/\r?\n/)
    // Detect if first row is a header (first cell doesn't match any element)
    const firstCell = lines[0].split('\t')[0].trim()
    const allNames = new Set(elements.map(e => e.Name))
    const startIdx = allNames.has(firstCell) ? 0 : 1
    const attrNames = startIdx === 1 ? lines[0].split('\t').slice(1).map(s => s.trim()) : attrs.map(a => a.Name)
    const rows = []
    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split('\t')
      const element = cols[0]?.trim(); if (!element) continue
      attrNames.forEach((attrName, j) => {
        const val = cols[j + 1]?.trim() ?? ''
        const attrDef = attrs.find(a => a.Name === attrName)
        if (attrDef) rows.push({ element, attrName, value: val, type: attrDef.Type === 'Numeric' ? 'N' : 'S' })
      })
    }
    if (!rows.length) return
    await bulkAttrImport.mutateAsync({ server: tab.server, dimension: tab.dimension, hierarchy, rows })
    refetch()
  }, [attrs, elements, tab, hierarchy, bulkAttrImport, refetch])

  const handleAttrFileUpload = useCallback(e => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => handleAttrPaste(ev.target.result)
    reader.readAsText(file)
    e.target.value = ''
  }, [handleAttrPaste])

  if (isLoading) return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
      <Loader2 size={16} className="animate-spin mr-2" /> Loading attributes…
    </div>
  )

  const hasFormat = attrs.some(a => a.Name.toLowerCase() === 'format')

  if (attrs.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
      <span>No attributes defined on this dimension.</span>
      <button
        onClick={() => handleCreateAttr('Format', 'String')}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border bg-background hover:bg-muted text-foreground"
      >
        <Plus size={11} /> Add Format attribute
      </button>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted shrink-0">
        {(writeAttr.isPending || createAttr.isPending || deleteAttr.isPending) && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
        {writeAttr.isError  && <span className="text-xs text-red-400">{writeAttr.error?.message}</span>}
        {createAttr.isError && <span className="text-xs text-red-400">{createAttr.error?.message}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => refetch()} title="Refresh attributes from TM1 (e.g. after running a TI process)"
            className="flex items-center gap-0.5 px-2 py-0.5 text-xs rounded border border-border bg-background text-muted-foreground hover:text-foreground">
            <RefreshCw size={10} />
          </button>
          <button onClick={() => attrFileRef.current?.click()}
            className="flex items-center gap-0.5 px-2 py-0.5 text-xs rounded border border-border bg-background text-muted-foreground hover:text-foreground"
            title="Upload CSV (Element, Attr1, Attr2…)">
            <Upload size={10} /> CSV
          </button>
          <input ref={attrFileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleAttrFileUpload} />
          {!hasFormat && (
            <button onClick={() => handleCreateAttr('Format', 'String')}
              className="flex items-center gap-0.5 px-2 py-0.5 text-xs rounded border border-border bg-background text-muted-foreground hover:text-foreground"
              title="Add Format attribute (String)">
              <Plus size={10} /> Format
            </button>
          )}
          <button onClick={() => setNewAttr(true)}
            className="flex items-center gap-0.5 px-2 py-0.5 text-xs rounded border border-border bg-background text-muted-foreground hover:text-foreground">
            <Plus size={10} /> New Attr
          </button>
        </div>
        <span className="text-xs text-muted-foreground">{rows.length} elements · {attrs.length} attrs</span>
      </div>
      <div className="text-[10px] text-muted-foreground px-3 py-1 border-b border-border bg-muted/10 shrink-0">
        Paste from clipboard (Element · Attr1 · Attr2…) or upload CSV to bulk-import attribute values
      </div>
      <div className="flex-1 min-h-0 w-full" onPaste={e => { const text = e.clipboardData?.getData('text/plain'); if (text) { e.preventDefault(); handleAttrPaste(text) } }}>
        <AgGridReact
          theme={dark ? darkTheme : lightTheme}
          rowData={rows}
          columnDefs={colDefs}
          initialState={attrInitialState}
          onCellValueChanged={onCellValueChanged}
          onColumnResized={onAttrColumnResized}
          getRowId={p => p.data.__name}
          defaultColDef={ATTR_DEFAULT_COL}
          stopEditingWhenCellsLoseFocus
          singleClickEdit
        />
      </div>
      {newAttr && <NewAttrModal onConfirm={handleCreateAttr} onClose={() => setNewAttr(false)} />}
      {formatPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setFormatPicker(null)}>
          <div className="bg-popover border border-border rounded shadow-xl p-3 w-72 text-xs" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">Format for <span className="font-mono text-primary">{formatPicker.element}</span></span>
              <button onClick={() => setFormatPicker(null)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
            </div>
            <input value={formatPicker.value} onChange={e => setFormatPicker(p => ({ ...p, value: e.target.value }))}
              placeholder="TM1 format string…"
              className="w-full bg-background border border-border rounded px-2 py-1 mb-2 font-mono text-xs outline-none focus:border-primary" />
            <div className="space-y-1.5 max-h-56 overflow-auto mb-2">
              {TM1_FORMAT_PRESETS.map(({ group, items }) => (
                <div key={group}>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-0.5 mb-0.5">{group}</div>
                  <div className="flex flex-wrap gap-1">
                    {items.map(({ fmt, label }) => (
                      <button key={fmt} onClick={() => setFormatPicker(p => ({ ...p, value: fmt }))}
                        className={cn('px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors',
                          formatPicker.value === fmt ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground')}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {formatPicker.value.startsWith('@') && (
              <div className="mb-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">Text Colour</div>
                <div className="flex flex-wrap gap-1 items-center">
                  {['red','blue','green','orange','purple','grey','maroon','teal'].map(c => (
                    <button key={c} onClick={() => setFormatPicker(p => ({ ...p, value: `@${c}` }))}
                      className={cn('w-5 h-5 rounded border transition-colors', formatPicker.value === `@${c}` && 'ring-2 ring-primary')}
                      style={{ backgroundColor: c }} title={c} />
                  ))}
                  <input type="color" value={COLOUR_HEX.test(formatPicker.value.slice(1)) ? formatPicker.value.slice(1) : '#888888'}
                    onChange={e => setFormatPicker(p => ({ ...p, value: `@${e.target.value}` }))}
                    className="w-6 h-5 p-0 border border-border rounded cursor-pointer" title="Custom colour" />
                </div>
              </div>
            )}
            <button
              onClick={() => writeAttr.mutate(
                { server: tab.server, dimension: tab.dimension, element: formatPicker.element, attribute: 'Format', value: formatPicker.value, type: 'S', hierarchy },
                { onSuccess: () => { refetch(); setFormatPicker(null); useStore.getState().bumpFormatVersion(tab.server, tab.dimension) }, onError: e => toast.error(`Format save failed: ${e.message}`) }
              )}
              disabled={writeAttr.isPending}
              className="w-full py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-40 hover:opacity-90 transition-opacity">
              {writeAttr.isPending ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
