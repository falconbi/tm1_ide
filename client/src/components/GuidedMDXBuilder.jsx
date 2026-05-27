import { useState, useMemo, useEffect } from 'react'
import { useCubes, useCubeDimensions, useDims, useDimAttributes, useAttributeValues } from '@/hooks/useApi'
import { useStore } from '@/store'
import { ArrowLeft, ArrowRight, Play, Loader2, Copy, X, Check, Code2, ExternalLink } from 'lucide-react'
import MonacoEditor from '@monaco-editor/react'
import { cn } from '@/lib/utils'
import ResultGrid from '@/components/mdx/ResultGrid'

const WRAPPERS = {
  'all':         (dim, inner) => `{TM1SUBSETALL([${dim}].[${dim}])}`,
  'leaf':        (dim, inner) => `{TM1FILTERBYLEVEL(${inner}, 0)}`,
  'consol':      (dim, inner) => `{TM1FILTERBYLEVEL(${inner}, 1)}`,
  'sort-asc':    (dim, inner) => `{TM1SORT(${inner}, ASC)}`,
  'sort-desc':   (dim, inner) => `{TM1SORT(${inner}, DESC)}`,
  'sort-index-a':(dim, inner) => `{TM1SORTBYINDEX(${inner}, ASC)}`,
  'sort-index-d':(dim, inner) => `{TM1SORTBYINDEX(${inner}, DESC)}`,
  'top10':       (dim, inner) => `{TOPCOUNT(${inner}, 10)}`,
  'top5':        (dim, inner) => `{TOPCOUNT(${inner}, 5)}`,
  'bottom10':    (dim, inner) => `{BOTTOMCOUNT(${inner}, 10)}`,
  'head5':       (dim, inner) => `{HEAD(${inner}, 5)}`,
  'tail5':       (dim, inner) => `{TAIL(${inner}, 5)}`,
  'attr':        (dim, inner) => `{FILTER(${inner}, [${dim}].[${dim}].CURRENTMEMBER.PROPERTIES("Attr") = "Val")}`,
  'pattern':     (dim, inner) => `{TM1FILTERBYPATTERN(${inner}, "*Pat*")}`,
  'cubeval':     (dim, inner) => `{FILTER(${inner}, [Cube].([Measure]) > 0)}`,
  'cube-compare':(dim, inner) => `{FILTER(${inner}, [Cube].([${dim}].CURRENTMEMBER, [Measure]) > [Cube].([${dim}].[Member], [Measure]))}`,
  'order-num':   (dim, inner) => `{ORDER(${inner}, [Cube].([${dim}].CURRENTMEMBER, [Measure]), BDESC)}`,
  'cm-filter':   (dim, inner) => `{FILTER(${inner}, [Cube].([${dim}].CURRENTMEMBER, [Measure]) > 0)}`,
  'strtomember': (dim, inner) => `{FILTER(${inner}, [${dim}].[${dim}].CURRENTMEMBER.PROPERTIES("Attr") = STRTTOMEMBER("[${dim}].[" + [Cube].([Measure]) + "]"))}`,
  'boolean':     (dim, inner) => `{FILTER(${inner}, [Cube].([Measure]) > 0 AND [${dim}].[Attr] = "Yes")}`,
  'numeric-attr':(dim, inner) => `{FILTER(${inner}, VAL([${dim}].[${dim}].CURRENTMEMBER.PROPERTIES("Attr") + "0") = 42)}`,
  'val-filter':  (dim, inner) => `{FILTER(${inner}, VAL([${dim}].[${dim}].CURRENTMEMBER.PROPERTIES("Attr") + "0") = 42)}`,
  'except-attr': (dim, inner) => `{EXCEPT(${inner}, {FILTER(${inner}, [${dim}].[Attr] = "Skip")})}`,
  'children':    (dim, inner) => `{[${dim}].[Member].CHILDREN}`,
  'descendants': (dim, inner) => `{TM1DRILLDOWNMEMBER({[${dim}].[Member]}, ALL, RECURSIVE)}`,
  'filter-desc': (dim, inner) => `{DESCENDANTS(${inner})}`,
  'ancestors':   (dim, inner) => `{[${dim}].[Member].ANCESTORS}`,
  'parent':      (dim, inner) => `{[${dim}].[Member].PARENT}`,
  'range':       (dim, inner) => `{[${dim}].[Start]:[${dim}].[End]}`,
  'last12':      (dim, inner) => `{LASTPERIODS(12, [${dim}].[CURRENTMEMBER])}`,
  'next':        (dim, inner) => `{[${dim}].[Member].NEXTMEMBER}`,
  'union':       (dim, inner) => `{UNION(${inner}, {[${dim}].[Member]})}`,
  'intersect':   (dim, inner) => `{INTERSECT(${inner}, {[${dim}].[Member]})}`,
  'except':      (dim, inner) => `{EXCEPT(${inner}, {[${dim}].[Member]})}`,
}

const PATTERNS = [
  { id: 'all',         label: 'All members',              cat: 'Basic',        unwrapped: true },
  { id: 'leaf',        label: 'Leaf only (level 0)',      cat: 'Basic' },
  { id: 'consol',      label: 'Consolidated only',        cat: 'Basic' },
  { id: 'sort-asc',    label: 'Sort A–Z',                 cat: 'Sorting' },
  { id: 'sort-desc',   label: 'Sort Z–A',                 cat: 'Sorting' },
  { id: 'sort-index-a',label: 'Sort by index (Asc)',      cat: 'Sorting' },
  { id: 'sort-index-d',label: 'Sort by index (Desc)',     cat: 'Sorting' },
  { id: 'top10',       label: 'Top 10',                   cat: 'Ranking' },
  { id: 'top5',        label: 'Top 5',                    cat: 'Ranking' },
  { id: 'bottom10',    label: 'Bottom 10',                cat: 'Ranking' },
  { id: 'head5',       label: 'First 5 (Head)',           cat: 'Ranking' },
  { id: 'tail5',       label: 'Last 5 (Tail)',            cat: 'Ranking' },
  { id: 'attr',        label: 'Filter by attribute',      cat: 'Filtering' },
  { id: 'pattern',     label: 'Filter by name pattern',   cat: 'Filtering' },
  { id: 'cubeval',     label: 'Filter by cube value > 0', cat: 'Filtering' },
  { id: 'cube-compare',label: 'Filter vs another member',  cat: 'Filtering' },
  { id: 'order-num',   label: 'Order by cube value',      cat: 'Filtering' },
  { id: 'cm-filter',   label: 'Filter CurrentMember value',cat: 'Filtering' },
  { id: 'boolean',     label: 'NOT / AND / OR logic',     cat: 'Advanced' },
  { id: 'numeric-attr',label: 'Filter by numeric attr',   cat: 'Advanced' },
  { id: 'val-filter',  label: 'Filter by attr (VAL)',     cat: 'Advanced' },
  { id: 'strtomember', label: 'Using STRTTOMEMBER',       cat: 'Advanced' },
  { id: 'except-attr', label: 'Except by attribute',      cat: 'Set Ops' },
  { id: 'children',    label: 'Children of member',       cat: 'Hierarchy' },
  { id: 'descendants', label: 'Descendants of member',    cat: 'Hierarchy' },
  { id: 'filter-desc', label: 'Filter then Descendants',  cat: 'Hierarchy' },
  { id: 'ancestors',   label: 'Ancestors of member',      cat: 'Hierarchy' },
  { id: 'parent',      label: 'Parent of member',         cat: 'Hierarchy' },
  { id: 'range',       label: 'Range between members',    cat: 'Time / Range' },
  { id: 'last12',      label: 'Last 12 periods',          cat: 'Time / Range' },
  { id: 'next',        label: 'Next member',              cat: 'Time / Range' },
  { id: 'union',       label: 'Union of two sets',        cat: 'Set Ops' },
  { id: 'intersect',   label: 'Intersect of two sets',    cat: 'Set Ops' },
  { id: 'except',      label: 'Except (set minus)',       cat: 'Set Ops' },
]
const CATEGORIES = [...new Set(PATTERNS.map(p => p.cat))]

export default function GuidedMDXBuilder({ tab, server: serverProp, onSwitchToRaw }) {
  const server = serverProp || tab?.server
  const mode = tab?.type === 'guidedmdxsubset' ? 'subset' : 'view'
  const isSubsetMode = mode === 'subset'

  const [step, setStep] = useState(0)
  const [selectedCube, setSelectedCube] = useState(null)
  const [selectedDim, setSelectedDim] = useState('')
  const [dimConfig, setDimConfig] = useState({})
  const [filterText, setFilterText] = useState('')
  const [currentMDX, setCurrentMDX] = useState('')
  const [buildHistory, setBuildHistory] = useState([])
  const [expandedCat, setExpandedCat] = useState(null)
  const [selectedAttr, setSelectedAttr] = useState('')
  const [previewMembers, setPreviewMembers] = useState(null)
  const [previewResult, setPreviewResult] = useState(null)
  const [previewError, setPreviewError] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const { data: cubes = [] } = useCubes(server)
  const { data: cubeDims = [] } = useCubeDimensions(server, selectedCube)
  const { data: dims = [] } = useDims(server)
  const { data: dimAttrs = [] } = useDimAttributes(server, selectedDim)
  const { data: attrValues = { values: [] } } = useAttributeValues(server, selectedDim, selectedAttr)
  const { openTab } = useStore()

  // View mode axes + MDX
  const { axes, dimExpressions } = useMemo(() => {
    const cols = [], rows = [], filt = [], exprs = {}
    Object.entries(dimConfig).forEach(([dim, cfg]) => {
      if (!cfg?.axis) return
      if (cfg.axis === 'columns') cols.push(dim)
      else if (cfg.axis === 'rows') rows.push(dim)
      else if (cfg.axis === 'filter') filt.push(dim)
      exprs[dim] = `TM1SubsetAll([${dim}])`
    })
    return { axes: { columns: cols, rows: rows, filter: filt }, dimExpressions: exprs }
  }, [dimConfig])

  const generatedMDX = useMemo(() => {
    if (isSubsetMode) return currentMDX || (selectedDim ? `{TM1SUBSETALL([${selectedDim}].[${selectedDim}])}` : '')
    if (!selectedCube) return ''
    const build = (dims, axis) => dims.length ? dims.map(d => `NON EMPTY {${dimExpressions[d]}}`).join(', ') + ` ON ${axis}` : ''
    let mdx = 'SELECT'
    const colPart = build(axes.columns, 'COLUMNS')
    const rowPart = build(axes.rows, 'ROWS')
    if (colPart) mdx += `\n  ${colPart}`
    if (rowPart) mdx += `${colPart ? ',' : ''}\n  ${rowPart}`
    if (!colPart && !rowPart) mdx += '\n  NON EMPTY {TM1SubsetAll([Dim])} ON COLUMNS'
    mdx += `\nFROM [${selectedCube}]`
    if (axes.filter.length) mdx += `\nWHERE ([${axes.filter[0]}].[All])`
    return mdx
  }, [isSubsetMode, currentMDX, selectedDim, selectedCube, axes, dimExpressions])

  // Auto-preview for subset mode
  useEffect(() => {
    if (!isSubsetMode || !currentMDX || !selectedDim || step < 1) return
    if (currentMDX.includes('"Attr"') || currentMDX.includes('"Val"') || currentMDX.includes('[Start]') || currentMDX.includes('[Cube]')) return
    const timer = setTimeout(async () => {
      if (!currentMDX.trim()) return
      setPreviewLoading(true)
      try {
        const res = await fetch(`/api/subset/preview?server=${encodeURIComponent(server)}&dimension=${encodeURIComponent(selectedDim)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mdx: currentMDX }),
        })
        const d = await res.json()
        if (res.ok) setPreviewMembers(d.members || [])
        else setPreviewMembers(null)
      } catch { setPreviewMembers(null) }
      finally { setPreviewLoading(false) }
    }, 600)
    return () => clearTimeout(timer)
  }, [currentMDX, selectedDim, isSubsetMode, step, server])

  const runViewPreview = async () => {
    if (isSubsetMode) return
    setPreviewLoading(true); setPreviewError(null)
    try {
      const res = await fetch(`/api/mdx/execute?server=${encodeURIComponent(server)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mdx: generatedMDX }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Preview failed')
      setPreviewResult(d)
    } catch (e) { setPreviewError(e.message) }
    finally { setPreviewLoading(false) }
  }

  const applyPattern = (p) => {
    try {
      const inner = currentMDX || `{TM1SUBSETALL([${selectedDim}].[${selectedDim}])}`
      let result
      if (p.unwrapped) result = WRAPPERS[p.id](selectedDim, inner)
      else { const st = inner.replace(/^\{(.+)\}$/s, '$1'); result = WRAPPERS[p.id](selectedDim, st) }
      setCurrentMDX(result)
      setBuildHistory(prev => [...prev, { id: p.id, label: p.label }])
    } catch (e) { setCurrentMDX(`# ERROR: ${e.message}`) }
  }

  const copyMDX = async () => { if (generatedMDX) try { await navigator.clipboard.writeText(generatedMDX) } catch {} }
  const canNext = () => isSubsetMode ? (step === 0 ? !!selectedDim : !!currentMDX) : (step === 0 ? !!selectedCube : step === 1 ? Object.keys(dimConfig).some(k => dimConfig[k]?.axis) : true)
  const next = () => { if (canNext()) setStep(s => Math.min(s + 1, 2)) }
  const back = () => setStep(s => Math.max(s - 1, 0))

  // Monaco syntax highlighting
  const handleEditorMount = (editor, monaco) => {
    if (monaco.languages.getLanguages().find(l => l.id === 'tm1mdx')) return
    monaco.languages.register({ id: 'tm1mdx' })
    monaco.languages.setMonarchTokensProvider('tm1mdx', { tokenizer: { root: [
      [/--.*/, 'comment'], [/'[^']*'/, 'string'], [/\[([^\]]*)\]/, 'variable'],
      [/\b(SELECT|FROM|WHERE|ON|ROWS|COLUMNS|NON|EMPTY)\b/i, 'keyword'],
      [/\b(FILTER|CROSSJOIN|TOPCOUNT|BOTTOMCOUNT|ORDER|DESCENDANTS|UNION|INTERSECT|EXCEPT|LAG|LEAD)\b/i, 'type'],
      [/\b(TM1[A-Z_]+|HEAD|TAIL|LASTPERIODS|VAL|STRTOVALUE|STRTOMEMBER)\b/i, 'type'],
      [/\b(CURRENTMEMBER|PROPERTIES|CHILDREN|ANCESTORS|PARENT|NEXTMEMBER|SIBLINGS|MEMBERS)\b/i, 'variable'],
      [/[0-9]+(\.[0-9]+)?/, 'number'], [/[{}()\[\],.]/, 'operator'],
    ]}})
  }

  // Table interactive: column header click
  const colClick = (attrKey) => {
    const attrDef = dimAttrs.find(a => (a.Name || a.name) === attrKey)
    const isNumeric = (attrDef?.Type || attrDef?.type) === 'Numeric'
    const newExpr = isNumeric
      ? `VAL([${selectedDim}].[${selectedDim}].CURRENTMEMBER.PROPERTIES("${attrKey}") + "0") = 0`
      : `[${selectedDim}].[${selectedDim}].CURRENTMEMBER.PROPERTIES("${attrKey}") = "Val"`
    if (/FILTER\(/.test(currentMDX)) {
      setCurrentMDX(prev => prev.replace(/,\s*[^\}]+(?=\)\s*\}$)/s, `, ${newExpr}`))
    } else {
      setCurrentMDX(prev => `{FILTER(${prev.replace(/^\{(.+)\}$/s, '$1')}, ${newExpr})}`)
    }
    setBuildHistory(prev => [...prev, { id: 'attr', label: `Filter: ${attrKey}` }])
  }

  // Table interactive: cell value click
  const cellClick = (attrKey, val) => {
    const attrDef = dimAttrs.find(a => (a.Name || a.name) === attrKey)
    const isNumeric = (attrDef?.Type || attrDef?.type) === 'Numeric'
    if (isNumeric) setCurrentMDX(prev => prev.replace(/= 0\)$/, `= ${val})`))
    else setCurrentMDX(prev => prev.replace(/"Val"/, `"${val}"`))
  }

  const steps = isSubsetMode
    ? [{ num: 0, title: 'Pick Dimension' }, { num: 1, title: 'Build Set' }, { num: 2, title: 'Review' }]
    : [{ num: 0, title: 'Choose Cube' }, { num: 1, title: 'Assign Axes' }, { num: 2, title: 'Review' }]

  const dimsList = isSubsetMode ? dims : cubeDims
  const filteredDims = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    return q ? dimsList.filter(d => d.toLowerCase().includes(q)) : dimsList
  }, [dimsList, filterText])

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-3">
          <div className="font-semibold text-sm">{isSubsetMode ? 'Guided Subset Builder' : 'Guided View Builder'}</div>
          <div className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary">{isSubsetMode ? 'MDX Subset' : 'MDX View'}</div>
        </div>
        <div className="text-[10px] text-muted-foreground">Server: <span className="font-mono">{server || '—'}</span></div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0 bg-muted/10">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium border',
              step === s.num ? 'bg-primary text-primary-foreground border-primary' : step > s.num ? 'bg-green-500 text-white border-green-600' : 'bg-muted text-muted-foreground border-border')}>
              {step > s.num ? <Check size={10} /> : i + 1}
            </div>
            <span className={step === s.num ? 'font-medium' : 'text-muted-foreground'}>{s.title}</span>
            {i < steps.length - 1 && <div className="w-6 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left panel */}
        <div className="flex-1 min-w-[300px] max-w-[500px] border-r border-border overflow-hidden flex flex-col">
          <div className="p-4 overflow-auto flex-1 flex flex-col">

          {!server && <div className="text-xs text-muted-foreground border border-dashed rounded p-3 mb-3">No server connected.</div>}

          {isSubsetMode && (
            step === 0 ? (
              <div>
                <div className="font-medium text-sm mb-1">Pick a Dimension</div>
                <div className="text-[11px] text-muted-foreground mb-3">Select the dimension to build an MDX subset for.</div>
                <input type="text" placeholder="Filter dimensions…" className="w-full mb-2 px-2 py-1.5 text-xs border rounded bg-background"
                  value={filterText} onChange={e => setFilterText(e.target.value)} />
                <div className="space-y-0.5 max-h-[420px] overflow-auto">
                  {filteredDims.map(d => (
                    <button key={d} onClick={() => { setSelectedDim(d); setCurrentMDX(`{TM1SUBSETALL([${d}].[${d}])}`); setTimeout(() => setStep(1), 100) }}
                      className={cn('w-full text-left px-3 py-2 rounded border text-xs font-mono',
                        selectedDim === d ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}>{d}</button>
                  ))}
                </div>
              </div>
            ) : step === 1 && selectedDim ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-2 shrink-0">
                  <div className="text-sm font-medium flex-1">Build Set: [{selectedDim}]</div>
                  <button onClick={() => { setCurrentMDX(`{TM1SUBSETALL([${selectedDim}].[${selectedDim}])}`); setBuildHistory([]) }}
                    className="text-[10px] px-2 py-0.5 border rounded hover:bg-muted">Reset</button>
                </div>

                <div className="text-[10px] text-muted-foreground mb-1 shrink-0">
                  Layers: <span className="font-mono text-foreground">{buildHistory.length}</span>
                  {buildHistory.length > 0 && (
                    <span className="ml-2 inline-flex flex-wrap gap-1">
                      {buildHistory.map((h, i) => <span key={i} className="px-1 bg-primary/10 text-primary rounded font-mono">{h.label}</span>)}
                    </span>
                  )}
                </div>

                <div className="overflow-auto shrink-0 max-h-[280px]">
                  {CATEGORIES.map(cat => (
                    <div key={cat} className="mb-1">
                      <button onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
                        className="w-full flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold py-1 hover:text-foreground">
                        {expandedCat === cat ? '▾' : '▸'} {cat}
                      </button>
                      {expandedCat === cat && (
                        <div className="grid grid-cols-2 gap-0.5 pl-3">
                          {PATTERNS.filter(p => p.cat === cat).map(p => (
                            <button key={p.id} onClick={() => applyPattern(p)}
                              className="text-left px-2 py-1 rounded border border-border hover:bg-muted text-[10px] font-mono leading-tight">{p.label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between mt-2 mb-1">
                  <span className="text-[10px] text-muted-foreground">MDX Editor</span>
                  <div className="flex gap-1">
                    <button onClick={copyMDX} className="text-[9px] px-1.5 py-0.5 border rounded hover:bg-muted">Copy</button>
                  </div>
                </div>
                <div className="flex-1 min-h-[180px] border rounded overflow-hidden">
                  <MonacoEditor
                    height="100%" language="tm1mdx"
                    value={currentMDX}
                    onChange={v => setCurrentMDX(v)}
                    onMount={handleEditorMount}
                    options={{ fontSize: 11, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, lineNumbers: 'off', folding: false, renderLineHighlight: 'none', overviewRulerLanes: 0 }}
                    theme="vs-dark"
                  />
                </div>
              </div>
            ) : (
              <div>
                <div className="font-medium text-sm mb-1">Review & Use</div>
                <div className="text-[11px] text-muted-foreground mb-4">Your MDX is ready.</div>
                <button onClick={copyMDX} disabled={!generatedMDX}
                  className="w-full px-3 py-2 rounded border text-xs flex items-center justify-center gap-2 disabled:opacity-40 hover:bg-muted mb-2">
                  <Copy size={13} /> Copy MDX
                </button>
                <button onClick={() => openTab({ id: `subsetmdx:${selectedDim}:${Date.now()}`, type: 'subset', label: `MDX: ${selectedDim}`, server, dimension: selectedDim, mdx: currentMDX })}
                  className="w-full px-3 py-2 rounded bg-primary text-primary-foreground text-xs flex items-center justify-center gap-2 disabled:opacity-40">
                  <ExternalLink size={13} /> Open in Subset Editor
                </button>
              </div>
            )
          )}

          {!isSubsetMode && (
            step === 0 ? (
              <div>
                <div className="font-medium text-sm mb-1">Choose a Cube</div>
                <div className="text-[11px] text-muted-foreground mb-3">Pick the cube to query.</div>
                <input type="text" placeholder="Filter cubes…" className="w-full mb-2 px-2 py-1.5 text-xs border rounded bg-background"
                  value={filterText} onChange={e => setFilterText(e.target.value)} />
                <div className="space-y-0.5 max-h-[420px] overflow-auto">
                  {cubes.filter(c => !filterText || c.toLowerCase().includes(filterText.toLowerCase())).map(cube => (
                    <button key={cube} onClick={() => { setSelectedCube(cube); setTimeout(() => setStep(1), 100) }}
                      className={cn('w-full text-left px-3 py-2 rounded border text-xs font-mono',
                        selectedCube === cube ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}>{cube}</button>
                  ))}
                </div>
              </div>
            ) : step === 1 && selectedCube ? (
              <div>
                <div className="font-medium text-sm mb-1">Assign Dimensions</div>
                <input type="text" placeholder="Filter dims…" className="w-full mb-2 px-2 py-1.5 text-xs border rounded bg-background"
                  value={filterText} onChange={e => setFilterText(e.target.value)} />
                <div className="space-y-1.5">
                  {filteredDims.map(dim => {
                    const cur = dimConfig[dim]?.axis || null
                    return (
                      <div key={dim} className="flex items-center gap-1 border rounded px-2 py-1.5 bg-background">
                        <div className="font-mono text-[11px] flex-1 truncate">{dim}</div>
                        <button onClick={() => setDimConfig(p => ({ ...p, [dim]: { axis: p[dim]?.axis === 'columns' ? null : 'columns' } }))}
                          className={cn('px-1.5 py-0.5 text-[10px] rounded border', cur === 'columns' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>Cols</button>
                        <button onClick={() => setDimConfig(p => ({ ...p, [dim]: { axis: p[dim]?.axis === 'rows' ? null : 'rows' } }))}
                          className={cn('px-1.5 py-0.5 text-[10px] rounded border', cur === 'rows' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>Rows</button>
                        <button onClick={() => setDimConfig(p => ({ ...p, [dim]: { axis: p[dim]?.axis === 'filter' ? null : 'filter' } }))}
                          className={cn('px-1.5 py-0.5 text-[10px] rounded border', cur === 'filter' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>Filt</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div>
                <div className="font-medium text-sm mb-1">Review</div>
                <button onClick={copyMDX} disabled={!generatedMDX}
                  className="w-full px-3 py-2 rounded border text-xs flex items-center justify-center gap-2 disabled:opacity-40 hover:bg-muted mb-2">
                  <Copy size={13} /> Copy MDX
                </button>
                <button onClick={() => onSwitchToRaw?.(generatedMDX)} disabled={!generatedMDX}
                  className="w-full px-3 py-2 rounded bg-primary text-primary-foreground text-xs flex items-center justify-center gap-2 disabled:opacity-40">
                  <ExternalLink size={13} /> Open in Raw Editor
                </button>
              </div>
            )
          )}

          </div>
        </div>

        {/* Right: Results */}
        <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
          {!isSubsetMode && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">Generated MDX</div>
                <button onClick={runViewPreview} disabled={!generatedMDX || previewLoading}
                  className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground flex items-center gap-1 disabled:opacity-40">
                  {previewLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run
                </button>
              </div>
              <div className="border rounded bg-muted/40 p-3 font-mono text-[11px] whitespace-pre-wrap overflow-auto max-h-[140px] mb-3 shrink-0">
                {generatedMDX || 'Build your query on the left…'}
              </div>
            </>
          )}
          <div className="text-xs font-medium mb-1 text-muted-foreground">{isSubsetMode ? 'Member Preview' : 'Results'}</div>
          <div className="flex-1 min-h-0 border rounded overflow-auto bg-background p-2">
            {isSubsetMode ? (
              previewLoading ? <div className="h-full flex items-center justify-center"><Loader2 size={14} className="animate-spin text-muted-foreground" /></div> :
              previewMembers && previewMembers.length > 0 && previewMembers[0]?.attributes ? (
                (() => {
                  const attrKeys = [...new Set(previewMembers.flatMap(m => Object.keys(m.attributes)))]
                  return (
                    <div className="overflow-auto max-h-full">
                      <table className="w-full text-[10px] border-collapse">
                        <thead className="sticky top-0 bg-card z-10">
                          <tr className="border-b">
                            <th className="text-left px-2 py-1 font-medium text-muted-foreground">Name</th>
                            {attrKeys.map(k => (
                              <th key={k} className="text-left px-2 py-1 font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-sky-400 hover:underline"
                                onClick={() => colClick(k)} title="Filter by this attribute">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewMembers.map((m, i) => (
                            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="px-2 py-0.5 font-mono whitespace-nowrap">{m.Name || m.name}</td>
                              {attrKeys.map(k => (
                                <td key={k} className="px-2 py-0.5 font-mono whitespace-nowrap cursor-pointer hover:bg-sky-400/10 hover:text-sky-400"
                                  onClick={() => { const v = m.attributes?.[k] ?? ''; if (v) cellClick(k, v) }}>
                                  {m.attributes?.[k] ?? ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })()
              ) : previewMembers && previewMembers.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {previewMembers.slice(0, 300).map((m, i) => <span key={i} className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">{m.Name || m.name || m}</span>)}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
                  {currentMDX ? (currentMDX.includes('"Attr"') ? 'Edit placeholders to preview' : 'Members will appear here') : 'Pick a dimension to start'}
                </div>
              )
            ) : (
              previewResult ? <ResultGrid axes={previewResult.Axes} cells={previewResult.Cells} truncated={previewResult.truncated} /> :
              previewError ? <div className="text-xs text-red-400 p-2">{previewError}</div> :
              <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">Run preview to see results</div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center px-4 py-2.5 border-t border-border shrink-0 bg-muted/30">
        <button onClick={back} disabled={step === 0}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border disabled:opacity-40 hover:bg-muted"><ArrowLeft size={13} /> Back</button>
        <div className="text-[10px] text-muted-foreground">Step {step + 1} of {steps.length}</div>
        <button onClick={next} disabled={!canNext() || step === steps.length - 1}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40">
          {step === steps.length - 1 ? 'Done' : 'Next'} <ArrowRight size={13} />
        </button>
      </div>
    </div>
  )
}
