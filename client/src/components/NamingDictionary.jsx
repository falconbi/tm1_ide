import { useState, useMemo, useRef } from 'react'
import { X, RotateCcw, Save, Download, Upload, Plus, Trash2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getNamingMap, updateNamingDictionary, resetNamingDictionary,
  exportNamingDictionary, importNamingDictionary, IBM_DEFAULTS, IBM_TYPES,
} from '@/lib/formatters/naming.js'

const TYPE_LABEL  = { rules: 'Rules', ti: 'TI', mdx: 'MDX' }
const TYPE_COLOUR = {
  rules: 'bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-300',
  ti:    'bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-300',
  mdx:   'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
}

function buildRows() {
  const { customEntries, disabledDefaults } = getNamingMap()
  const disabled = new Set(disabledDefaults.map(s => s.toLowerCase()))
  const rows = []
  for (const [input, output] of Object.entries(IBM_DEFAULTS)) {
    if (!disabled.has(input)) {
      rows.push({ id: `ibm-${input}`, input, output, source: 'ibm', type: IBM_TYPES[input] ?? 'rules' })
    }
  }
  for (const [input, output] of Object.entries(customEntries)) {
    rows.push({ id: `custom-${input}`, input, output, source: 'custom', type: 'custom' })
  }
  rows.sort((a, b) => a.input.localeCompare(b.input))
  return { rows, disabled }
}

// ── Embeddable panel — used as a tab inside CatalogAdmin ────────────────────
export function NamingDictionaryPanel({ onClose }) {
  const [{ rows, disabled }, setState] = useState(buildRows)
  const [search, setSearch]            = useState('')
  const [typeFilter, setTypeFilter]    = useState('all')
  const newRowRef = useRef(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rows.filter(r => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (q && !r.input.toLowerCase().includes(q) && !r.output.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, search, typeFilter])

  const addEntry = () => {
    const id = `custom-${Date.now()}`
    setState(prev => ({ ...prev, rows: [...prev.rows, { id, input: '', output: '', source: 'custom', type: 'custom' }] }))
    setSearch(''); setTypeFilter('all')
    setTimeout(() => {
      newRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      newRowRef.current?.querySelector('input')?.focus()
    }, 50)
  }

  const updateEntry = (id, field, value) =>
    setState(prev => ({ ...prev, rows: prev.rows.map(r => r.id === id ? { ...r, [field]: value } : r) }))

  const removeEntry = (id) => {
    const row = rows.find(r => r.id === id)
    if (!row) return
    if (row.source === 'ibm') {
      setState(prev => ({ rows: prev.rows.filter(r => r.id !== id), disabled: new Set([...prev.disabled, row.input.toLowerCase()]) }))
    } else {
      setState(prev => ({ ...prev, rows: prev.rows.filter(r => r.id !== id) }))
    }
  }

  const handleSave = () => {
    const newCustom = {}
    for (const r of rows) {
      if (r.source === 'custom' && r.input.trim()) newCustom[r.input.trim().toLowerCase()] = r.output.trim()
    }
    updateNamingDictionary(newCustom, Array.from(disabled))
    onClose?.()
  }

  const handleExport = () => {
    const blob = new Blob([exportNamingDictionary()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'tm1-naming-dictionary.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) return
      if (importNamingDictionary(await file.text())) setState(buildRows())
    }
    input.click()
  }

  const handleReset = () => {
    if (window.confirm('Reset naming dictionary to IBM defaults? All custom entries and disabled defaults will be lost.')) {
      resetNamingDictionary()
      setState(buildRows())
    }
  }

  const customCount = rows.filter(r => r.source === 'custom').length
  const isLastRow   = (id) => rows[rows.length - 1]?.id === id

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="pl-6 pr-2 py-1 text-xs bg-background border border-border rounded outline-none focus:border-primary w-40"
          />
        </div>
        <div className="flex gap-1">
          {['all', 'rules', 'ti', 'mdx', 'custom'].map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'px-2 py-0.5 text-[10px] rounded border transition-colors capitalize',
                typeFilter === t
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:text-foreground'
              )}
            >
              {t === 'all' ? `All (${rows.length})` : t === 'custom' ? `Custom (${customCount})` : TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={handleImport} className="p-1.5 rounded hover:bg-muted text-muted-foreground" title="Import JSON"><Upload size={12} /></button>
          <button onClick={handleExport} className="p-1.5 rounded hover:bg-muted text-muted-foreground" title="Export JSON"><Download size={12} /></button>
          <button onClick={handleReset}  className="p-1.5 rounded hover:bg-muted text-muted-foreground" title="Reset to IBM defaults"><RotateCcw size={12} /></button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-muted sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium text-xs w-[35%]">When formatter sees</th>
              <th className="text-left px-3 py-1.5 font-medium text-xs w-[35%]">Write this instead</th>
              <th className="text-left px-3 py-1.5 font-medium text-xs w-16">Type</th>
              <th className="text-left px-3 py-1.5 font-medium text-xs w-12">Source</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr
                key={r.id}
                ref={isLastRow(r.id) && r.source === 'custom' ? newRowRef : null}
                className="border-b border-border/40 hover:bg-muted/30"
              >
                <td className="px-2 py-0.5">
                  <input
                    value={r.input}
                    onChange={ev => updateEntry(r.id, 'input', ev.target.value)}
                    readOnly={r.source === 'ibm'}
                    placeholder="e.g. myFunc"
                    className={cn(
                      'w-full text-[11px] bg-transparent border border-transparent rounded px-1 py-0.5 outline-none font-mono',
                      r.source === 'ibm' ? 'text-muted-foreground cursor-default' : 'hover:border-border focus:border-ring focus:bg-background'
                    )}
                  />
                </td>
                <td className="px-2 py-0.5">
                  <input
                    value={r.output}
                    onChange={ev => updateEntry(r.id, 'output', ev.target.value)}
                    placeholder="e.g. MyFunc"
                    className="w-full text-[11px] bg-transparent border border-transparent rounded px-1 py-0.5 outline-none font-mono hover:border-border focus:border-ring focus:bg-background"
                  />
                </td>
                <td className="px-2 py-0.5">
                  {r.type !== 'custom' ? (
                    <span className={cn('text-[9px] px-1.5 py-px rounded uppercase tracking-wider font-semibold', TYPE_COLOUR[r.type])}>
                      {TYPE_LABEL[r.type] ?? r.type}
                    </span>
                  ) : (
                    <select
                      value={r.type === 'custom' ? (r.userType ?? 'rules') : r.type}
                      onChange={ev => updateEntry(r.id, 'userType', ev.target.value)}
                      className="text-[9px] bg-background border border-border rounded px-1 py-px outline-none"
                    >
                      <option value="rules">Rules</option>
                      <option value="ti">TI</option>
                      <option value="mdx">MDX</option>
                    </select>
                  )}
                </td>
                <td className="px-2 py-0.5">
                  <span className={cn(
                    'text-[9px] px-1 py-px rounded uppercase tracking-wider font-semibold',
                    r.source === 'ibm'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                  )}>
                    {r.source === 'ibm' ? 'IBM' : 'User'}
                  </span>
                </td>
                <td className="px-1 py-0.5 text-center">
                  <button onClick={() => removeEntry(r.id)} className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive" title={r.source === 'ibm' ? 'Disable default' : 'Remove'}>
                    <Trash2 size={10} />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-muted-foreground">No entries match</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border shrink-0">
        <button
          onClick={addEntry}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Plus size={11} /> Add mapping
        </button>
        <button
          onClick={handleSave}
          className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
        >
          <Save size={11} /> Save
        </button>
      </div>
    </div>
  )
}

// ── Modal wrapper — kept for any direct standalone usage ────────────────────
export default function NamingDictionary({ open, onClose }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-lg w-[680px] max-w-[92vw] h-[600px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold">Naming Dictionary</h2>
            <p className="text-[10px] text-muted-foreground">Case-insensitive — controls how the formatter capitalises identifiers</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground"><X size={14} /></button>
        </div>
        <NamingDictionaryPanel onClose={onClose} />
      </div>
    </div>
  )
}
