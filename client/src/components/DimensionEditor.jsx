import { post } from '@/lib/api'
import { useMemo, useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import {
  useElements, useElementsWithIndex, useEdges, useElementAttrValues, useHierarchies,
  useAddElement, useDeleteElement, useAddEdge, useDeleteEdge, useUpdateEdgeWeight, useSetComponent,
  useAttrGrid, useWriteElementAttribute, useCreateAttrDef, useDeleteAttrDef,
  useDimensionUsage, useCreateHierarchy, useBulkDimImport, useBulkAttrImport, usePreDeleteElementCheck,
} from '@/hooks/useApi'
import HierarchyFromAttributeDialog from '@/components/HierarchyFromAttributeDialog'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'
import { useStore } from '@/store'
import { ChevronRight, ChevronDown, Loader2, List, GitBranch, Plus, Check, X, ClipboardList, Table2, Search, ListOrdered, MapPin, Upload, Grid3x3, Cog, RefreshCw, HelpCircle } from 'lucide-react'
import HelpPanel from '@/components/HelpPanel'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import PicklistBuilder from './PicklistBuilder'
import ElementPanel, { AlternateBanner } from '@/components/dimension-editor/ElementPanel'
import NewDimensionScreen from '@/components/dimension-editor/NewDimensionScreen'
import BulkAddModal from '@/components/dimension-editor/dialogs/BulkAddModal'
import PreDeleteDialog from '@/components/dimension-editor/dialogs/PreDeleteDialog'
import AddRow from '@/components/dimension-editor/tree/AddRow'
import TreeNode from '@/components/dimension-editor/tree/TreeNode'
import FlatList from '@/components/dimension-editor/tree/FlatList'
import { buildTree, isUnder, buildTreeOrder } from '@/lib/dimension-editor/tree'
import { TYPE_ICON, TYPE_COLOR, COLOUR_HEX, TM1_FORMAT_PRESETS } from '@/lib/dimension-editor/constants'
import { parseTabDelimited } from '@/lib/dimension-editor/structure'

ModuleRegistry.registerModules([AllCommunityModule])
const lightTheme = themeBalham.withPart(colorSchemeLight).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })
const darkTheme  = themeBalham.withPart(colorSchemeDark).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })

// the attribute grid's column defaults -- one object, so a redraw doesn't reset the columns
const ATTR_DEFAULT_COL = { resizable: true }

// ── Attribute grid ──────────────────────────────────────────────────────────
const FormatPickerEditor = forwardRef(({ value: initialValue, stopEditing }, ref) => {
  const valueRef = useRef(initialValue ?? '')
  const [value, setValue] = useState(initialValue ?? '')
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.select(), 0) }, [])

  useImperativeHandle(ref, () => ({
    getValue: () => valueRef.current,
    isCancelBeforeStart: () => false,
  }))

  const set = (fmt) => { valueRef.current = fmt; setValue(fmt) }
  const selectPreset = (fmt) => { set(fmt); stopEditing?.() }

  return (
    <div className="bg-popover border border-border rounded shadow-xl p-2 w-64 text-xs" style={{ zIndex: 9999 }}>
      <input ref={inputRef} value={value} onChange={e => set(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && stopEditing?.()}
        placeholder="TM1 format string…"
        className="w-full bg-background border border-border rounded px-2 py-1 mb-2 font-mono text-xs outline-none focus:border-primary" />
      <div className="space-y-1.5 max-h-56 overflow-auto">
        {TM1_FORMAT_PRESETS.map(({ group, items }) => (
          <div key={group}>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-0.5 mb-0.5">{group}</div>
            <div className="flex flex-wrap gap-1">
              {items.map(({ fmt, label }) => (
                <button key={fmt} onClick={() => selectPreset(fmt)}
                  className={cn('px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors',
                    value === fmt
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground')}
                  title={fmt}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {value.startsWith('@') && (
        <div className="mt-2">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">Text Colour</div>
          <div className="flex flex-wrap gap-1 items-center">
            {['red','blue','green','orange','purple','grey','maroon','teal'].map(c => (
              <button key={c} onClick={() => { valueRef.current = `@${c}`; setValue(`@${c}`) }}
                className={cn('w-5 h-5 rounded border transition-colors', value === `@${c}` && 'ring-2 ring-primary')}
                style={{ backgroundColor: c }} title={c} />
            ))}
            <input type="color" value={COLOUR_HEX.test(value.slice(1)) ? value.slice(1) : '#888888'}
              onChange={e => { const v = `@${e.target.value}`; valueRef.current = v; setValue(v) }}
              className="w-6 h-5 p-0 border border-border rounded cursor-pointer" title="Custom colour" />
          </div>
        </div>
      )}
    </div>
  )
})
FormatPickerEditor.displayName = 'FormatPickerEditor'

function NewAttrModal({ onConfirm, onClose }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('String')
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg p-4 w-72 shadow-xl" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold mb-3">New Attribute</p>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder="Attribute name (e.g. DOB)"
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim(), type) }}
          className="w-full text-xs bg-muted border border-border rounded px-2 py-1.5 mb-2 outline-none focus:border-primary" />
        <div className="flex gap-2 mb-3">
          {['String', 'Numeric', 'Alias'].map(t => (
            <button key={t} onClick={() => setType(t)}
              className={cn('flex-1 text-xs px-2 py-1 rounded border transition-colors',
                type === t ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted')}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => name.trim() && onConfirm(name.trim(), type)}
            disabled={!name.trim()}
            className="flex-1 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-40">
            Create
          </button>
          <button onClick={onClose} className="flex-1 text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// A stable header component: AG Grid rebuilds the header when its type changes,
// and a type that changes on every render interrupts a column resize mid-drag.
function AttrHeader({ column }) {
  const colDef = column.getColDef()
  const attr   = colDef.attrDef
  if (!attr) return <span className="truncate">{colDef.headerName}</span>
  const { name, type } = attr
  return (
    <div className="relative flex items-center gap-1 w-full h-full group">
      <span className="flex-1 truncate">{name}</span>
      <span className={cn('text-[8px] font-bold shrink-0',
        type === 'Numeric' ? 'text-sky-400/70' : type === 'Alias' ? 'text-amber-400/70' : 'text-muted-foreground/50')}>
        {type === 'Numeric' ? 'N' : type === 'Alias' ? 'A' : 'S'}
      </span>
      {type === 'String' && !['Format', 'Picklist'].includes(name) && (
        <button onClick={() => colDef.onConvertAttr?.(name)}
          className="opacity-0 group-hover:opacity-100 text-amber-500 hover:text-amber-400 transition-opacity text-[8px] font-bold leading-none"
          title={`Convert ${name} to Alias type`}>
          →A
        </button>
      )}
      <button onClick={() => colDef.onDeleteAttr?.(name)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
        title={`Delete attribute ${name}`}>
        <X size={10} />
      </button>
    </div>
  )
}

const NO_ATTRS = []
const ATTR_WIDTHS_KEY = 'tm1-attr-widths'

function AttrGrid({ tab, elements, edges, hierarchy, search = '', indexMap = null }) {
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

// ── Main component ──────────────────────────────────────────────────────────
// ── Structure Grid (Element / Parent / Weight bulk editor) ────────────────────
function StructureGrid({ tab, elements, edges, hierarchy, onApplied }) {
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

export default function DimensionEditor({ tab }) {
  if (!tab.dimension) return <NewDimensionScreen tab={tab} />
  return <DimensionEditorCore tab={tab} />
}

function DimensionEditorCore({ tab }) {
  const [view, setView]           = useState('attrs')
  const [selected, setSelected]   = useState(null)
  const [showIndex, setShowIndex] = useState(false)
  const [addRoot, setAddRoot]     = useState(false)
  const [bulkAdd, setBulkAdd]     = useState(false)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)
  const [showCubes, setShowCubes]       = useState(false)
  const [filterSearch, setFilterSearch] = useState('')
  const [showPicklist, setShowPicklist] = useState(false)
  const [selectedHierarchy, setSelectedHierarchy] = useState(tab.hierarchy ?? tab.dimension)
  const [addingHierarchy, setAddingHierarchy] = useState(false)
  const [newHierarchyName, setNewHierarchyName] = useState('')
  const [hierMenu, setHierMenu] = useState(false)
  const [fromAttr, setFromAttr] = useState(false)
  const [deleteCheck, setDeleteCheck] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const [dragging, setDragging] = useState(null)

  const { data: elements = [], isLoading: loadingEl, refetch: refetchEl } = useElements(tab.server, tab.dimension, selectedHierarchy)
  const { data: indexedEls = [] } = useElementsWithIndex(showIndex ? tab.server : null, tab.dimension, selectedHierarchy)
  const indexMap = useMemo(() => Object.fromEntries(indexedEls.map(e => [e.Name, e.Index])), [indexedEls])
  const { data: edges    = [], isLoading: loadingEd, refetch: refetchEd } = useEdges(tab.server, tab.dimension, selectedHierarchy)
  const { data: hierarchies = [] } = useHierarchies(tab.server, tab.dimension)
  const { data: dimUsageData } = useDimensionUsage(tab.server, tab.dimension)
  const dimCubes    = dimUsageData?.cubes    ?? []
  const dimProcs    = dimUsageData?.processes ?? []
  const { data: elemAttrs, isFetching: loadingAttrs } = useElementAttrValues(tab.server, tab.dimension, selected, selectedHierarchy)

  const addElementMut     = useAddElement()
  const deleteElementMut  = useDeleteElement()
  const addEdgeMut        = useAddEdge()
  const setComponentMut   = useSetComponent()
  const deleteEdgeMut     = useDeleteEdge()
  const updateWeightMut   = useUpdateEdgeWeight()
  const createHierarchyMut = useCreateHierarchy()
  const preDeleteMut      = usePreDeleteElementCheck()

  const tree = useMemo(() => buildTree(elements, edges), [elements, edges])

  const filteredElements = useMemo(() => {
    let list = elements
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      list = list.filter(e => e.Name.toLowerCase().includes(q))
    }
    return list
  }, [elements, filterSearch])

  // Tree: the matches plus the parents above them, so a match still has a path down from the top
  const filteredTree = useMemo(() => {
    if (!filterSearch) return buildTree(elements, edges)
    const parentsOf = {}
    for (const e of edges) (parentsOf[e.ComponentName] ??= []).push(e.ParentName)
    const keep = new Set(), stack = filteredElements.map(e => e.Name)
    while (stack.length) { const n = stack.pop(); if (keep.has(n)) continue; keep.add(n); stack.push(...(parentsOf[n] ?? [])) }
    return buildTree(elements.filter(e => keep.has(e.Name)), edges.filter(e => keep.has(e.ParentName) && keep.has(e.ComponentName)))
  }, [elements, filteredElements, edges, filterSearch])

  const consolElements   = useMemo(() => elements.filter(e => e.Type === 'C'), [elements])
  const selectedEl       = selected ? tree.byName[selected] : null
  const selectedParents  = selected ? edges.filter(e => e.ComponentName === selected) : []
  const selectedChildren = selected ? edges.filter(e => e.ParentName === selected) : []

  const refresh = useCallback(() => {
    refetchEl(); refetchEd(); setError(null)
  }, [refetchEl, refetchEd])

  const run = useCallback(async (fn) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e.message); toast.error(e.message) }
    finally { setBusy(false) }
  }, [])

  const handleAddRoot = useCallback((name, type, before) => {
    setAddRoot(false)
    run(async () => {
      await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, before, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, addElementMut, tab, refresh, selectedHierarchy])

  const handleAddChild = useCallback((parent, name, type, before) => {
    run(async () => {
      await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, parent, before, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, addElementMut, tab, refresh, selectedHierarchy])

  const handleBulkAdd = useCallback((names, type, parent, before) => {
    setBulkAdd(false)
    run(async () => {
      // all names go in before the same anchor, in list order — so the block keeps
      // the order it was pasted in
      for (const name of names) {
        await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, parent, before, hierarchy: selectedHierarchy })
      }
      refresh()
    })
  }, [run, addElementMut, tab, refresh, selectedHierarchy])

  // drag an element onto a consolidation (before = null → end) or between two siblings
  const handleDropChildAt = useCallback((parent, before, child) => {
    if (!parent || !child || parent === child || before === child) return
    const parentEl = tree.byName[parent], childEl = tree.byName[child]
    if (parentEl?.Type !== 'C' || !childEl) return
    if (childEl.Type === 'S') { toast.error('String elements cannot be added under a consolidation'); return }
    if (isUnder(tree.childrenOf, child, parent)) { toast.error(`Cannot put "${child}" under its own descendant`); return }
    const existing = edges.find(e => e.ParentName === parent && e.ComponentName === child)
    run(async () => {
      await setComponentMut.mutateAsync({
        server: tab.server, dimension: tab.dimension, parent, child, before,
        weight: existing?.Weight ?? 1, hierarchy: selectedHierarchy,
      })
      refresh()
      setSelected(parent)
      toast.success(`${existing ? 'Moved' : 'Added'} ${child} under ${parent}`)
    })
  }, [tree, edges, run, setComponentMut, tab, refresh, selectedHierarchy])

  const execDelete = useCallback((name) => {
    if (selected === name) setSelected(null)
    run(async () => {
      const involving = edges.filter(e => e.ParentName === name || e.ComponentName === name)
      await Promise.all(involving.map(e =>
        deleteEdgeMut.mutateAsync({ server: tab.server, dimension: tab.dimension, parent: e.ParentName, child: e.ComponentName, hierarchy: selectedHierarchy })
      ))
      await deleteElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, selected, edges, deleteEdgeMut, deleteElementMut, tab, refresh, selectedHierarchy])

  const handleDelete = useCallback((name) => {
    const childCount = (tree.childrenOf[name] ?? []).length
    if (childCount > 0 && !window.confirm(`"${name}" has ${childCount} child${childCount !== 1 ? 'ren' : ''}. Remove all edges and delete?`)) return
    const id = toast.loading(`Checking references for "${name}"…`)
    preDeleteMut.mutateAsync({ server: tab.server, dimension: tab.dimension, element: name, hierarchy: selectedHierarchy })
      .then(result => {
        toast.dismiss(id)
        setDeleteTarget(name)
        setDeleteCheck(result)
      })
      .catch(() => {
        toast.dismiss(id)
        execDelete(name)
      })
  }, [tree, tab, selectedHierarchy, preDeleteMut, execDelete])

  const handleAddParent = useCallback((child, parent) => {
    run(async () => {
      await addEdgeMut.mutateAsync({ server: tab.server, dimension: tab.dimension, parent, child, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, addEdgeMut, tab, refresh, selectedHierarchy])

  const handleRemoveParent = useCallback((child, parent) => {
    run(async () => {
      await deleteEdgeMut.mutateAsync({ server: tab.server, dimension: tab.dimension, parent, child, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, deleteEdgeMut, tab, refresh, selectedHierarchy])

  const handleUpdateWeight = useCallback((parent, child, weight) => {
    run(async () => {
      await updateWeightMut.mutateAsync({ server: tab.server, dimension: tab.dimension, parent, child, weight, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, updateWeightMut, tab, refresh])


  if (loadingEl || loadingEd) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 size={16} className="animate-spin mr-2" /> Loading dimension…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar row 1 — title + hierarchy + actions */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted shrink-0">
        <span className="text-xs font-semibold">{tab.dimension}</span>
        <button
          onClick={() => {
            const { setRevealTarget } = useStore.getState()
            setRevealTarget({
              type: tab.hierarchy && tab.hierarchy !== tab.dimension ? 'hierarchy' : 'dimension',
              server: tab.server,
              dimension: tab.dimension,
              hierarchy: tab.hierarchy,
            })
          }}
          className="p-1 rounded hover:bg-muted text-amber-400 hover:text-amber-300 transition-colors"
          title="Show in Explorer tree"
        >
          <MapPin size={11} />
        </button>
        {hierarchies.filter(h => h !== 'Leaves').length > 1 && (
          <select
            value={selectedHierarchy}
            onChange={e => { setSelectedHierarchy(e.target.value); setSelected(null) }}
            className="text-xs bg-background border border-border rounded px-1.5 py-0.5 text-foreground max-w-36"
            title="Select hierarchy"
          >
            {hierarchies.filter(h => h !== 'Leaves').map(h => <option key={h} value={h}>{h}{h === tab.dimension ? ' (default)' : ' (alternate)'}</option>)}
          </select>
        )}
        {addingHierarchy ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newHierarchyName}
              onChange={e => setNewHierarchyName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newHierarchyName.trim()) {
                  run(async () => {
                    await createHierarchyMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name: newHierarchyName.trim() })
                    setAddingHierarchy(false)
                    setNewHierarchyName('')
                    setSelectedHierarchy(newHierarchyName.trim())
                  })
                }
                if (e.key === 'Escape') { setAddingHierarchy(false); setNewHierarchyName('') }
              }}
              onBlur={() => { setAddingHierarchy(false); setNewHierarchyName('') }}
              placeholder="Hierarchy name…"
              className="text-xs bg-background border border-primary rounded px-1.5 py-0.5 outline-none w-28"
            />
            <button onClick={() => { setAddingHierarchy(false); setNewHierarchyName('') }} className="text-muted-foreground hover:text-foreground"><X size={10} /></button>
          </div>
        ) : (
          <button
            onClick={() => setHierMenu(m => !m)}
            className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-background relative"
            title="New hierarchy"
          >
            <Plus size={9} /> Hierarchy
            {hierMenu && (
              <span className="absolute left-0 top-full mt-1 z-50 w-56 rounded border border-border bg-popover shadow-lg text-left py-1" onClick={e => e.stopPropagation()}>
                <span role="button" className="block px-3 py-1.5 hover:bg-muted text-foreground"
                  onClick={() => { setHierMenu(false); setFromAttr(true) }}>
                  From an attribute…<span className="block text-[10px] text-muted-foreground">Generated and kept in step by a process</span>
                </span>
                <span role="button" className="block px-3 py-1.5 hover:bg-muted text-foreground"
                  onClick={() => { setHierMenu(false); setAddingHierarchy(true); setNewHierarchyName('') }}>
                  Empty<span className="block text-[10px] text-muted-foreground">Built by hand in this editor</span>
                </span>
              </span>
            )}
          </button>
        )}
        <span className="text-xs text-muted-foreground">
          {filteredElements.length !== elements.length
            ? `${filteredElements.length} / ${elements.length} elements`
            : `${elements.length} elements`}
        </span>
        {busy && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
        {error && <span className="text-xs text-red-400 truncate max-w-40" title={error}>{error}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => { setAddRoot(true); setView('tree') }} disabled={busy}
            className="flex items-center gap-0.5 px-2 py-0.5 text-xs rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Plus size={10} /> Add
          </button>
          <button onClick={() => setBulkAdd(true)} disabled={busy}
            className="flex items-center gap-0.5 px-2 py-0.5 text-xs rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40">
            <ClipboardList size={10} /> Bulk
          </button>
          <span className="w-px h-4 bg-border mx-0.5" />
          <button onClick={() => setView('tree')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'tree' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <GitBranch size={11} /> Tree
          </button>
          <button onClick={() => setView('flat')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'flat' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <List size={11} /> Flat
          </button>
          <button onClick={() => setView('grid')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'grid' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <Grid3x3 size={11} /> Grid
          </button>
          <button onClick={() => setView('attrs')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'attrs' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <Table2 size={11} /> Attrs
          </button>
          <span className="w-px h-4 bg-border mx-0.5" />
          <button onClick={() => setShowIndex(v => !v)}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              showIndex ? 'bg-primary/10 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:bg-background hover:text-foreground')}
            title="Toggle element index">
            # Idx
          </button>
          <button onClick={() => setShowPicklist(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border text-muted-foreground hover:bg-background hover:text-foreground transition-colors">
            <ListOrdered size={11} /> Picklists
          </button>
          <span className="w-px h-4 bg-border mx-0.5" />
          <button onClick={() => setShowHelp(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
            title="Help — Dimension Editor">
            <HelpCircle size={11} />
          </button>
        </div>
      </div>
      <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="dimension" />
      <AlternateBanner server={tab.server} dimension={tab.dimension} hierarchy={selectedHierarchy} />
      {fromAttr && (
        <HierarchyFromAttributeDialog server={tab.server} dimension={tab.dimension} onClose={() => setFromAttr(false)}
          onDone={h => { setFromAttr(false); setSelectedHierarchy(h); setSelected(null) }} />
      )}

      {/* Toolbar row 2 — used in + filters */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/50 shrink-0 flex-wrap">
        {(dimCubes.length > 0 || dimProcs.length > 0) && (
          <span className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setShowCubes(s => !s)}
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors shrink-0">
              {showCubes ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Used in {dimCubes.length} cube{dimCubes.length !== 1 ? 's' : ''}{dimProcs.length > 0 ? `, ${dimProcs.length} TI` : ''}
            </button>
            {showCubes && <>
              {dimCubes.map(c => (
                <span key={c} className="px-1.5 py-px rounded bg-background border border-border text-[10px] font-mono text-muted-foreground">{c}</span>
              ))}
              {dimProcs.map((p, i) => (
                <span key={`p-${i}`} className="flex items-center gap-1 px-1.5 py-px rounded bg-background border border-border text-[10px] font-mono text-muted-foreground">
                  <Cog size={8} />{p.process}
                </span>
              ))}
            </>}
          </span>
        )}
        {/* the one element filter — Tree, Flat and Attrs; not Grid, which edits and applies every row */}
        <span className="ml-auto flex items-center gap-2">
          {view !== 'grid' && <div className="flex items-center gap-1 bg-background border border-border rounded px-1.5 py-0.5">
            <Search size={10} className="text-muted-foreground shrink-0" />
            <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
              placeholder="Filter elements…"
              className="text-xs bg-transparent outline-none w-28 placeholder:text-muted-foreground" />
            {filterSearch && (
              <button onClick={() => setFilterSearch('')} className="text-muted-foreground hover:text-foreground shrink-0">
                <X size={9} />
              </button>
            )}
          </div>}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {view === 'attrs' && <div className="flex-1 min-w-0 min-h-0 flex flex-col"><AttrGrid tab={tab} elements={elements} edges={edges} hierarchy={selectedHierarchy} search={filterSearch} indexMap={showIndex ? indexMap : null} /></div>}
        {view === 'grid' && <div className="flex-1 min-w-0 min-h-0 flex flex-col"><StructureGrid tab={tab} elements={elements} edges={edges} hierarchy={selectedHierarchy} onApplied={refresh} /></div>}
        {/* Tree / Flat pane */}
        {view !== 'attrs' && view !== 'grid' && <>
          <div className={cn('flex-1 min-w-0 overflow-auto', selectedEl && 'max-w-[55%]')}>
            {view === 'flat' && (
              <FlatList elements={filteredElements} selected={selected} onSelect={setSelected} onDelete={handleDelete} indexMap={showIndex ? indexMap : null} />
            )}
            {view === 'tree' && (
              <div className="p-2">
                {addRoot && <AddRow beforeOptions={selectedHierarchy === tab.dimension ? tree.roots : []} onConfirm={handleAddRoot} onCancel={() => setAddRoot(false)} />}
                {filteredTree.roots.length === 0 && !addRoot && (
                  <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                    {filterSearch ? 'No elements match the current filter.' : 'No elements. Click Add or Bulk to start.'}
                  </p>
                )}
                {filteredTree.roots.map(r => (
                  <TreeNode key={filterSearch ? `${r}|filtered` : r} filtering={!!filterSearch} name={r} childrenOf={filteredTree.childrenOf} byName={filteredTree.byName} depth={0}
                    onAddChild={handleAddChild} onDelete={handleDelete}
                    selected={selected} onSelect={setSelected} visited={new Set()} indexMap={showIndex ? indexMap : null}
                    drag={dragging} onDragStart={setDragging} onDragEnd={() => setDragging(null)} onDropChildAt={handleDropChildAt} />
                ))}
              </div>
            )}
          </div>
          {selectedEl && (
            <div className="w-[45%] shrink-0 overflow-auto">
              <ElementPanel
                server={tab.server}
                dimension={tab.dimension}
                el={selectedEl}
                parents={selectedParents}
                children={selectedChildren}
                byName={tree.byName}
                consolElements={consolElements}
                hierarchies={hierarchies}
                elemAttrs={elemAttrs}
                loadingAttrs={loadingAttrs}
                onDelete={handleDelete}
                onAddParent={parent => handleAddParent(selected, parent)}
                onRemoveParent={parent => handleRemoveParent(selected, parent)}
                onUpdateWeight={handleUpdateWeight}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </>}
      </div>

      {/* Bulk add modal */}
      {bulkAdd && (
        <BulkAddModal
          consolElements={consolElements}
          roots={tree.roots}
          childrenOf={tree.childrenOf}
          onConfirm={handleBulkAdd}
          onClose={() => setBulkAdd(false)}
        />
      )}
      {showPicklist && (
        <PicklistBuilder
          server={tab.server}
          dim={tab.dimension}
          hierarchy={selectedHierarchy}
          onClose={() => setShowPicklist(false)}
        />
      )}
      <PreDeleteDialog
        check={deleteCheck}
        elementName={deleteTarget}
        onConfirm={() => { setDeleteCheck(null); execDelete(deleteTarget); setDeleteTarget(null) }}
        onCancel={() => { setDeleteCheck(null); setDeleteTarget(null) }}
      />
    </div>
  )
}
