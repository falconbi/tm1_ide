import { useState, useMemo, useRef, useEffect } from 'react'
import { ChevronDown, ChevronRight, Search, Plus, Upload, Download, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  loadCustomSnippets, addOrUpdateCustomSnippet, deleteCustomSnippet,
  exportSnippetsFile, parseSnippetImport,
} from '@/lib/custom-snippets'

function cleanInsert(code) {
  return code
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{0\}/g, '')
    .replace(/\$0/g, '')
}

const EMPTY_FORM = { trigger: '', label: '', description: '', category: 'Custom', code: '' }

function SnippetForm({ initial, language, categories, onSave, onCancel }) {
  const [form, setForm] = useState(initial ?? EMPTY_FORM)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const valid = form.trigger.trim() && form.label.trim() && form.code.trim()
  const listId = `snippet-cats-${language}`

  return (
    <div className="border-b border-border bg-muted/20 p-3 space-y-2 shrink-0">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Trigger</label>
          <input
            value={form.trigger}
            onChange={e => set('trigger', e.target.value.replace(/\s+/g, '-').toLowerCase())}
            placeholder="my-snippet"
            className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Category</label>
          <input
            list={listId}
            value={form.category}
            onChange={e => set('category', e.target.value)}
            placeholder="Custom"
            className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <datalist id={listId}>
            {categories.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Label</label>
        <input
          value={form.label}
          onChange={e => set('label', e.target.value)}
          placeholder="My Snippet"
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Description</label>
        <input
          value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="What this snippet does"
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Code</label>
        <textarea
          value={form.code}
          onChange={e => set('code', e.target.value)}
          rows={4}
          placeholder={`Code to insert.\nUse \${1:placeholder} for tab stops, \${0} for final cursor.`}
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors"
        >Cancel</button>
        <button
          onClick={() => valid && onSave(form)}
          disabled={!valid}
          className="px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
        >Save</button>
      </div>
    </div>
  )
}

export default function SnippetPanel({ snippets, language, onInsert }) {
  const [custom, setCustom] = useState(() =>
    loadCustomSnippets().filter(s => s.language === language)
  )
  const [editing, setEditing] = useState(null)   // null | 'new' | <snippet object>
  const [openCats, setOpenCats] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [msg, setMsg] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 3500)
    return () => clearTimeout(t)
  }, [msg])

  const refreshCustom = () =>
    setCustom(loadCustomSnippets().filter(s => s.language === language))

  const allSnippets = useMemo(() => [...snippets, ...custom], [snippets, custom])
  const categories  = useMemo(() => [...new Set(allSnippets.map(s => s.category))], [allSnippets])

  const toggleCat = (cat) => setOpenCats(prev => {
    const next = new Set(prev)
    next.has(cat) ? next.delete(cat) : next.add(cat)
    return next
  })

  const q = query.toLowerCase().trim()

  const filtered = useMemo(() =>
    q
      ? allSnippets.filter(s =>
          s.label.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.trigger.toLowerCase().includes(q)
        )
      : allSnippets
  , [allSnippets, q])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const s of filtered) {
      if (!map.has(s.category)) map.set(s.category, [])
      map.get(s.category).push(s)
    }
    return map
  }, [filtered])

  const handleSave = (form) => {
    addOrUpdateCustomSnippet({ ...form, language, custom: true })
    refreshCustom()
    setEditing(null)
  }

  const handleDelete = (s) => {
    deleteCustomSnippet(s.trigger, language)
    refreshCustom()
  }

  const handleExport = () => {
    if (custom.length === 0) { setMsg('No custom snippets to export yet.'); return }
    exportSnippetsFile(language, custom)
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const incoming = parseSnippetImport(text)
        .filter(s => s.language === language)
        .map(s => ({ ...s, language, custom: true }))
      // merge: incoming trigger wins over existing custom, built-ins unaffected
      for (const s of incoming) addOrUpdateCustomSnippet(s)
      refreshCustom()
      setMsg(`Imported ${incoming.length} snippet(s).`)
    } catch (err) {
      setMsg(`Import failed: ${err.message}`)
    }
    e.target.value = ''
  }

  return (
    <div className="flex flex-col h-full">

      {/* Header + toolbar */}
      <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-center gap-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-1">Snippets</span>
        <button
          onClick={() => setEditing(editing === 'new' ? null : 'new')}
          title="New custom snippet"
          className={cn(
            'p-1 rounded transition-colors',
            editing === 'new'
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        ><Plus size={11} /></button>
        <button
          onClick={() => fileRef.current?.click()}
          title="Import snippets from JSON file"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        ><Upload size={11} /></button>
        <button
          onClick={handleExport}
          title="Export custom snippets to JSON file"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        ><Download size={11} /></button>
        <input ref={fileRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
      </div>

      {/* Create / edit form */}
      {editing !== null && (
        <SnippetForm
          initial={editing === 'new' ? null : editing}
          language={language}
          categories={categories}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Status message */}
      {msg && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border bg-muted/30 shrink-0 italic">
          {msg}
        </div>
      )}

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 bg-muted rounded px-2 py-1">
          <Search size={10} className="text-muted-foreground shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter snippets…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60 min-w-0"
          />
        </div>
      </div>

      {/* Snippet list */}
      <div className="flex-1 overflow-auto">
        {grouped.size === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground italic">No snippets match.</div>
        )}
        {[...grouped.entries()].map(([cat, items]) => {
          const open = q ? true : openCats.has(cat)
          return (
            <div key={cat}>
              <button
                onClick={() => toggleCat(cat)}
                className="flex items-center gap-1.5 w-full px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground border-b border-border/50 sticky top-0 bg-sidebar z-10"
              >
                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span className="flex-1 text-left">{cat}</span>
                <span className="font-mono normal-case tracking-normal text-muted-foreground/50">{items.length}</span>
              </button>
              {open && (
                <div className="py-0.5">
                  {items.map(s => (
                    <div key={`${s.trigger}-${s.language}`} className="group border-b border-border/20">
                      <div className="flex items-start gap-1 px-3 py-1.5 hover:bg-sidebar-accent">
                        <button
                          onClick={() => onInsert(cleanInsert(s.code))}
                          className="flex-1 text-left min-w-0"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-sidebar-foreground group-hover:text-sidebar-accent-foreground truncate">
                              {s.label}
                            </span>
                            <kbd className="ml-auto text-[9px] px-1 py-0.5 rounded bg-muted border border-border text-muted-foreground font-mono shrink-0">
                              {s.trigger}
                            </kbd>
                          </div>
                          <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{s.description}</div>
                        </button>
                        {s.custom && (
                          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
                            <button
                              onClick={() => setEditing(s)}
                              title="Edit snippet"
                              className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                            ><Pencil size={10} /></button>
                            <button
                              onClick={() => handleDelete(s)}
                              title="Delete snippet"
                              className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                            ><Trash2 size={10} /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
