import { useState } from 'react'
import { useDims, useSaveSubset } from '@/hooks/useApi'
import { useStore } from '@/store'
import { MDX_PATTERN_CATEGORIES } from '@/lib/tm1-mdx-primer-patterns'

export default function MDXSubsetBuilder({
  tab,
  server: serverProp,
  dimension: dimensionProp,
  initialMDX = '',
  onChange,
  readOnly = false,
}) {
  const { server: storeServer } = useStore()
  const server = serverProp || tab?.server || storeServer
  const [selectedDimension, setSelectedDimension] = useState(dimensionProp || tab?.dimension || '')
  const dimension = selectedDimension

  const { data: dims = [] } = useDims(server)
  const saveSubset = useSaveSubset()

  const [mdx, setMdx] = useState(initialMDX || (dimension ? `{TM1SUBSETALL([${dimension}].[${dimension}])}` : ''))
  const [members, setMembers] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState(null)
  const [subsetName, setSubsetName] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [collapsedCats, setCollapsedCats] = useState(() =>
    Object.fromEntries(MDX_PATTERN_CATEGORIES.map(c => [c.category, true]))
  )

  const handleChange = (newMdx) => {
    setMdx(newMdx)
    onChange?.(newMdx)
  }

  const handlePreview = async () => {
    if (!server || !dimension || !mdx.trim()) {
      setError('Server and dimension are required for preview')
      return
    }
    setPreviewLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/subset/preview?server=${encodeURIComponent(server)}&dimension=${encodeURIComponent(dimension)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ide-token': localStorage.getItem('tm1-token') ?? '' },
        body: JSON.stringify({ mdx }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Preview failed')
      setMembers(data.members || [])
    } catch (e) {
      setError(e.message)
      setMembers(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleSave = async () => {
    if (!subsetName.trim() || !dimension || !server) return
    setSavedMsg('')
    try {
      await saveSubset.mutateAsync({ server, dimension, name: subsetName.trim(), mdx })
      setSavedMsg(`✓ Saved as "${subsetName.trim()}"`)
      setTimeout(() => setSavedMsg(''), 3000)
    } catch (e) {
      setSavedMsg(`Error: ${e.message}`)
    }
  }

  const toggleCat = (cat) => setCollapsedCats(p => ({ ...p, [cat]: !p[cat] }))

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-4 py-2 border-b border-border bg-muted/30 shrink-0 flex items-center justify-between">
        <div className="font-semibold text-sm">Subset MDX Builder</div>
        <div className="text-xs text-muted-foreground">
          Server: <span className="font-mono">{server || '—'}</span>
        </div>
      </div>

      {/* Dimension selector for standalone use */}
      {!dimensionProp && !tab?.dimension && (
        <div className="px-4 py-2 border-b border-border bg-muted/10 shrink-0 flex items-center gap-3">
          <span className="text-xs font-medium shrink-0">Dimension:</span>
          <select value={selectedDimension}
            onChange={e => { setSelectedDimension(e.target.value); if (!mdx.trim() || mdx.includes('TM1SUBSETALL')) setMdx(`{TM1SUBSETALL([${e.target.value}].[${e.target.value}])}`) }}
            className="px-2 py-1 border rounded bg-background text-xs min-w-[200px]">
            <option value="">Select a dimension…</option>
            {dims.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/20 shrink-0 flex-wrap">
        <span className="text-[11px] text-muted-foreground">{dimension ? `[${dimension}]` : 'No dimension'}</span>
        <div className="flex-1" />
        <button onClick={handlePreview} disabled={previewLoading || !server || !dimension || !mdx.trim()}
          className="px-2 py-1 text-[11px] rounded border hover:bg-muted disabled:opacity-50">
          {previewLoading ? 'Previewing…' : 'Preview'}
        </button>
        <input value={subsetName} onChange={e => setSubsetName(e.target.value)} placeholder="Subset name…"
          className="px-2 py-1 text-[11px] border rounded bg-background w-36" />
        <button onClick={handleSave} disabled={!subsetName.trim() || !dimension || saveSubset.isPending}
          className="px-2 py-1 text-[11px] bg-primary text-primary-foreground rounded disabled:opacity-50">
          {saveSubset.isPending ? 'Saving…' : 'Save Subset'}
        </button>
        {savedMsg && <span className="text-[11px] text-green-400">{savedMsg}</span>}
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Editor + Preview */}
        <div className="flex-1 flex flex-col p-3 overflow-hidden">
          <textarea value={mdx} onChange={e => handleChange(e.target.value)} readOnly={readOnly}
            className="flex-1 font-mono text-sm resize-none bg-background border rounded p-3 focus:outline-none"
            placeholder={`{TM1SUBSETALL([${dimension || 'Dim'}].[${dimension || 'Dim'}])}`} />

          {error && (
            <div className="mt-2 p-2 text-xs text-red-400 bg-red-950/30 border border-red-900 rounded">{error}</div>
          )}

          {members !== null && (
            <div className="mt-2 border rounded bg-background p-2 max-h-[200px] overflow-auto">
              {members.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">
                  No members returned — valid expression but empty set. If using USERNAME or STRTOMEMBER, the API user may have no data in that cube.
                </div>
              ) : (
                <>
                  <div className="text-xs font-medium mb-1.5 text-muted-foreground">Preview ({members.length} members)</div>
                  <div className="flex flex-wrap gap-1 text-xs">
                    {members.slice(0, 100).map((m, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-muted rounded font-mono">{m.Name || m.name || m}</span>
                    ))}
                    {members.length > 100 && <span className="text-muted-foreground self-center">+{members.length - 100} more…</span>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Pattern sidebar — grouped, collapsed by default */}
        {dimension && (
          <div className="w-72 border-l border-border flex flex-col bg-muted/10 overflow-hidden">
            <div className="px-3 py-2 border-b text-xs font-semibold bg-muted/50 shrink-0">MDX Patterns</div>
            <div className="flex-1 overflow-auto">
              {MDX_PATTERN_CATEGORIES.map(cat => (
                <div key={cat.category} className="border-b border-border/40 last:border-0">
                  <button onClick={() => toggleCat(cat.category)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-medium hover:bg-muted/50 transition-colors">
                    <span>{cat.category}</span>
                    <span className="text-muted-foreground text-[10px]">{collapsedCats[cat.category] ? '▶' : '▼'}</span>
                  </button>
                  {!collapsedCats[cat.category] && (
                    <div className="px-2 pb-2 space-y-1.5">
                      {cat.patterns.map((p, idx) => (
                        <div key={idx} className="border rounded p-2 bg-background hover:bg-muted/50 text-xs">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{p.description}</div>
                          {p.example && <div className="text-[10px] text-sky-400/80 mt-0.5 italic">{p.example}</div>}
                          <button
                            onClick={() => { const expr = p.mdx(dimension); handleChange(expr.startsWith('{') ? expr : `{${expr}}`) }}
                            className="mt-1.5 text-[10px] px-2 py-0.5 border rounded hover:bg-primary hover:text-primary-foreground transition-colors">
                            Insert
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
