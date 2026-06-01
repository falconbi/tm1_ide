import { useState, useMemo, useEffect, useRef } from 'react'
import { useCubes, useCubeDimensions, useDims, useDimAttributes, useAttributeValues, useElements } from '@/hooks/useApi'
import { useStore } from '@/store'
import { ArrowLeft, ArrowRight, Play, Loader2, Copy, X, Check, Code2, ExternalLink, HelpCircle, Save, Clock } from 'lucide-react'
import MonacoEditor from '@monaco-editor/react'
import { cn } from '@/lib/utils'
import ResultGrid from '@/components/mdx/ResultGrid'

const RECENT_KEY = 'tm1-mdx-recent'

function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] } }
function saveRecent(entry) {
  const recent = loadRecent().filter(r => r.mdx !== entry.mdx)
  recent.unshift({ ...entry, time: Date.now() })
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 10)))
}

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

const FUNCTIONS = [
  { id: 'fn-val',         label: 'VAL(attr + "0")',           mdx: () => `VAL([Dim].[Dim].CURRENTMEMBER.PROPERTIES("Attr") + "0")`,
    desc: 'Converts a string property to a number by appending "0". Required for numeric comparisons in TM1 because PROPERTIES always returns strings.' },
  { id: 'fn-strtovalue',  label: 'STRTOVALUE(attr)',          mdx: () => `STRTOVALUE([Dim].[Dim].CURRENTMEMBER.PROPERTIES("Attr"))`,
    desc: 'Explicitly converts a string property to a numeric value.' },
  { id: 'fn-strtomember', label: 'STRTOMEMBER(expr)',         mdx: () => `STRTOMEMBER("[Dim].[" + [Cube].([Measure]) + "]")`,
    desc: 'Converts a string expression to a member reference. Useful for dynamic member selection based on cube data or attributes.' },
  { id: 'fn-iif',         label: 'IIF(cond, t, f)',           mdx: () => `IIF([Dim].[Dim].CURRENTMEMBER.PROPERTIES("Attr") = "Val", 1, 0)`,
    desc: 'Inline conditional. Returns the second argument if true, third if false.' },
  { id: 'fn-currentmember', label: 'CURRENTMEMBER',           mdx: () => `[Dim].[Dim].CURRENTMEMBER`,
    desc: 'References the current member in the iteration context. Used inside FILTER, GENERATE, and other set-iterating functions.' },
  { id: 'fn-properties',  label: '.PROPERTIES("Attr")',       mdx: () => `[Dim].[Dim].CURRENTMEMBER.PROPERTIES("Attr")`,
    desc: 'Accesses an element attribute value. Always returns a string — use VAL() or STRTOVALUE() for numeric attributes.' },
  { id: 'fn-generate',    label: 'GENERATE(set, expr)',       mdx: () => `{GENERATE({TM1SUBSETALL([Dim].[Dim])}, {[Dim].[Dim].CURRENTMEMBER})}`,
    desc: 'Iterates over a set and evaluates an expression for each member. Most powerful set-construction function in MDX.' },
  { id: 'fn-extract',     label: 'EXTRACT(set, dim)',         mdx: () => `{EXTRACT({set}, [Dim])}`,
    desc: 'Extracts members of a specific dimension from tuples in a set.' },
  { id: 'fn-lag',         label: 'LAG(member, N)',            mdx: () => `[Dim].[Dim].CURRENTMEMBER.LAG(1)`,
    desc: 'Returns the member N positions before the given member in the dimension order.' },
  { id: 'fn-lead',        label: 'LEAD(member, N)',           mdx: () => `[Dim].[Dim].CURRENTMEMBER.LEAD(1)`,
    desc: 'Returns the member N positions after the given member in the dimension order.' },
  { id: 'fn-periodstodate',label: 'PERIODSTODATE(member)',    mdx: () => `{PERIODSTODATE([Dim].[Dim].[FY],[Dim].[Dim].CURRENTMEMBER)}`,
    desc: 'Returns all members from the start of the period up to the given member (YTD-style).' },
  { id: 'fn-isancestor',  label: 'ISANCESTOR(a, b)',          mdx: () => `ISANCESTOR([Dim].[Member], [Dim].[Dim].CURRENTMEMBER)`,
    desc: 'Returns TRUE if the first member is an ancestor of the second in the hierarchy.' },
  { id: 'fn-closingperiod',label: 'CLOSINGPERIOD(member)',    mdx: () => `CLOSINGPERIOD([Dim].[Dim].[FY],[Dim].[Dim].CURRENTMEMBER)`,
    desc: 'Returns the last sibling in the same level under the given ancestor (e.g., last month in the FY).' },
  { id: 'fn-openingperiod',label:'OPENINGPERIOD(member)',     mdx: () => `OPENINGPERIOD([Dim].[Dim].[FY],[Dim].[Dim].CURRENTMEMBER)`,
    desc: 'Returns the first sibling in the same level under the given ancestor (e.g., first month in the FY).' },
  { id: 'fn-cousin',      label: 'COUSIN(m1, m2)',            mdx: () => `[Dim].[Member].COUSIN([Dim].[Other])`,
    desc: 'Returns the member at the same relative position under a different parent.' },
  { id: 'fn-parallelperiod',label:'PARALLELPERIOD(mem, N)',   mdx: () => `PARALLELPERIOD([Dim].[Dim].[FY], 1, [Dim].[Dim].CURRENTMEMBER)`,
    desc: 'Returns the member N periods prior at the same relative position (e.g., same month last year).' },
  { id: 'fn-tm1member',   label: 'TM1MEMBER(name)',           mdx: () => `TM1MEMBER("[Dim].[Name]")`,
    desc: 'Creates a member reference from a string. Validates that the member exists.' },
  { id: 'fn-tm1tuplesize',label: 'TM1TUPLESIZE(tuple)',       mdx: () => `TM1TUPLESIZE()`,
    desc: 'Returns the number of elements in a tuple.' },
  { id: 'fn-tm1subsettoset',label:'TM1SubsetToSet(dim, sub)', mdx: () => `TM1SubsetToSet([Dim], "MySubset")`,
    desc: 'Converts a named public subset into an MDX set expression.' },
  { id: 'fn-tm1settosubset',label:'TM1SetToSubset(...)',      mdx: () => `TM1SetToSubset([Dim], {set}, "SubsetName", 0)`,
    desc: 'Creates a named public subset from an MDX set. 0=static, 1=dynamic.' },
  { id: 'fn-dimname',     label: 'DIMNAME(dim)',              mdx: () => `DIMNAME([Dim])`,
    desc: 'Returns the dimension name of a member.' },
  { id: 'fn-dimix',       label: 'DIMIX(dim, member)',        mdx: () => `DIMIX([Dim], [Dim].[Member])`,
    desc: 'Returns the index of a member in the dimension. Returns 0 if not found.' },
  { id: 'fn-head',        label: 'HEAD(set, N)',              mdx: () => `{HEAD({TM1SUBSETALL([Dim].[Dim])}, 10)}`,
    desc: 'Returns the first N members of a set. Unlike TOPCOUNT, does not sort.' },
  { id: 'fn-tail',        label: 'TAIL(set, N)',              mdx: () => `{TAIL({TM1SUBSETALL([Dim].[Dim])}, 10)}`,
    desc: 'Returns the last N members of a set.' },
  { id: 'fn-item',        label: 'ITEM(set, N)',              mdx: () => `{TM1SUBSETALL([Dim].[Dim])}.ITEM(0)`,
    desc: 'Returns the Nth member of a set (0-indexed).' },
  { id: 'fn-count',       label: 'COUNT(set)',                mdx: () => `COUNT({TM1SUBSETALL([Dim].[Dim])} INCLUDEEMPTY)`,
    desc: 'Returns the number of members in a set. INCLUDEEMPTY or EXCLUDEEMPTY.' },
  { id: 'fn-sum',         label: 'SUM(set, cube)',            mdx: () => `SUM({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Measure]))`,
    desc: 'Sums a cube value across all members in a set.' },
  { id: 'fn-avg',         label: 'AVG(set, cube)',            mdx: () => `AVG({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Measure]))`,
    desc: 'Averages a cube value across all members in a set.' },
  { id: 'fn-min-max',     label: 'MIN / MAX(set, cube)',      mdx: () => `MIN({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Measure]))`,
    desc: 'Returns the minimum or maximum cube value across a set. Use MAX() for maximum.' },
  { id: 'fn-rank',        label: 'RANK(member, set)',         mdx: () => `RANK([Dim].[Dim].CURRENTMEMBER, {TM1SUBSETALL([Dim].[Dim])})`,
    desc: 'Returns the rank position of a member within a sorted set.' },
]

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
  { id: 'descendants', label: 'Drill down from member',    cat: 'Hierarchy' },
  { id: 'filter-desc', label: 'Get descendants of result', cat: 'Hierarchy' },
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

  const init = tab?.initialState ?? {}
  const [step, setStep] = useState(init.step ?? 0)
  const [selectedCube, setSelectedCube] = useState(init.selectedCube ?? null)
  const [selectedDim, setSelectedDim] = useState('')
  const [dimConfig, setDimConfig] = useState(init.dimConfig ?? {})
  const [filterText, setFilterText] = useState('')
  const [currentMDX, setCurrentMDX] = useState('')
  const [buildHistory, setBuildHistory] = useState([])
  const [expandedCat, setExpandedCat] = useState(null)
  const [hoveredPattern, setHoveredPattern] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpSearch, setHelpSearch] = useState('')
  const [expandedHelp, setExpandedHelp] = useState(null)
  const [recent, setRecent] = useState(loadRecent())
  const [showRecent, setShowRecent] = useState(false)

  const saveSession = () => {
    if (!currentMDX || !selectedDim) return
    const entry = { mdx: currentMDX, dimension: selectedDim, patterns: buildHistory.map(h => h.id) }
    saveRecent(entry)
    setRecent(loadRecent())
  }

  const loadSession = (entry) => {
    setSelectedDim(entry.dimension)
    setCurrentMDX(entry.mdx)
    if (entry.patterns?.length) {
      setBuildHistory(entry.patterns.map(id => {
        const p = PATTERNS.find(p => p.id === id) || FUNCTIONS.find(f => f.id === id)
        return { id, label: p?.label || id }
      }))
    }
    setStep(1)
    setShowRecent(false)
  }
  const [selectedAttr, setSelectedAttr] = useState('')
  const [previewMembers, setPreviewMembers] = useState(null)
  const [previewResult, setPreviewResult] = useState(null)
  const [previewError, setPreviewError] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [viewMDX, setViewMDX] = useState('')
  const [userEditedMDX, setUserEditedMDX] = useState(false)
  const prevGeneratedRef = useRef('')
  const [isFormatted, setIsFormatted] = useState(false)
  const [selectedMeasures, setSelectedMeasures] = useState([])
  const [intent, setIntent] = useState(init.selectedCube ? 'Freeform' : null)
  const [secondCube, setSecondCube] = useState(null)
  const [timeDim, setTimeDim] = useState(null)
  const [timeDim2, setTimeDim2] = useState(null)
  const [timeExpr1, setTimeExpr1] = useState('')
  const [timeExpr2, setTimeExpr2] = useState('')
  const [timeShowPatterns, setTimeShowPatterns] = useState(false)

  // Helper: pick a cube button click also runs intent-specific setup
  const handleCubePick = (cube) => {
    setSelectedCube(cube)
    if (intent === 'Measures by Dimension') {
      // Auto:  measures dim -> columns, leave rest for user
      setTimeout(() => {
        if (cubeDims.length > 0) {
          const c = {}
          cubeDims.forEach((d, i) => { c[d] = { axis: i < cubeDims.length - 1 ? 'rows' : 'columns' } })
          setDimConfig(c)
        }
        setStep(1)
      }, 150)
    } else if (intent === 'Cross-tab') {
      setTimeout(() => {
        if (cubeDims.length >= 3) {
          const c = {}
          c[cubeDims[0]] = { axis: 'rows' }
          c[cubeDims[1]] = { axis: 'columns' }
          c[cubeDims[cubeDims.length - 1]] = { axis: 'columns' }
          setDimConfig(c)
        }
        setStep(1)
      }, 150)
    } else if (intent === 'Time Series') {
      setTimeout(() => {
        if (cubeDims.length > 0) {
          const c = {}
          c[cubeDims[cubeDims.length - 1]] = { axis: 'columns' }
          cubeDims.forEach((d, i) => { if (i < cubeDims.length - 1) c[d] = { axis: 'rows' } })
          setDimConfig(c)
        }
        setStep(1)
      }, 150)
    } else if (intent === 'Filtered by another cube') {
      // Stay in step 0, show second cube picker
      // Will be handled below
    } else {
      setTimeout(() => setStep(1), 100)
    }
  }

  const { data: cubes = [] } = useCubes(server)
  const { data: cubeDims = [] } = useCubeDimensions(server, selectedCube)
  const measuresDim = cubeDims?.length ? cubeDims[cubeDims.length - 1] : null
  const { data: measureElements = [] } = useElements(server, measuresDim)
  const { data: dims = [] } = useDims(server)
  const { data: dimAttrs = [] } = useDimAttributes(server, selectedDim)
  const { data: attrValues = { values: [] } } = useAttributeValues(server, selectedDim, selectedAttr)
  const { openTab } = useStore()
  const editorRef = useRef(null)

  const insertAtCursor = (text) => {
    const editor = editorRef.current
    if (!editor) { setCurrentMDX(prev => prev + text); return }
    const pos = editor.getPosition()
    editor.executeEdits('insert', [{ range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }, text }])
    editor.focus()
  }

  // View mode axes + MDX
  const { axes, dimExpressions } = useMemo(() => {
    const cols = [], rows = [], filt = [], exprs = {}
    Object.entries(dimConfig).forEach(([dim, cfg]) => {
      if (!cfg?.axis) return
      if (cfg.axis === 'columns') cols.push(dim)
      else if (cfg.axis === 'rows') rows.push(dim)
      else if (cfg.axis === 'filter') filt.push(dim)
      exprs[dim] = cfg.subsetExpression || `TM1SUBSETALL([${dim}].[${dim}])`
      if (dim === measuresDim && selectedMeasures.length > 0) {
        exprs[dim] = `{${selectedMeasures.map(m => `[${dim}].[${dim}].[${m}]`).join(', ')}}`
      }
    })
    return { axes: { columns: cols, rows: rows, filter: filt }, dimExpressions: exprs }
  }, [dimConfig])

  const generatedMDX = useMemo(() => {
    if (isSubsetMode) return currentMDX || (selectedDim ? `{TM1SUBSETALL([${selectedDim}].[${selectedDim}])}` : '')
    if (!selectedCube) return ''
    const wrap  = s => (s?.trimStart().startsWith('{') ? s : `{${s}}`)
    const build = (dims, axis) => {
      if (!dims.length) return ''
      const sets   = dims.map(d => wrap(dimExpressions[d]))
      const joined = sets.length === 1 ? sets[0] : sets.join(' *\n        ')
      return `NON EMPTY\n    ${joined} ON ${axis}`
    }
    let mdx = 'SELECT'
    const colPart = build(axes.columns, 'COLUMNS')
    const rowPart = build(axes.rows, 'ROWS')
    if (colPart) mdx += `\n  ${colPart}`
    if (rowPart) mdx += `${colPart ? ',' : ''}\n  ${rowPart}`
    if (!colPart && !rowPart) mdx += '\n  NON EMPTY {TM1SubsetAll([Dim])} ON COLUMNS'
    mdx += `\nFROM [${selectedCube}]`
    if (axes.filter.length) {
      const slicers = axes.filter.map(d => {
        const expr = dimConfig[d]?.subsetExpression?.trim()
        // Plain member name (no MDX syntax chars) → use as member reference
        return expr && !/[{}()[\]]/.test(expr)
          ? `[${d}].[${d}].[${expr}]`
          : `[${d}].[${d}].DefaultMember`
      })
      mdx += `\nWHERE (${slicers.join(', ')})`
    }
    return mdx
  }, [isSubsetMode, currentMDX, selectedDim, selectedCube, axes, dimExpressions])

  // Intent auto-config: when cubeDims load, apply intent axis setup
  useEffect(() => {
    if (!isSubsetMode && selectedCube && cubeDims.length > 0 && intent && step === 0) {
      let c = {}
      if (intent === 'Measures by Dimension') {
        cubeDims.forEach((d, i) => { c[d] = { axis: i < cubeDims.length - 1 ? 'rows' : 'columns' } })
      } else if (intent === 'Cross-tab') {
        if (cubeDims.length >= 2) {
          c[cubeDims[0]] = { axis: 'rows' }
          c[cubeDims[1]] = { axis: 'columns' }
        }
      } else if (intent === 'Time Series') {
        const lastI = cubeDims.length - 1
        cubeDims.forEach((d, i) => {
          const isTime = d === timeDim || d === timeDim2
          c[d] = { axis: isTime || i === lastI ? 'columns' : 'rows' }
          if (d === timeDim && timeExpr1) c[d].subsetExpression = timeExpr1
          if (d === timeDim2 && timeExpr2) c[d].subsetExpression = timeExpr2
        })
      } else if (intent === 'Filtered by another cube' || intent === 'Cross-cube reference') {
        if (secondCube) {
          cubeDims.forEach((d) => { c[d] = { axis: 'rows' } })
        } else {
          return // wait for second cube pick
        }
      }
      if (Object.keys(c).length > 0) {
        setDimConfig(c)
        setTimeout(() => setStep(1), 200)
      }
    }
  }, [cubeDims, intent, step, secondCube, isSubsetMode, selectedCube])

  // Sync generatedMDX → Monaco editor unless user has manually edited
  useEffect(() => {
    if (!generatedMDX) return
    if (!userEditedMDX || viewMDX === prevGeneratedRef.current) {
      setViewMDX(generatedMDX)
    }
    prevGeneratedRef.current = generatedMDX
  }, [generatedMDX])

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

  const activeMDX = viewMDX || generatedMDX

  const runViewPreview = async () => {
    if (isSubsetMode) return
    setPreviewLoading(true); setPreviewError(null)
    try {
      const res = await fetch(`/api/mdx/execute?server=${encodeURIComponent(server)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mdx: activeMDX }),
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

  const toggleFormat = () => {
    let mdx = currentMDX
    if (isFormatted) {
      mdx = mdx.replace(/\s+/g, ' ').replace(/\s*(\{)\s*/g, '$1').replace(/\s*(\})\s*/g, '$1').replace(/\s*,\s*/g, ', ').trim()
      setIsFormatted(false)
    } else {
      mdx = mdx.replace(/\s+/g, ' ').trim()
      mdx = mdx.replace(/\{FILTER\(([^,]+),\s*([^}]+)\)\}/g, (_, inner, cond) =>
        `{\n  FILTER(\n    ${inner.trim()},\n    ${cond.trim()}\n  )\n}`)
      mdx = mdx.replace(/\,\s*\)\}$/g, '\n  )\n}')
      setIsFormatted(true)
    }
    setCurrentMDX(mdx)
  }
  const canNext = () => isSubsetMode ? (step === 0 ? !!selectedDim : !!currentMDX) : (step === 0 ? !!selectedCube : step === 1 ? Object.keys(dimConfig).some(k => dimConfig[k]?.axis) : true)
  const next = () => { if (canNext()) setStep(s => Math.min(s + 1, 2)) }
  const back = () => {
    if (!isSubsetMode && step === 1) { setIntent(null); setSelectedCube(null); setDimConfig({}) }
    setPreviewResult(null); setPreviewError(null)
    setStep(s => Math.max(s - 1, 0))
  }

  // Monaco syntax highlighting
  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor
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
          <button onClick={() => setHelpOpen(!helpOpen)}
            className="px-2 py-0.5 text-[10px] rounded border border-border hover:bg-muted flex items-center gap-1">
            <HelpCircle size={12} /> Help
          </button>
          <div className="relative">
            <button onClick={() => setShowRecent(!showRecent)}
              className="px-2 py-0.5 text-[10px] rounded border border-border hover:bg-muted flex items-center gap-1">
              <Clock size={12} /> Sessions
            </button>
            {showRecent && (
              <div className="absolute top-full right-0 mt-1 bg-popover border border-border rounded shadow-lg z-50 py-1 min-w-[280px] max-h-[200px] overflow-auto">
                <button onClick={saveSession} disabled={!currentMDX || !selectedDim}
                  className="w-full text-left px-3 py-1.5 text-[10px] hover:bg-muted flex items-center gap-2 disabled:opacity-40 border-b border-border">
                  <Save size={11} /> Save current session
                </button>
                {recent.length === 0 && <div className="px-3 py-2 text-[10px] text-muted-foreground">No saved sessions</div>}
                {recent.map((r, i) => (
                  <button key={i} onClick={() => loadSession(r)}
                    className="w-full text-left px-3 py-1.5 text-[10px] hover:bg-muted flex items-center justify-between">
                    <span className="font-mono truncate flex-1 mr-2">{r.dimension}</span>
                    <span className="text-muted-foreground shrink-0">{new Date(r.time).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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

      {helpOpen && (
        <div className="px-4 py-2.5 border-b border-border bg-muted/10 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold">MDX Reference</div>
            <div className="flex items-center gap-2">
              <input type="text" placeholder="Search functions & patterns…" value={helpSearch}
                onChange={e => setHelpSearch(e.target.value)}
                className="text-[10px] px-2 py-1 border rounded bg-background w-64" />
              <button onClick={() => { setHelpOpen(false); setHelpSearch('') }} className="p-0.5 rounded hover:bg-muted"><X size={12} /></button>
            </div>
          </div>
          {helpSearch ? (
            <div className="space-y-1 max-h-[140px] overflow-auto">
              {[...PATTERNS, ...FUNCTIONS.map(fn => ({ ...fn, isFn: true }))]
                .filter(item => {
                  const mdx = item.isFn ? item.mdx() : (WRAPPERS[item.id] ? WRAPPERS[item.id](selectedDim||'Dim', '{...}') : '')
                  return item.label.toLowerCase().includes(helpSearch.toLowerCase())
                    || (item.desc||'').toLowerCase().includes(helpSearch.toLowerCase())
                    || mdx.toLowerCase().includes(helpSearch.toLowerCase())
                })
                .map((item, i) => {
                  const mdx = item.isFn ? item.mdx() : (WRAPPERS[item.id] ? WRAPPERS[item.id](selectedDim||'Dim', '{...}') : '')
                  return (
                    <div key={i} className="text-[10px] border-b border-border/30 pb-2 last:border-0">
                      <button className="w-full text-left cursor-pointer hover:text-sky-400"
                        onClick={() => setExpandedHelp(expandedHelp === i ? null : i)}>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px]">{expandedHelp === i ? '▾' : '▸'}</span>
                          <span className="font-mono text-sky-400 font-medium">{item.label}</span>
                          <span className="text-muted-foreground">{item.isFn ? 'function' : 'pattern'}</span>
                        </div>
                        {expandedHelp !== i && item.desc && <div className="text-[9px] text-muted-foreground mt-0.5 ml-4 truncate">{item.desc}</div>}
                      </button>
                      {expandedHelp === i && (
                        <div className="ml-4 mt-1">
                          {item.desc && <div className="text-[9px] text-muted-foreground mb-1.5">{item.desc}</div>}
                          <div className="font-mono text-[9px] text-muted-foreground bg-muted/30 p-1.5 rounded whitespace-pre-wrap break-all">{mdx}</div>
                        </div>
                      )}
                    </div>
                  )
                })}
              {[...PATTERNS, ...FUNCTIONS].filter(item => item.label.toLowerCase().includes(helpSearch.toLowerCase())).length === 0 &&
                <div className="text-[10px] text-muted-foreground">No matches for "{helpSearch}"</div>}
            </div>
          ) : (
            <div>
              <div className="text-[10px] text-muted-foreground mb-2">Type in the search box to find functions and patterns by name.</div>
              {!isSubsetMode && (
                <div className="mb-2">
                  <div className="text-[9px] uppercase text-muted-foreground font-semibold mb-1">View MDX Syntax</div>
                  <div className="grid grid-cols-4 gap-x-3 gap-y-1 text-[10px]">
                    <span><span className="font-mono text-amber-400">SELECT</span> — required clause</span>
                    <span><span className="font-mono text-amber-400">FROM</span> — cube name</span>
                    <span><span className="font-mono text-amber-400">WHERE</span> — slicer</span>
                    <span><span className="font-mono text-amber-400">ON COLUMNS/ROWS</span> — axis</span>
                    <span><span className="font-mono text-amber-400">NON EMPTY</span> — suppress zeros</span>
                    <span><span className="font-mono text-amber-400">CROSSJOIN</span> — nested axes</span>
                    <span><span className="font-mono text-amber-400">WITH MEMBER/SET</span> — calculated</span>
                    <span><span className="font-mono text-amber-400">ORDER</span> — sort result</span>
                  </div>
                </div>
              )}
              <div className="text-[9px] uppercase text-muted-foreground font-semibold mb-1">{!isSubsetMode ? 'Set Expressions (for axes/slicer)' : 'Subset Functions'}</div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[10px]">
                {[
                  { name: 'TM1SUBSETALL',     desc: 'all members' },
                  { name: 'TM1FILTERBYLEVEL', desc: 'leaf only' },
                  { name: 'TM1FILTERBYPATTERN', desc: 'wildcard' },
                  { name: 'FILTER',           desc: 'cube/attr condition' },
                  { name: 'DESCENDANTS',      desc: 'drill down' },
                  { name: 'TM1SORT',          desc: 'sort A-Z/Z-A' },
                  { name: 'TOPCOUNT',         desc: 'top N' },
                  { name: 'BOTTOMCOUNT',      desc: 'bottom N' },
                  { name: 'HEAD/TAIL',        desc: 'first/last N' },
                  { name: 'UNION',            desc: 'combine sets' },
                  { name: 'INTERSECT',        desc: 'common members' },
                  { name: 'EXCEPT',           desc: 'exclude members' },
                  { name: 'GENERATE',         desc: 'iterate set' },
                  { name: 'ORDER',            desc: 'sort by cube value' },
                  { name: 'LAG/LEAD',         desc: 'offset member' },
                  { name: 'LASTPERIODS',      desc: 'trailing periods' },
                  { name: 'OPENINGPERIOD',    desc: 'first period' },
                  { name: 'CLOSINGPERIOD',    desc: 'last period' },
                  { name: 'PARALLELPERIOD',   desc: 'prior year' },
                  { name: 'PERIODSTODATE',    desc: 'cumulative' },
                  { name: 'VAL',              desc: 'numeric attribute' },
                  { name: 'STRTOVALUE',       desc: 'string→number' },
                  { name: 'STRTOMEMBER',      desc: 'string→member' },
                  { name: 'IIF',              desc: 'conditional' },
                  { name: 'MIN/MAX',          desc: 'aggregate' },
                  { name: 'SUM/AVG/COUNT',    desc: 'aggregates' },
                  { name: 'RANK',             desc: 'rank in set' },
                  { name: 'DIMIX/DIMNAME',    desc: 'dimension lookup' },
                  { name: 'EXTRACT',          desc: 'extract hierarchy' },
                  { name: 'COUSIN',           desc: 'parallel member' },
                ].map(fn => (
                  <button key={fn.name}
                    onClick={() => { setHelpSearch(fn.name); setExpandedHelp(0) }}
                    className="text-left hover:text-sky-400 cursor-pointer">
                    <span className="font-mono text-sky-400">{fn.name}</span> <span className="text-muted-foreground">— {fn.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
                  <div className="mb-1">
                    <button onClick={() => setExpandedCat(expandedCat === 'functions' ? null : 'functions')}
                      className="w-full flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-400 font-semibold py-1 hover:text-foreground">
                      {expandedCat === 'functions' ? '▾' : '▸'} Functions
                    </button>
                    {expandedCat === 'functions' && (
                      <div className="grid grid-cols-2 gap-0.5 pl-3">
                        {FUNCTIONS.map(fn => (
                          <button key={fn.id} onClick={() => insertAtCursor(fn.mdx())}
                            className="text-left px-2 py-1 rounded border border-border hover:bg-muted text-[10px] font-mono leading-tight">{fn.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-2 mb-1">
                  <span className="text-[10px] text-muted-foreground">MDX Editor</span>
                  <div className="flex gap-1">
                    <button onClick={toggleFormat} className="text-[9px] px-1.5 py-0.5 border rounded hover:bg-muted">{isFormatted ? 'Inline' : 'Format'}</button>
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
                {!intent ? (
                  <div>
                    <div className="font-medium text-sm mb-1">What do you want to build?</div>
                    <div className="text-[11px] text-muted-foreground mb-3">Pick a template, then choose your cube.</div>
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      {[
                        { label: 'Measures by Dimension', desc: 'e.g. Sales by Product', icon: '📊',
                          detail: 'Simple 2-axis view: spread measures across columns, breakdown by one dimension on rows.\n\nExample: SELECT [Revenue], [Cost] ON COLUMNS...\nFROM [Sales]\nWHERE Region = Total Company' },
                        { label: 'Cross-tab', desc: 'e.g. Sales × Month', icon: '📋',
                          detail: 'Two dimensions on axes with measures. Creates a grid/matrix.\n\nExample: Products ON ROWS, Months ON COLUMNS\nFROM [Sales]\nResult: Revenue × Product × Month' },
                        { label: 'Time Series', desc: 'e.g. Revenue over 12 months', icon: '📈',
                          detail: 'Time on columns with measures. Typically uses a time dimension with year/month members.\n\nExample: LastPeriods(12, [Period].[Current]) ON COLUMNS, Products ON ROWS\nFROM [Sales]' },
                        { label: 'Filtered by another cube', desc: 'e.g. Products with Budget > 0', icon: '🔗',
                          detail: 'Filter one cube\'s dimension members based on values from another cube.\n\nBoth cubes must share at least one dimension. For unshared dims, you pick an explicit member.\n\nExample using Product & Period as shared dims, Region fixed:\n{FILTER({TM1SUBSETALL([Product])}, [Budget].([Period].[Current], [Region].[Total], [Amount]) > 0)} ON ROWS\nFROM [Sales]' },
                        { label: 'Cross-cube reference', desc: 'Advanced: FILTER using 2nd cube data', icon: '🔀',
                          detail: 'Reference a second cube inside GENERATE or FILTER. Must specify members for ALL dimensions that the referenced cube has but the query cube doesn\'t share.\n\nShared dims use CurrentMember or explicit member. Unshared dims: provide explicit member.\n\nExample — Budget runs across Product × Period × Version:\n{FILTER({TM1SUBSETALL([Product])}, [Budget].([Period].[Current], [Version].[Budget], [Amount]) > 0)}\nON ROWS FROM [Sales]' },
                        { label: 'Freeform', desc: 'Manual axes setup', icon: '🔧',
                          detail: 'Start with a blank cube. Manually assign dimensions to axes, choose subsets, add slicers.\n\nFull control — recommended for experienced users.' },
                      ].map(tpl => (
                        <button key={tpl.label} onClick={() => setIntent(tpl.label)}
                          title={tpl.detail}
                          className="flex items-start gap-2 p-3 rounded border border-border hover:bg-muted text-left cursor-help">
                          <span className="text-lg">{tpl.icon}</span>
                          <div>
                            <div className="text-xs font-medium">{tpl.label}</div>
                            <div className="text-[10px] text-muted-foreground">{tpl.desc}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setIntent('Freeform')} className="text-[10px] text-muted-foreground underline">Skip, just pick a cube</button>
                  </div>
                ) : (
                  <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">{intent}</div>
                    <button onClick={() => setIntent(null)} className="text-[10px] text-muted-foreground underline">Change</button>
                  </div>
                  {intent === 'Time Series' && (
                    <div className="mb-3 p-2 border rounded bg-muted/20">
                      <div className="text-[10px] text-muted-foreground mb-1">Which dimensions are your time? (up to 2)</div>
                      <div className="flex gap-2">
                        <select value={timeDim || ''} onChange={e => setTimeDim(e.target.value)}
                          className="flex-1 text-[10px] px-2 py-1 border rounded bg-background">
                          <option value="">— primary (e.g. Year) —</option>
                          {dims.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <select value={timeDim2 || ''} onChange={e => setTimeDim2(e.target.value)}
                          className="flex-1 text-[10px] px-2 py-1 border rounded bg-background">
                          <option value="">— secondary (e.g. Month) —</option>
                          {dims.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                  {(timeDim || timeDim2) && (
                    <div className="mb-3 p-2 border rounded bg-muted/20">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">Time subset expression</span>
                        <button onClick={() => setTimeShowPatterns(!timeShowPatterns)}
                          className="text-[9px] text-muted-foreground underline">{timeShowPatterns ? 'Hide' : 'Patterns'}</button>
                      </div>
                      {timeShowPatterns && (
                        <div className="grid grid-cols-2 gap-0.5 mb-2">
                          {PATTERNS.filter(p => p.cat === 'Time / Range' || p.cat === 'Ranking' || p.cat === 'Sorting' || p.id === 'leaf').map(p => (
                            <button key={p.id} onClick={() => {
                              const expr = WRAPPERS[p.id](timeDim || selectedDim, '{...}')
                              if (timeDim) setTimeExpr1(expr)
                              if (timeDim2 && !timeDim) setTimeExpr2(expr)
                            }} className="text-left px-1.5 py-0.5 rounded border border-border hover:bg-muted text-[9px] font-mono">{p.label}</button>
                          ))}
                        </div>
                      )}
                      {timeDim && (
                        <input type="text" placeholder={`{TM1SUBSETALL([${timeDim}].[${timeDim}])}`}
                          value={timeExpr1} onChange={e => setTimeExpr1(e.target.value)}
                          className="w-full font-mono text-[9px] px-1.5 py-0.5 border rounded bg-background mb-1" />
                      )}
                      {timeDim2 && (
                        <input type="text" placeholder={`{TM1SUBSETALL([${timeDim2}].[${timeDim2}])}`}
                          value={timeExpr2} onChange={e => setTimeExpr2(e.target.value)}
                          className="w-full font-mono text-[9px] px-1.5 py-0.5 border rounded bg-background" />
                      )}
                    </div>
                  )}
                  <div className="font-medium text-sm mb-1">Choose a Cube</div>
                    <div className="text-[11px] text-muted-foreground mb-3">Pick the cube to query.</div>
                    <input type="text" placeholder="Filter cubes…" className="w-full mb-2 px-2 py-1.5 text-xs border rounded bg-background"
                      value={filterText} onChange={e => setFilterText(e.target.value)} />
                    <div className="space-y-0.5 max-h-[360px] overflow-auto">
                      {cubes.filter(c => !filterText || c.toLowerCase().includes(filterText.toLowerCase())).map(cube => (
                        <button key={cube} onClick={() => handleCubePick(cube)}
                          className={cn('w-full text-left px-3 py-2 rounded border text-xs font-mono',
                            selectedCube === cube ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}>{cube}</button>
                      ))}
                    </div>
                    {intent === 'Filtered by another cube' && selectedCube && !secondCube && (
                      <div className="mt-4 pt-4 border-t">
                        <div className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-medium mb-2 inline-block">Filter Cube</div>
                        <div className="font-medium text-sm mb-1">Choose the Filter Cube</div>
                        <div className="text-[11px] text-muted-foreground mb-3">This cube's data will filter {selectedCube}.</div>
                        <div className="space-y-0.5 max-h-[200px] overflow-auto">
                          {cubes.filter(c => c !== selectedCube).map(cube => (
                            <button key={cube} onClick={() => { setSecondCube(cube); setTimeout(() => setStep(1), 100) }}
                              className={cn('w-full text-left px-3 py-2 rounded border text-xs font-mono',
                                secondCube === cube ? 'border-amber-400 bg-amber-400/5' : 'border-border hover:bg-muted')}>{cube}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : step === 1 && selectedCube ? (
              <div>
                <div className="font-medium text-sm mb-1">Assign Dimensions</div>
                {measuresDim && measureElements.length > 0 && (
                  <div className="mb-3 p-2 border rounded bg-muted/20">
                    <div className="text-[10px] text-muted-foreground mb-1 font-medium">Measures ({measuresDim})</div>
                    <div className="grid grid-cols-3 gap-1 max-h-[120px] overflow-auto">
                      {measureElements.slice(0, 60).map(el => {
                        const name = el.Name || el.name || el
                        const checked = selectedMeasures.includes(name)
                        return (
                          <label key={name} className="flex items-center gap-1 text-[10px] cursor-pointer">
                            <input type="checkbox" checked={checked}
                              onChange={() => setSelectedMeasures(prev => checked ? prev.filter(m => m !== name) : [...prev, name])}
                              className="accent-primary" />
                            <span className="font-mono truncate">{name}</span>
                          </label>
                        )
                      })}
                    </div>
                    {selectedMeasures.length > 0 && (
                      <button onClick={() => setSelectedMeasures([])}
                        className="text-[9px] px-2 py-0.5 border rounded hover:bg-muted mt-1">Clear</button>
                    )}
                  </div>
                )}
                <input type="text" placeholder="Filter dims…" className="w-full mb-2 px-2 py-1.5 text-xs border rounded bg-background"
                  value={filterText} onChange={e => setFilterText(e.target.value)} />
                <div className="space-y-1.5">
                  {filteredDims.map(dim => {
                    const cur = dimConfig[dim]?.axis || null
                    return (
                      <div key={dim} className="border rounded px-2 py-1.5 bg-background space-y-1">
                        <div className="flex items-center gap-1">
                          <div className="font-mono text-[11px] flex-1 truncate">{dim}</div>
                          <button onClick={() => setDimConfig(p => ({ ...p, [dim]: { axis: p[dim]?.axis === 'columns' ? null : 'columns', subsetExpression: p[dim]?.subsetExpression || '' } }))}
                            className={cn('px-1.5 py-0.5 text-[10px] rounded border', cur === 'columns' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>Cols</button>
                          <button onClick={() => setDimConfig(p => ({ ...p, [dim]: { axis: p[dim]?.axis === 'rows' ? null : 'rows', subsetExpression: p[dim]?.subsetExpression || '' } }))}
                            className={cn('px-1.5 py-0.5 text-[10px] rounded border', cur === 'rows' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>Rows</button>
                          <button onClick={() => setDimConfig(p => ({ ...p, [dim]: { axis: p[dim]?.axis === 'filter' ? null : 'filter', subsetExpression: p[dim]?.subsetExpression || '' } }))}
                            className={cn('px-1.5 py-0.5 text-[10px] rounded border', cur === 'filter' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>Filt</button>
                        </div>
                        {cur && (
                          <input type="text" placeholder={`{TM1SUBSETALL([${dim}].[${dim}])}`}
                            value={dimConfig[dim]?.subsetExpression || ''}
                            onChange={e => setDimConfig(p => ({ ...p, [dim]: { ...p[dim], subsetExpression: e.target.value } }))}
                            className="w-full font-mono text-[10px] px-1.5 py-0.5 border rounded bg-background" />
                        )}
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
                <button onClick={() => {
                    if (!selectedCube) return
                    // Convert Builder dimConfig → ViewEditor axes format
                    const toEntry = (dim) => {
                        const expr = dimConfig[dim]?.subsetExpression?.trim()
                        const entry = { dimension: dim, subset: null, member: null, members: null, memberSet: null }
                        if (!expr) return entry
                        const subsetMatch = expr.match(/TM1SubsetToSet\([^,]+,\s*"([^"]+)"/)
                        if (subsetMatch) { entry.subset = subsetMatch[1]; return entry }
                        if (expr.includes('FILTERBYLEVEL') && expr.includes(', 0)')) { entry.memberSet = 'leaf'; return entry }
                        if (expr.includes('DefaultMember')) { entry.memberSet = 'root'; return entry }
                        if (expr.includes('SUBSETALL')) { return entry }  // all members = default
                        // Plain member name (filter dims)
                        if (!/[{}()[\]]/.test(expr)) { entry.member = expr; return entry }
                        return entry
                    }
                    const initialAxes = {
                        rows:    axes.rows.map(toEntry),
                        columns: axes.columns.map(toEntry),
                        pages:   axes.filter.map(toEntry),
                    }
                    openTab({
                        id:          `view:${server}:${selectedCube}:guided-${Date.now()}`,
                        type:        'view',
                        label:       selectedCube,
                        server,
                        cube:        selectedCube,
                        initialMdx:  activeMDX,
                        initialAxes,
                    })
                }} disabled={!activeMDX}
                  className="w-full px-3 py-2 rounded bg-primary text-primary-foreground text-xs flex items-center justify-center gap-2 disabled:opacity-40">
                  <ExternalLink size={13} /> Open in View Editor
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
                <div className="flex gap-1">
                  {userEditedMDX && (
                    <button onClick={() => { setViewMDX(generatedMDX); setUserEditedMDX(false) }}
                      className="px-2 py-0.5 text-[9px] rounded border hover:bg-muted text-muted-foreground" title="Reset to generated MDX">↺ Reset</button>
                  )}
                  <button onClick={runViewPreview} disabled={!activeMDX || previewLoading}
                    className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground flex items-center gap-1 disabled:opacity-40">
                    {previewLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run
                  </button>
                </div>
              </div>
              <div className="rounded overflow-hidden mb-3 shrink-0" style={{ height: '55%', minHeight: 140 }}>
                <MonacoEditor
                  height="100%" language="tm1mdx"
                  value={viewMDX}
                  onChange={v => { setViewMDX(v); setUserEditedMDX(true) }}
                  onMount={handleEditorMount}
                  options={{ fontSize: 11, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, folding: false, renderLineHighlight: 'none', overviewRulerLanes: 0, lineNumbers: 'on' }}
                  theme="vs-dark"
                />
              </div>
            </>
          )}
          <div className="text-xs font-medium text-muted-foreground">Results</div>
          <div className="flex-1 min-h-0 rounded overflow-auto bg-background p-2">
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
