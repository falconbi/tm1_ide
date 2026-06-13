import { useMemo, useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import {
  useElements, useElementsWithIndex, useEdges, useElementAttrValues, useHierarchies,
  useAddElement, useDeleteElement, useAddEdge, useDeleteEdge, useUpdateEdgeWeight,
  useAttrGrid, useWriteElementAttribute, useCreateAttrDef, useDeleteAttrDef, useSubsets, useSubsetElements, useDimCubes,
  useDimensionUsage, useCreateHierarchy, useBulkDimImport, useBulkAttrImport, useCreateDimension,
} from '@/hooks/useApi'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'
import { useStore } from '@/store'
import { ChevronRight, ChevronDown, Loader2, List, GitBranch, Plus, Trash2, Check, X, ClipboardList, ChevronLeft, Table2, Search, ListOrdered, MapPin, Upload, Grid3x3, Cog } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import PicklistBuilder from './PicklistBuilder'

ModuleRegistry.registerModules([AllCommunityModule])
const lightTheme = themeBalham.withPart(colorSchemeLight).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })
const darkTheme  = themeBalham.withPart(colorSchemeDark).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })

const TYPE_ICON  = { N: '○', C: '◆', S: '"' }
const TYPE_COLOR = { N: 'text-blue-400', C: 'text-orange-400', S: 'text-green-400' }
const TYPE_LABEL = { N: 'Numeric', C: 'Consolidated', S: 'String' }

function buildTree(elements, edges) {
  const byName = {}
  for (const e of elements) byName[e.Name] = e
  const childrenOf = {}
  const isChild = new Set()
  for (const edge of edges) {
    if (!childrenOf[edge.ParentName]) childrenOf[edge.ParentName] = []
    childrenOf[edge.ParentName].push(edge.ComponentName)
    isChild.add(edge.ComponentName)
  }
  const roots = elements.filter(e => !isChild.has(e.Name)).map(e => e.Name)
  return { roots, childrenOf, byName }
}

// ── Weight input ────────────────────────────────────────────────────────────
function WeightInput({ value, onSave }) {
  return (
    <input
      type="number"
      defaultValue={value}
      onBlur={e => { const n = parseFloat(e.target.value); if (!isNaN(n) && n !== value) onSave(n) }}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      step="any"
      className="w-14 text-[10px] font-mono bg-muted border border-border rounded px-1 py-px text-right outline-none focus:border-primary"
    />
  )
}

// ── Bulk add modal ──────────────────────────────────────────────────────────
function BulkAddModal({ consolElements, onConfirm, onClose }) {
  const [text, setText] = useState('')
  const [type, setType] = useState('N')
  const [parent, setParent] = useState('')

  const names = text.split('\n').map(s => s.trim()).filter(Boolean)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg w-[420px] shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Bulk Add Elements</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Paste element names — one per line</label>
            <textarea
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={"Revenue\nExpenses\nEBITDA\n..."}
              rows={8}
              className="w-full text-xs font-mono bg-muted border border-border rounded p-2 outline-none resize-none focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground shrink-0">Type:</span>
            {[['N','○ Leaf','text-blue-400'], ['C','◆ Consol','text-orange-400'], ['S','" String','text-green-400']].map(([v, label, col]) => (
              <label key={v} className="flex items-center gap-1 text-xs cursor-pointer">
                <input type="radio" name="btype" value={v} checked={type === v} onChange={() => setType(v)} />
                <span className={col}>{label}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Parent:</span>
            <select value={parent} onChange={e => setParent(e.target.value)}
              className="flex-1 text-xs bg-muted border border-border rounded px-2 py-1 outline-none">
              <option value="">None (root element)</option>
              {consolElements.map(e => <option key={e.Name} value={e.Name}>{e.Name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground">{names.length} element{names.length !== 1 ? 's' : ''} to add</span>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 text-xs border border-border rounded text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              onClick={() => names.length > 0 && onConfirm(names, type, parent || null)}
              disabled={names.length === 0}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded disabled:opacity-40">
              Add {names.length > 0 ? names.length : ''} Element{names.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Element properties panel ────────────────────────────────────────────────
function ElementPanel({ el, parents, children, byName, consolElements, elemAttrs, loadingAttrs, hierarchies,
  onDelete, onAddParent, onRemoveParent, onUpdateWeight, onClose }) {
  const [addingParent, setAddingParent] = useState(false)
  const [newParent, setNewParent] = useState('')

  const existingParentNames = new Set(parents.map(p => p.ParentName))
  const availableParents = consolElements.filter(e => e.Name !== el.Name && !existingParentNames.has(e.Name))

  return (
    <div className="flex flex-col h-full border-l border-border bg-background text-xs">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted shrink-0">
        <span className={cn('text-[11px]', TYPE_COLOR[el.Type])}>{TYPE_ICON[el.Type]}</span>
        <span className="font-mono font-semibold truncate flex-1">{el.Name}</span>
        <span className={cn('shrink-0 text-[10px] px-1.5 py-px rounded border', TYPE_COLOR[el.Type])}>
          {TYPE_LABEL[el.Type]}
        </span>
        <span className="shrink-0 text-muted-foreground text-[10px]">L{el.Level}</span>
        <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground ml-1">
          <ChevronLeft size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">

        {/* Hierarchies */}
        {hierarchies && hierarchies.length > 1 && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Hierarchies</div>
            <div className="flex flex-wrap gap-1">
              {hierarchies.map(h => (
                <span key={h} className="px-1.5 py-px rounded border border-border text-[10px] text-muted-foreground">{h}</span>
              ))}
            </div>
          </section>
        )}

        {/* Parents */}
        <section>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
            Parents ({parents.length})
          </div>
          {parents.length === 0 && (
            <p className="text-muted-foreground italic text-[11px]">Root element — no parents</p>
          )}
          {parents.map(p => (
            <div key={p.ParentName} className="flex items-center gap-1.5 py-0.5">
              <span className="text-orange-400 shrink-0 text-[10px]">◆</span>
              <span className="font-mono flex-1 truncate">{p.ParentName}</span>
              <span className="text-muted-foreground shrink-0">W</span>
              <WeightInput key={`${p.ParentName}-${p.Weight}`} value={p.Weight}
                onSave={w => onUpdateWeight(p.ParentName, el.Name, w)} />
              <button onClick={() => onRemoveParent(p.ParentName)}
                className="shrink-0 text-muted-foreground hover:text-red-400 p-0.5">
                <X size={10} />
              </button>
            </div>
          ))}
          {addingParent ? (
            <div className="flex items-center gap-1 mt-1">
              <select value={newParent} onChange={e => setNewParent(e.target.value)}
                className="flex-1 text-[10px] bg-muted border border-border rounded px-1 py-0.5 outline-none">
                <option value="">Pick consolidation…</option>
                {availableParents.map(e => <option key={e.Name} value={e.Name}>{e.Name}</option>)}
              </select>
              <button onClick={() => { if (newParent) { onAddParent(newParent); setAddingParent(false); setNewParent('') } }}
                className="p-0.5 text-primary shrink-0"><Check size={10} /></button>
              <button onClick={() => setAddingParent(false)}
                className="p-0.5 text-muted-foreground shrink-0"><X size={10} /></button>
            </div>
          ) : (
            <button onClick={() => setAddingParent(true)}
              className="flex items-center gap-0.5 mt-1 text-muted-foreground hover:text-foreground">
              <Plus size={9} /> Add parent
            </button>
          )}
        </section>

        {/* Children */}
        {el.Type === 'C' && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Children ({children.length})
            </div>
            {children.length === 0 && (
              <p className="text-muted-foreground italic text-[11px]">No children yet</p>
            )}
            {children.map(c => {
              const child = byName[c.ComponentName]
              return (
                <div key={c.ComponentName} className="flex items-center gap-1.5 py-0.5">
                  <span className={cn('shrink-0 text-[10px]', TYPE_COLOR[child?.Type] ?? 'text-muted-foreground')}>
                    {TYPE_ICON[child?.Type] ?? '·'}
                  </span>
                  <span className="font-mono flex-1 truncate">{c.ComponentName}</span>
                  <span className="text-muted-foreground shrink-0">W</span>
                  <WeightInput key={`${c.ComponentName}-${c.Weight}`} value={c.Weight}
                    onSave={w => onUpdateWeight(el.Name, c.ComponentName, w)} />
                </div>
              )
            })}
          </section>
        )}

        {/* Attributes */}
        <section>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Attributes</div>
          {loadingAttrs && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
          {!loadingAttrs && elemAttrs && Object.keys(elemAttrs).length === 0 && (
            <p className="text-muted-foreground italic text-[11px]">No attributes defined</p>
          )}
          {!loadingAttrs && elemAttrs && Object.entries(elemAttrs).map(([k, v]) => (
            <div key={k} className="flex items-start gap-2 py-0.5">
              <span className="text-muted-foreground shrink-0 min-w-[80px]">{k}:</span>
              <span className="font-mono break-all">{v ?? <span className="text-muted-foreground/50 italic">—</span>}</span>
            </div>
          ))}
        </section>

      </div>

      {/* Delete */}
      <div className="shrink-0 px-3 py-2 border-t border-border">
        <button onClick={() => onDelete(el.Name)}
          className="flex items-center gap-1.5 px-2 py-1.5 w-full justify-center text-xs rounded border border-red-400/30 text-red-400 hover:bg-red-500/10">
          <Trash2 size={11} /> Delete Element
        </button>
      </div>
    </div>
  )
}

// ── Tree node ───────────────────────────────────────────────────────────────
function AddRow({ onConfirm, onCancel }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('N')
  const confirm = () => { if (name.trim()) onConfirm(name.trim(), type) }
  return (
    <div className="flex items-center gap-1 py-1 px-1 bg-muted/40 rounded mb-1">
      <span className={cn('shrink-0 text-[10px] w-3', TYPE_COLOR[type])}>{TYPE_ICON[type]}</span>
      <input autoFocus value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onCancel() }}
        placeholder="element name…"
        className="flex-1 text-xs font-mono bg-transparent border-b border-primary outline-none py-px min-w-0" />
      <select value={type} onChange={e => setType(e.target.value)}
        className="text-[10px] bg-background border border-border rounded px-1 py-px text-muted-foreground shrink-0">
        <option value="N">Leaf</option>
        <option value="C">Consol</option>
        <option value="S">String</option>
      </select>
      <button onClick={confirm} className="p-1 text-primary shrink-0"><Check size={11} /></button>
      <button onClick={onCancel} className="p-1 text-muted-foreground shrink-0"><X size={11} /></button>
    </div>
  )
}

function TreeNode({ name, childrenOf, byName, depth, onAddChild, onDelete, selected, onSelect, visited = new Set(), indexMap }) {
  const children = childrenOf[name] ?? []
  const hasChildren = children.length > 0
  const cycle = visited.has(name)
  const [open, setOpen] = useState(depth < 2)
  const [addingChild, setAddingChild] = useState(false)
  const el = byName[name]
  const isC = el?.Type === 'C'
  const isSel = selected === name
  const nextVisited = new Set(visited).add(name)

  return (
    <div className={cn(depth > 0 && 'ml-4 border-l border-border/40 pl-1.5')}>
      <div
        onClick={() => onSelect(isSel ? null : name)}
        className={cn('flex items-center gap-1 py-0.5 cursor-pointer rounded-sm',
          isSel ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/50')}
      >
        <button onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          className={cn('shrink-0 text-muted-foreground hover:text-foreground', (!hasChildren || cycle) && 'invisible')}>
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <span className={cn('shrink-0 text-[10px] w-3', TYPE_COLOR[el?.Type] ?? '')}>{TYPE_ICON[el?.Type] ?? '·'}</span>
        {indexMap && <span className="shrink-0 text-[9px] text-muted-foreground/50 w-7 text-right font-mono">{indexMap[name] ?? ''}</span>}
        <span className="text-xs font-mono truncate flex-1">{name}</span>
        {cycle && <span className="text-muted-foreground/50 text-[10px]">(cycle)</span>}
        {isSel && !cycle && (
          <span className="flex items-center gap-1 shrink-0 ml-1">
            {isC && (
              <button onClick={e => { e.stopPropagation(); setOpen(true); setAddingChild(true) }}
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-border bg-background text-muted-foreground hover:text-foreground">
                <Plus size={9} /> Child
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); onDelete(name) }}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-border bg-background text-muted-foreground hover:text-red-400 hover:border-red-400/40">
              <Trash2 size={9} /> Del
            </button>
          </span>
        )}
      </div>
      {open && !cycle && (
        <>
          {addingChild && (
            <div className="ml-4 border-l border-border/40 pl-1.5">
              <AddRow
                onConfirm={(n, t) => { onAddChild(name, n, t); setAddingChild(false) }}
                onCancel={() => setAddingChild(false)}
              />
            </div>
          )}
          {children.map(c => (
            <TreeNode key={c} name={c} childrenOf={childrenOf} byName={byName} depth={depth + 1}
              onAddChild={onAddChild} onDelete={onDelete} selected={selected} onSelect={onSelect} visited={nextVisited} indexMap={indexMap} />
          ))}
        </>
      )}
    </div>
  )
}

function FlatList({ elements, selected, onSelect, onDelete, indexMap }) {
  const counts = { N: 0, C: 0, S: 0 }
  for (const e of elements) if (counts[e.Type] != null) counts[e.Type]++
  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-3 px-3 py-2 border-b border-border shrink-0 text-xs text-muted-foreground">
        {Object.entries(counts).map(([t, n]) => (
          <span key={t}><span className={TYPE_COLOR[t]}>{TYPE_ICON[t]}</span> {n} {TYPE_LABEL[t]}</span>
        ))}
        <span className="ml-auto">{elements.length} total</span>
      </div>
      <div className="flex-1 overflow-auto">
        {elements.map(e => {
          const isSel = selected === e.Name
          return (
            <div key={e.Name} onClick={() => onSelect(isSel ? null : e.Name)}
              className={cn('flex items-center gap-2 px-3 py-0.5 text-xs cursor-pointer',
                isSel ? 'bg-primary/10' : 'hover:bg-muted/50')}>
              <span className={cn('shrink-0 text-[10px]', TYPE_COLOR[e.Type])}>{TYPE_ICON[e.Type] ?? '·'}</span>
              {indexMap && <span className="shrink-0 text-[9px] text-muted-foreground/50 w-7 text-right font-mono">{indexMap[e.Name] ?? ''}</span>}
              <span className="font-mono truncate flex-1">{e.Name}</span>
              <span className="text-muted-foreground/50 shrink-0 text-[10px]">L{e.Level}</span>
              {isSel && (
                <button onClick={ev => { ev.stopPropagation(); onDelete(e.Name) }}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-border bg-background text-muted-foreground hover:text-red-400 hover:border-red-400/40 shrink-0">
                  <Trash2 size={9} /> Del
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Tree order helper ───────────────────────────────────────────────────────
function buildTreeOrder(elements, edges) {
  const childrenOf = {}
  const isChild = new Set()
  for (const edge of edges) {
    if (!childrenOf[edge.ParentName]) childrenOf[edge.ParentName] = []
    childrenOf[edge.ParentName].push(edge.ComponentName)
    isChild.add(edge.ComponentName)
  }
  const byName = Object.fromEntries(elements.map(e => [e.Name, e]))
  const roots = elements.filter(e => !isChild.has(e.Name)).map(e => e.Name)
  const result = []
  const visited = new Set()
  function dfs(name, depth) {
    if (visited.has(name)) return
    visited.add(name)
    const el = byName[name]
    if (el) result.push({ ...el, depth })
    for (const child of childrenOf[name] ?? []) dfs(child, depth + 1)
  }
  for (const r of roots) dfs(r, 0)
  for (const el of elements) if (!visited.has(el.Name)) result.push({ ...el, depth: 0 })
  return result
}

// ── Attribute grid ──────────────────────────────────────────────────────────
const TM1_FORMAT_PRESETS = [
  { group: 'Number',     items: [
    { fmt: '#,##0',       label: '1,000' },
    { fmt: '#,##0.0',     label: '1,000.0' },
    { fmt: '#,##0.00',    label: '1,000.00' },
    { fmt: '#,##0.000',   label: '1,000.000' },
    { fmt: '0',           label: '1000' },
    { fmt: '0.00',        label: '1000.00' },
  ]},
  { group: 'Currency',   items: [
    { fmt: '$#,##0',      label: '$1,000' },
    { fmt: '$#,##0.00',   label: '$1,000.00' },
    { fmt: '£#,##0.00',   label: '£1,000.00' },
    { fmt: '€#,##0.00',   label: '€1,000.00' },
  ]},
  { group: 'Percentage', items: [
    { fmt: '0%',          label: '10%' },
    { fmt: '0.0%',        label: '10.0%' },
    { fmt: '0.00%',       label: '10.00%' },
  ]},
  { group: 'Accounting', items: [
    { fmt: '#,##0;(#,##0)',       label: '1,000 / (1,000)' },
    { fmt: '#,##0.00;(#,##0.00)', label: '1,000.00 / (1,000.00)' },
    { fmt: '#,##0;[Red]-#,##0',   label: '1,000 / red −1,000' },
  ]},
  { group: 'Other',      items: [
    { fmt: 'General',     label: 'General' },
    { fmt: '@',           label: 'Text' },
  ]},
]

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

function AttrGrid({ tab, elements, edges, hierarchy }) {
  const dark      = useStore(s => s.dark)
  const [subset, setSubset]     = useState('')
  const [search,  setSearch]    = useState('')
  const [newAttr, setNewAttr]   = useState(false)
  const [formatPicker, setFormatPicker] = useState(null) // { element, value }
  const attrFileRef             = useRef(null)

  const { data: grid, isLoading, refetch } = useAttrGrid(tab.server, tab.dimension, hierarchy)
  const { data: subsets = [] }             = useSubsets(tab.server, tab.dimension, hierarchy)
  const { data: subElems = [] }            = useSubsetElements(tab.server, tab.dimension, subset, hierarchy)
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
  }, [deleteAttr, tab, refetch, hierarchy])

  const attrs = grid?.attrs ?? []

  const ordered = useMemo(() => buildTreeOrder(elements, edges), [elements, edges])

  const rows = useMemo(() => {
    let list = ordered
    if (subset && subElems.length > 0) {
      const names = new Set(subElems.map(e => e.name))
      list = list.filter(e => names.has(e.Name))
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(e => e.Name.toLowerCase().includes(q))
    }
    const vals = grid?.values ?? {}
    return list.map(el => ({ __name: el.Name, __type: el.Type, __depth: el.depth, ...vals[el.Name] }))
  }, [ordered, subset, subElems, search, grid])

  const colDefs = useMemo(() => [
    {
      field: '__name',
      headerName: 'Element',
      pinned: 'left',
      width: 220,
      editable: false,
      cellRenderer: p => (
        <span style={{ paddingLeft: p.data.__depth * 14 }}>
          <span className={TYPE_COLOR[p.data.__type]}>{TYPE_ICON[p.data.__type]}</span>
          {' '}{p.value}
        </span>
      ),
    },
    ...attrs.map(attr => {
      const isFormat = attr.Name.toLowerCase() === 'format'
      return {
      field: attr.Name,
      headerName: attr.Name,
      editable: !isFormat,
      width: isFormat ? 170 : 140,
      ...(isFormat ? { cellRenderer: p => (
        <button onClick={() => setFormatPicker({ element: p.data.__name, value: p.value ?? '' })}
          className="w-full text-left font-mono text-xs hover:text-primary truncate"
          title="Click to set format">
          {p.value || <span className="opacity-30 italic">click to set</span>}
        </button>
      )} : {}),
      headerComponent: p => (
        <div className="flex items-center gap-1 w-full group">
          <span className="flex-1 truncate">{attr.Name}</span>
          <span className={cn('text-[8px] font-bold shrink-0',
            attr.Type === 'Numeric' ? 'text-sky-400/70' : attr.Type === 'Alias' ? 'text-amber-400/70' : 'text-muted-foreground/50')}>
            {attr.Type === 'Numeric' ? 'N' : attr.Type === 'Alias' ? 'A' : 'S'}
          </span>
          <button onClick={() => handleDeleteAttr(attr.Name)}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
            title={`Delete attribute ${attr.Name}`}>
            <X size={10} />
          </button>
        </div>
      ),
    }
    }),
  ], [attrs])

  const onCellValueChanged = useCallback(p => {
    const element   = p.data.__name
    const attribute = p.colDef.field
    const attrDef   = attrs.find(a => a.Name === attribute)
    const type      = attrDef?.Type === 'Numeric' ? 'N' : 'S'
    writeAttr.mutate({ server: tab.server, dimension: tab.dimension, element, attribute, value: p.newValue ?? '', type, hierarchy },
      { onSuccess: () => refetch(), onError: (e) => toast.error(`Failed to save ${attribute}: ${e.message}`) })
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
        <select value={subset} onChange={e => setSubset(e.target.value)}
          className="text-xs bg-background border border-border rounded px-1.5 py-0.5 text-foreground max-w-44">
          <option value="">All elements</option>
          {subsets.map(s => <option key={s.Name} value={s.Name}>{s.Name}</option>)}
        </select>
        <div className="flex items-center gap-1 bg-background border border-border rounded px-1.5 py-0.5">
          <Search size={10} className="text-muted-foreground shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter elements…"
            className="text-xs bg-transparent outline-none w-32 placeholder:text-muted-foreground" />
        </div>
        {(writeAttr.isPending || createAttr.isPending || deleteAttr.isPending) && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
        {writeAttr.isError  && <span className="text-xs text-red-400">{writeAttr.error?.message}</span>}
        {createAttr.isError && <span className="text-xs text-red-400">{createAttr.error?.message}</span>}
        <div className="ml-auto flex items-center gap-1">
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
          onCellValueChanged={onCellValueChanged}
          getRowId={p => p.data.__name}
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
            <button
              onClick={() => writeAttr.mutate(
                { server: tab.server, dimension: tab.dimension, element: formatPicker.element, attribute: 'Format', value: formatPicker.value, type: 'S', hierarchy },
                { onSuccess: () => { refetch(); setFormatPicker(null) }, onError: e => toast.error(`Format save failed: ${e.message}`) }
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
function parseTabDelimited(text) {
  return text.trim().split(/\r?\n/).map(line => {
    const cols = line.split('\t')
    return { name: cols[0]?.trim() ?? '', type: cols[1]?.trim() || 'N', parent: cols[2]?.trim() ?? '', weight: parseFloat(cols[3]) || 1 }
  }).filter(r => r.name)
}

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

function NewDimensionScreen({ tab }) {
  const [name, setName] = useState('')
  const createMut = useCreateDimension()
  const { patchTab } = useStore()
  const inputRef = useRef(null)
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const handleCreate = () => {
    const n = name.trim()
    if (!n) return
    const id = toast.loading(`Creating "${n}"…`, { duration: 30000 })
    createMut.mutate({ server: tab.server, name: n }, {
      onSuccess: () => {
        toast.success(`Created ${n}`, { id })
        patchTab(tab.id, { dimension: n, hierarchy: n, label: n })
      },
      onError: (err) => toast.error(err.message ?? 'Create failed', { id }),
    })
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-sm">
      <div className="font-semibold text-base">New Dimension</div>
      <div className="flex gap-2 w-72">
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
          placeholder="Dimension name…"
          className="flex-1 px-3 py-1.5 text-sm border rounded bg-background outline-none focus:border-primary font-mono"
        />
        <button onClick={handleCreate} disabled={!name.trim() || createMut.isPending}
          className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-40">
          {createMut.isPending ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  )
}

export default function DimensionEditor({ tab }) {
  if (!tab.dimension) return <NewDimensionScreen tab={tab} />
  return <DimensionEditorCore tab={tab} />
}

function DimensionEditorCore({ tab }) {
  const [view, setView]           = useState('tree')
  const [selected, setSelected]   = useState(null)
  const [showIndex, setShowIndex] = useState(false)
  const [addRoot, setAddRoot]     = useState(false)
  const [bulkAdd, setBulkAdd]     = useState(false)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)
  const [showCubes, setShowCubes]       = useState(false)
  const [filterSubset, setFilterSubset] = useState('')
  const [filterSearch, setFilterSearch] = useState('')
  const [showPicklist, setShowPicklist] = useState(false)
  const [selectedHierarchy, setSelectedHierarchy] = useState(tab.hierarchy ?? tab.dimension)
  const [addingHierarchy, setAddingHierarchy] = useState(false)
  const [newHierarchyName, setNewHierarchyName] = useState('')

  const { data: elements = [], isLoading: loadingEl, refetch: refetchEl } = useElements(tab.server, tab.dimension, selectedHierarchy)
  const { data: indexedEls = [] } = useElementsWithIndex(showIndex ? tab.server : null, tab.dimension, selectedHierarchy)
  const indexMap = useMemo(() => Object.fromEntries(indexedEls.map(e => [e.Name, e.Index])), [indexedEls])
  const { data: edges    = [], isLoading: loadingEd, refetch: refetchEd } = useEdges(tab.server, tab.dimension, selectedHierarchy)
  const { data: hierarchies = [] } = useHierarchies(tab.server, tab.dimension)
  const { data: dimUsageData } = useDimensionUsage(tab.server, tab.dimension)
  const dimCubes    = dimUsageData?.cubes    ?? []
  const dimProcs    = dimUsageData?.processes ?? []
  const { data: elemAttrs, isFetching: loadingAttrs } = useElementAttrValues(tab.server, tab.dimension, selected, selectedHierarchy)
  const { data: subsets = [] }    = useSubsets(tab.server, tab.dimension, selectedHierarchy)
  const { data: subsetElems = [] } = useSubsetElements(tab.server, tab.dimension, filterSubset, selectedHierarchy)

  const addElementMut     = useAddElement()
  const deleteElementMut  = useDeleteElement()
  const addEdgeMut        = useAddEdge()
  const deleteEdgeMut     = useDeleteEdge()
  const updateWeightMut   = useUpdateEdgeWeight()
  const createHierarchyMut = useCreateHierarchy()

  const tree = useMemo(() => buildTree(elements, edges), [elements, edges])

  const filteredElements = useMemo(() => {
    let list = elements
    if (filterSubset && subsetElems.length > 0) {
      const names = new Set(subsetElems.map(e => e.name))
      list = list.filter(e => names.has(e.Name))
    }
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      list = list.filter(e => e.Name.toLowerCase().includes(q))
    }
    return list
  }, [elements, filterSubset, subsetElems, filterSearch])

  const filteredTree = useMemo(() => buildTree(filteredElements, edges), [filteredElements, edges])

  const consolElements   = useMemo(() => elements.filter(e => e.Type === 'C'), [elements])
  const selectedEl       = selected ? tree.byName[selected] : null
  const selectedParents  = selected ? edges.filter(e => e.ComponentName === selected) : []
  const selectedChildren = selected ? edges.filter(e => e.ParentName === selected) : []

  const refresh = useCallback(() => {
    refetchEl(); refetchEd(); setError(null)
  }, [refetchEl, refetchEd])

  const run = useCallback(async (fn) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }, [])

  const handleAddRoot = useCallback((name, type) => {
    setAddRoot(false)
    run(async () => {
      await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, addElementMut, tab, refresh, selectedHierarchy])

  const handleAddChild = useCallback((parent, name, type) => {
    run(async () => {
      await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, hierarchy: selectedHierarchy })
      await addEdgeMut.mutateAsync({ server: tab.server, dimension: tab.dimension, parent, child: name, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, addElementMut, addEdgeMut, tab, refresh, selectedHierarchy])

  const handleBulkAdd = useCallback((names, type, parent) => {
    setBulkAdd(false)
    run(async () => {
      for (const name of names) {
        await addElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, type, hierarchy: selectedHierarchy })
        if (parent) {
          await addEdgeMut.mutateAsync({ server: tab.server, dimension: tab.dimension, parent, child: name, hierarchy: selectedHierarchy })
        }
      }
      refresh()
    })
  }, [run, addElementMut, addEdgeMut, tab, refresh, selectedHierarchy])

  const handleDelete = useCallback((name) => {
    const childCount = (tree.childrenOf[name] ?? []).length
    if (childCount > 0 && !window.confirm(`"${name}" has ${childCount} child${childCount !== 1 ? 'ren' : ''}. Remove all edges and delete?`)) return
    if (selected === name) setSelected(null)
    run(async () => {
      const involving = edges.filter(e => e.ParentName === name || e.ComponentName === name)
      await Promise.all(involving.map(e =>
        deleteEdgeMut.mutateAsync({ server: tab.server, dimension: tab.dimension, parent: e.ParentName, child: e.ComponentName, hierarchy: selectedHierarchy })
      ))
      await deleteElementMut.mutateAsync({ server: tab.server, dimension: tab.dimension, name, hierarchy: selectedHierarchy })
      refresh()
    })
  }, [run, selected, tree, edges, deleteEdgeMut, deleteElementMut, tab, refresh, selectedHierarchy])

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
        {hierarchies.length > 1 && (
          <select
            value={selectedHierarchy}
            onChange={e => { setSelectedHierarchy(e.target.value); setSelected(null) }}
            className="text-xs bg-background border border-border rounded px-1.5 py-0.5 text-foreground max-w-36"
            title="Select hierarchy"
          >
            {hierarchies.map(h => <option key={h} value={h}>{h}</option>)}
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
            onClick={() => { setAddingHierarchy(true); setNewHierarchyName('') }}
            className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-background"
            title="New hierarchy"
          >
            <Plus size={9} /> Hierarchy
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
        </div>
      </div>

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
        <span className="ml-auto flex items-center gap-2">
          {subsets.length > 0 && (
            <select value={filterSubset} onChange={e => setFilterSubset(e.target.value)}
              className="text-xs bg-background border border-border rounded px-1.5 py-0.5 text-foreground max-w-36">
              <option value="">All elements</option>
              {subsets.map(s => <option key={s.Name} value={s.Name}>{s.Name}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1 bg-background border border-border rounded px-1.5 py-0.5">
            <Search size={10} className="text-muted-foreground shrink-0" />
            <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
              placeholder="Filter elements…"
              className="text-xs bg-transparent outline-none w-28 placeholder:text-muted-foreground" />
            {filterSearch && (
              <button onClick={() => setFilterSearch('')} className="text-muted-foreground hover:text-foreground shrink-0">
                <X size={9} />
              </button>
            )}
          </div>
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {view === 'attrs' && <div className="flex-1 min-w-0 min-h-0 flex flex-col"><AttrGrid tab={tab} elements={elements} edges={edges} hierarchy={selectedHierarchy} /></div>}
        {view === 'grid' && <div className="flex-1 min-w-0 min-h-0 flex flex-col"><StructureGrid tab={tab} elements={elements} edges={edges} hierarchy={selectedHierarchy} onApplied={refresh} /></div>}
        {/* Tree / Flat pane */}
        {view !== 'attrs' && view !== 'grid' && <>
          <div className={cn('flex-1 min-w-0 overflow-auto', selectedEl && 'max-w-[55%]')}>
            {view === 'flat' && (
              <FlatList elements={filteredElements} selected={selected} onSelect={setSelected} onDelete={handleDelete} indexMap={showIndex ? indexMap : null} />
            )}
            {view === 'tree' && (
              <div className="p-2">
                {addRoot && <AddRow onConfirm={handleAddRoot} onCancel={() => setAddRoot(false)} />}
                {filteredTree.roots.length === 0 && !addRoot && (
                  <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                    {filterSubset || filterSearch ? 'No elements match the current filter.' : 'No elements. Click Add or Bulk to start.'}
                  </p>
                )}
                {filteredTree.roots.map(r => (
                  <TreeNode key={r} name={r} childrenOf={filteredTree.childrenOf} byName={filteredTree.byName} depth={0}
                    onAddChild={handleAddChild} onDelete={handleDelete}
                    selected={selected} onSelect={setSelected} visited={new Set()} indexMap={showIndex ? indexMap : null} />
                ))}
              </div>
            )}
          </div>
          {selectedEl && (
            <div className="w-[45%] shrink-0 overflow-auto">
              <ElementPanel
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
    </div>
  )
}
