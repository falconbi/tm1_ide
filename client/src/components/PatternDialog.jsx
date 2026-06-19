import { useState, useMemo, useEffect } from 'react'
import { X, ChevronRight } from 'lucide-react'
import { PATTERN_CATEGORIES } from '@/lib/ti-patterns'
import { cn } from '@/lib/utils'
import { addOrUpdateCustomSnippet } from '@/lib/custom-snippets'
import { useStore } from '@/store'

const SECTION_LABELS = {
  PrologProcedure:   'Prolog',
  MetaDataProcedure: 'Metadata',
  DataProcedure:     'Data',
  EpilogProcedure:   'Epilog',
}

const apiFetch = (path) => {
  const token = localStorage.getItem('tm1-token') ?? ''
  return fetch(path, { headers: { 'x-ide-token': token } }).then(r => r.json())
}

const BASE = 'w-full bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring'

// ── Dynamic dimension dropdown ─────────────────────────────────────────────────
function DimSelectField({ def, value, onChange, server }) {
  const [dims,    setDims]    = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!server) return
    setLoading(true)
    apiFetch(`/api/dimensions?server=${encodeURIComponent(server)}`)
      .then(d => {
        setDims(Array.isArray(d) ? d.filter(n => !n.startsWith('}')) : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [server])

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{def.label}</label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={BASE}>
        <option value="">{loading ? 'Loading…' : '— select —'}</option>
        {dims.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  )
}

// ── Dynamic attribute dropdown (depends on a dim-select field) ─────────────────
function AttrSelectField({ def, value, onChange, server, allValues }) {
  const depValue = def.dependsOn ? (allValues?.[def.dependsOn] ?? '') : ''
  const [attrs,   setAttrs]   = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!server || !depValue) { setAttrs([]); return }
    setLoading(true)
    apiFetch(`/api/dimension/attributes?server=${encodeURIComponent(server)}&dimension=${encodeURIComponent(depValue)}`)
      .then(d => {
        // Show String and Alias-type attributes as valid sources
        setAttrs(Array.isArray(d) ? d.filter(a => a.type === 'S' || a.type === 'A') : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [server, depValue])

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{def.label}</label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className={BASE}
        disabled={!depValue}
      >
        <option value="">
          {!depValue ? '— select dimension first —' : loading ? 'Loading…' : '— select —'}
        </option>
        {attrs.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
      </select>
    </div>
  )
}

// ── Generic field (text / textarea / select) ───────────────────────────────────
function Field({ def, value, onChange, server, allValues }) {
  if (def.type === 'dim-select')  return <DimSelectField  def={def} value={value} onChange={onChange} server={server} />
  if (def.type === 'attr-select') return <AttrSelectField def={def} value={value} onChange={onChange} server={server} allValues={allValues} />

  if (def.type === 'textarea') return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{def.label}</label>
      <textarea
        rows={3}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={def.placeholder ?? ''}
        className={cn(BASE, 'resize-none')}
      />
    </div>
  )

  if (def.type === 'select') return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{def.label}</label>
      <select
        value={value ?? def.options[0]}
        onChange={e => onChange(e.target.value)}
        className={BASE}
      >
        {def.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{def.label}</label>
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={def.placeholder ?? ''}
        className={BASE}
      />
    </div>
  )
}

export default function PatternDialog({ onInsert, onClose }) {
  const server = useStore(s => s.server)

  const [activeCat,     setActiveCat]     = useState(PATTERN_CATEGORIES[0].id)
  const [activePattern, setActivePattern] = useState(PATTERN_CATEGORIES[0].patterns[0].id)
  const [fields,        setFields]        = useState({})
  const [savedMsg,      setSavedMsg]      = useState('')

  useEffect(() => {
    if (!savedMsg) return
    const t = setTimeout(() => setSavedMsg(''), 3500)
    return () => clearTimeout(t)
  }, [savedMsg])

  const category = PATTERN_CATEGORIES.find(c => c.id === activeCat)
  const pattern  = category?.patterns.find(p => p.id === activePattern)
    ?? PATTERN_CATEGORIES.flatMap(c => c.patterns).find(p => p.id === activePattern)

  const setField = (key, val) => setFields(f => ({ ...f, [key]: val }))

  const generated = useMemo(() => {
    if (!pattern) return {}
    try { return pattern.generate(fields) } catch { return {} }
  }, [pattern, fields])

  const sections = Object.entries(generated).filter(([, v]) => v?.trim())

  const selectPattern = (catId, patternId) => {
    setActiveCat(catId)
    setActivePattern(patternId)
    setFields({})
  }

  const handleSaveSnippets = () => {
    let count = 0
    for (const [key, code] of sections) {
      if (!code?.trim()) continue
      const sectionLabel = SECTION_LABELS[key] ?? key
      addOrUpdateCustomSnippet({
        trigger: `${pattern.id}-${key.replace('Procedure', '').toLowerCase()}`,
        label: `${pattern.label} — ${sectionLabel}`,
        description: pattern.description,
        category: 'TI Patterns',
        language: 'ti',
        code,
        custom: true,
      })
      count++
    }
    setSavedMsg(`Saved ${count} snippet(s) to My Snippets.`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="bg-background border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 820, height: 580 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-semibold">TI Patterns</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">

          {/* Left: category + pattern list */}
          <div className="w-48 shrink-0 border-r border-border flex flex-col overflow-y-auto">
            {PATTERN_CATEGORIES.map(cat => (
              <div key={cat.id}>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 bg-muted/30 border-b border-border">
                  {cat.label}
                </div>
                {cat.patterns.map(p => (
                  <button
                    key={p.id}
                    onClick={() => selectPattern(cat.id, p.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs border-b border-border/50 transition-colors flex items-center justify-between gap-1',
                      activePattern === p.id
                        ? 'bg-primary/10 text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    <span>{p.label}</span>
                    {activePattern === p.id && <ChevronRight size={10} className="shrink-0 text-primary" />}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Right: form + preview */}
          <div className="flex-1 min-w-0 flex flex-col">

            {pattern && (
              <>
                {/* Pattern description */}
                <div className="px-4 py-2 border-b border-border shrink-0">
                  <p className="text-xs text-muted-foreground">{pattern.description}</p>
                </div>

                <div className="flex flex-1 min-h-0">

                  {/* Fields */}
                  <div className="w-56 shrink-0 border-r border-border p-4 space-y-3 overflow-y-auto">
                    {pattern.fields.map(f => (
                      <Field
                        key={f.key}
                        def={f}
                        value={fields[f.key]}
                        onChange={v => setField(f.key, v)}
                        server={server}
                        allValues={fields}
                      />
                    ))}
                  </div>

                  {/* Code preview */}
                  <div className="flex-1 min-w-0 overflow-auto p-4 space-y-3">
                    {sections.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Fill in the fields to see a preview.</p>
                    ) : sections.map(([key, code]) => (
                      <div key={key}>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                          {SECTION_LABELS[key] ?? key}
                        </div>
                        <pre className="text-xs font-mono text-foreground bg-muted rounded p-3 overflow-auto whitespace-pre leading-relaxed">
                          {code}
                        </pre>
                      </div>
                    ))}
                  </div>

                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border shrink-0 gap-3">
          <p className="text-xs text-muted-foreground truncate">
            {savedMsg
              ? <span className="text-emerald-600 dark:text-emerald-400 italic">{savedMsg}</span>
              : sections.length > 0
                ? `Inserts into: ${sections.map(([k]) => SECTION_LABELS[k]).join(', ')}`
                : 'No code generated yet'}
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleSaveSnippets}
              disabled={sections.length === 0}
              title="Save generated sections as custom snippets in the TI snippet panel"
              className="px-3 py-1.5 text-xs rounded border border-border disabled:opacity-40 hover:bg-muted transition-colors"
            >
              + My Snippets
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { onInsert(generated); onClose() }}
              disabled={sections.length === 0}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              Insert Pattern
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
