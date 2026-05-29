import { useState, useMemo } from 'react'
import { useDims } from '@/hooks/useApi'
import { useStore } from '@/store'
import { MDX_PRIMER_PATTERNS_FLAT } from '@/lib/tm1-mdx-primer-patterns'

/**
 * MDXSubsetBuilder
 *
 * Reusable component for building TM1 subset MDX expressions.
 * Can be used:
 *  - Standalone (new "Subset MDX Builder" tab)
 *  - Embedded inside Guided MDX Builder (for rich per-axis set expressions)
 *  - As the MDX mode inside the existing SubsetEditor
 *
 * Props:
 *  - server
 *  - dimension (required for context-aware features)
 *  - initialMDX
 *  - onChange
 *  - onPreview (optional callback for member preview)
 *  - readOnly
 */
export default function MDXSubsetBuilder({
  tab,
  server: serverProp,
  dimension: dimensionProp,
  initialMDX = '',
  onChange,
  onPreview,
  readOnly = false,
}) {
  const { server: storeServer } = useStore()
  const server = serverProp || tab?.server || storeServer
  const [selectedDimension, setSelectedDimension] = useState(dimensionProp || tab?.dimension || '')
  const dimension = selectedDimension

  const { data: dims = [] } = useDims(server)

  const [mdx, setMdx] = useState(initialMDX || (dimension ? `{TM1SubsetAll([${dimension}])}` : ''))
  const [members, setMembers] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState(null)

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
        headers: { 'Content-Type': 'application/json' },
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

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-4 py-3 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center justify-between">
          <div className="font-semibold flex items-center gap-3">
            Subset MDX Builder
            <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary">BETA</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Server: <span className="font-mono">{server || '—'}</span>
          </div>
        </div>
      </div>

      {/* Dimension selector for standalone use */}
      {!dimensionProp && !tab?.dimension && (
        <div className="px-4 py-3 border-b border-border bg-muted/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="text-sm font-medium">Dimension:</div>
            <select
              value={selectedDimension}
              onChange={(e) => {
                const newDim = e.target.value
                setSelectedDimension(newDim)
                if (!mdx.trim() || mdx.includes('TM1SubsetAll')) {
                  setMdx(`{TM1SubsetAll([${newDim}])}`)
                }
              }}
              className="px-3 py-1 border rounded bg-background text-sm min-w-[220px]"
            >
              <option value="">Select a dimension…</option>
              {dims.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <div className="text-xs text-muted-foreground">
              (or pass a dimension when opening from another tool)
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/20 shrink-0 text-xs">
        <div>MDX Expression {dimension ? `for [${dimension}]` : ''}</div>
        <button
          onClick={handlePreview}
          disabled={previewLoading || !server || !dimension || !mdx.trim()}
          className="px-3 py-1 rounded border hover:bg-muted disabled:opacity-50 flex items-center gap-1"
        >
          {previewLoading ? 'Previewing…' : 'Preview Members'}
        </button>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Main Editor + Preview */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden">
          <textarea
            value={mdx}
            onChange={(e) => handleChange(e.target.value)}
            readOnly={readOnly}
            className="flex-1 font-mono text-sm resize-none bg-background border rounded p-3 focus:outline-none"
            placeholder="{TM1SubsetAll([YourDim])}&#10;or more advanced MDX like:&#10;{Filter(TM1SubsetAll([YourDim]), [YourDim].[YourDim].CurrentMember.Properties('Attribute') = 'Value')}"
          />

          {error && (
            <div className="mt-2 p-2 text-xs text-red-400 bg-red-950/30 border border-red-900 rounded">
              {error}
            </div>
          )}

          {members && members.length > 0 && (
            <div className="mt-3 border rounded bg-background p-3 max-h-[220px] overflow-auto">
              <div className="text-xs font-medium mb-2 text-muted-foreground">
                Preview ({members.length} members)
              </div>
              <div className="flex flex-wrap gap-1.5 text-sm">
                {members.slice(0, 100).map((m, i) => (
                  <span key={i} className="px-2 py-0.5 bg-muted rounded text-xs font-mono">
                    {m.Name || m.name || m}
                  </span>
                ))}
                {members.length > 100 && (
                  <span className="text-muted-foreground text-xs self-center">+{members.length - 100} more…</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Primer Patterns Sidebar (Foundation from the classic MDX Primer) */}
        {dimension && (
          <div className="w-80 border-l border-border flex flex-col bg-muted/10 overflow-hidden">
            <div className="px-3 py-2 border-b text-xs font-semibold bg-muted/50 shrink-0">
              MDX Primer Patterns
            </div>
            <div className="flex-1 overflow-auto p-2 text-xs space-y-3">
              {MDX_PRIMER_PATTERNS_FLAT.slice(0, 12).map((p, idx) => (
                <div key={idx} className="border rounded p-2 bg-background hover:bg-muted/50">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{p.description}</div>
                  <button
                    onClick={() => {
                      const expr = p.mdx(dimension);
                      const wrapped = expr.startsWith('{') ? expr : `{${expr}}`;
                      setMdx(wrapped);
                    }}
                    className="mt-1.5 text-[10px] px-2 py-0.5 border rounded hover:bg-primary hover:text-primary-foreground"
                  >
                    Insert Pattern
                  </button>
                </div>
              ))}
              <div className="text-[10px] text-muted-foreground px-1">
                (Expanded catalog coming in next iteration — currently shows key patterns from the classic Primer)
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-border bg-muted/20 text-[10px] text-muted-foreground shrink-0">
        Rich templates, AI generation, and advanced patterns will be added here (modeled after the existing SubsetEditor experience).
      </div>
    </div>
  )
}
