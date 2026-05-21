import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAttrGrid, useCreateAttrDef, useWriteElementAttribute, useDimAttributes, useSubsets } from '@/hooks/useApi'
import { toast } from 'sonner'
import { Search, X, Loader2, Save, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const enc = encodeURIComponent
const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() })

const TYPES = [
  { value: '', label: 'None' },
  { value: 'Static', label: 'Static' },
  { value: 'Subset', label: 'Subset' },
  { value: 'Dimension', label: 'Full Dimension' },
]

function parse(v) {
  if (!v) return { type: '', params: [] }
  const i = v.indexOf(':')
  if (i === -1) return { type: '', params: [] }
  const prefix = v.slice(0, i), rest = v.slice(i + 1)
  if (prefix === 'Static')    return { type: 'Static',    params: rest.split(':') }
  if (prefix === 'Subset')    return { type: 'Subset',    params: rest.split(':') }
  if (prefix === 'Dimension') return { type: 'Dimension', params: [rest] }
  return { type: '', params: [] }
}

function format(type, params) {
  if (!type) return ''
  if (type === 'Static')    return `Static:${params.join(':')}`
  if (type === 'Subset')    return `Subset:${params.join(':')}`
  if (type === 'Dimension') return `Dimension:${params[0] ?? ''}`
  return ''
}

export default function PicklistBuilder({ server, dim, onClose }) {
  const { data: attrGrid, isLoading: loadingGrid, refetch: refetchGrid } = useAttrGrid(server, dim)
  const { data: dimAttrs } = useDimAttributes(server, dim)
  const { data: subsets } = useSubsets(server, dim)
  const [allDims, setAllDims] = useState([])
  const createAttr = useCreateAttrDef()
  const writeAttr = useWriteElementAttribute()
  const [search, setSearch] = useState('')
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(new Set())
  const [saved, setSaved] = useState(new Set())

  const picklistAttrExists = dimAttrs?.some(a => a.Name === 'Picklist')

  useEffect(() => {
    get(`/api/dimensions?server=${enc(server)}`).then(d => setAllDims(d ?? [])).catch(() => {})
  }, [server])

  const elements = attrGrid?.elements ?? []
  const values = attrGrid?.values ?? {}

  const filtered = useMemo(() => {
    if (!search.trim()) return elements
    const q = search.toLowerCase()
    return elements.filter(e => e.Name.toLowerCase().includes(q))
  }, [search, elements])

  const stateOf = (name) => edits[name] ?? parse(values[name]?.Picklist)

  const setType = (name, type) => {
    const cur = stateOf(name)
    setEdits(p => ({ ...p, [name]: {
      type,
      params: type === cur.type ? cur.params
        : type === 'Static' ? ['']
        : type === 'Subset' ? [dim, '']
        : type === 'Dimension' ? ['']
        : []
    }}))
  }

  const setParams = (name, params) => {
    const cur = stateOf(name)
    setEdits(p => ({ ...p, [name]: { ...cur, params } }))
  }

  const handleSave = async () => {
    if (!picklistAttrExists) {
      try {
        await createAttr.mutateAsync({ server, dimension: dim, name: 'Picklist', type: 'String' })
        toast.success('Picklist attribute created')
      } catch (e) {
        toast.error('Failed to create Picklist attribute'); return
      }
    }
    const entries = Object.entries(edits)
    for (const [name, st] of entries) {
      setSaving(p => new Set(p).add(name))
      try {
        await writeAttr.mutateAsync({ server, dimension: dim, element: name, attribute: 'Picklist', value: format(st.type, st.params), type: 'S' })
        setSaved(p => new Set(p).add(name))
      } catch (e) {
        toast.error(`Failed for ${name}: ${e.message}`)
      }
      setSaving(p => { const n = new Set(p); n.delete(name); return n })
    }
    toast.success(`Saved picklists for ${entries.length} element${entries.length !== 1 ? 's' : ''}`)
    refetchGrid()
  }

  const hasChanges = Object.keys(edits).length > 0

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg w-[900px] max-h-[85vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-semibold">Picklist Builder — {dim}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 shrink-0 flex-wrap">
          {!picklistAttrExists && (
            <span className="text-xs text-amber-400 font-medium">"Picklist" attribute will be created on save.</span>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-1 bg-background border border-border rounded px-1.5 py-0.5">
            <Search size={10} className="text-muted-foreground shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Filter elements…"
              className="text-xs bg-transparent outline-none w-28 placeholder:text-muted-foreground" />
            {search && <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground shrink-0"><X size={9} /></button>}
          </div>
          <button onClick={handleSave} disabled={!hasChanges || saving.size > 0}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity">
            {saving.size > 0 ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            Save
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loadingGrid ? (
            <div className="flex items-center justify-center p-8"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50 sticky top-0">
                  <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Element</th>
                  <th className="text-left px-3 py-1.5 font-medium text-muted-foreground w-28">Type</th>
                  <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Value</th>
                  <th className="text-center px-3 py-1.5 font-medium text-muted-foreground w-12">St.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(el => {
                  const st = stateOf(el.Name)
                  const isSaving = saving.has(el.Name)
                  const isSaved = saved.has(el.Name)
                  return (
                    <tr key={el.Name} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="px-3 py-1 font-mono truncate max-w-40">{el.Name}</td>
                      <td className="px-3 py-1">
                        <select value={st.type} onChange={e => setType(el.Name, e.target.value)}
                          className="w-full text-xs bg-muted border border-border rounded px-1.5 py-0.5 outline-none focus:border-primary">
                          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1">
                        {st.type === 'Static' && (
                          <input value={st.params.join(':')} onChange={e => setParams(el.Name, e.target.value.split(':'))}
                            placeholder="Item1:Item2:Item3"
                            className="w-full text-xs font-mono bg-muted border border-border rounded px-1.5 py-0.5 outline-none focus:border-primary" />
                        )}
                        {st.type === 'Subset' && (
                          <div className="flex gap-1">
                            <select value={st.params[0] ?? ''} onChange={e => setParams(el.Name, [e.target.value, ''])}
                              className="flex-1 text-xs bg-muted border border-border rounded px-1.5 py-0.5 outline-none focus:border-primary">
                              <option value="">Dim…</option>
                              {allDims.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <input value={st.params[1] ?? ''} onChange={e => setParams(el.Name, [st.params[0] ?? '', e.target.value])}
                              placeholder="Subset name"
                              list={`subsets-${el.Name}`}
                              className="flex-1 text-xs font-mono bg-muted border border-border rounded px-1.5 py-0.5 outline-none focus:border-primary" />
                            <datalist id={`subsets-${el.Name}`}>
                              {(st.params[0] === dim ? subsets : []).map(s => <option key={s.Name} value={s.Name} />)}
                            </datalist>
                          </div>
                        )}
                        {st.type === 'Dimension' && (
                          <select value={st.params[0] ?? ''} onChange={e => setParams(el.Name, [e.target.value])}
                            className="w-full text-xs bg-muted border border-border rounded px-1.5 py-0.5 outline-none focus:border-primary">
                            <option value="">Select dimension…</option>
                            {allDims.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        )}
                        {!st.type && <span className="text-muted-foreground/50 italic">—</span>}
                      </td>
                      <td className="px-3 py-1 text-center">
                        {isSaving && <Loader2 size={11} className="animate-spin inline text-muted-foreground" />}
                        {isSaved && <Check size={11} className="inline text-green-400" />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/30 shrink-0 text-xs text-muted-foreground">
          <span>{filtered.length} / {elements.length} elements</span>
          <span>{Object.keys(edits).length} edited</span>
        </div>
      </div>
    </div>
  )
}
