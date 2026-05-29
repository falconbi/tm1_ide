import { useState, useRef, useMemo, useEffect } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useCubes, useCubeDimensions, useElements } from '@/hooks/useApi'
import { Play, Loader2, BookOpen, ChevronDown, ChevronRight, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MDX_REFERENCE, MDX_KEYWORDS, MDX_FUNCTIONS } from '@/lib/mdx-reference.js'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

ModuleRegistry.registerModules([AllCommunityModule])

const lightTheme = themeBalham.withPart(colorSchemeLight).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })
const darkTheme  = themeBalham.withPart(colorSchemeDark).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })

// Module-level getter so the one-time registered completion provider
// can read live cubes from whichever MDXSandbox is currently mounted.
let _getCubes = () => []
function updateMDXCubes(cubes) {
  _getCubes = () => cubes ?? []
}

// For dimensions of the "current" cube the user is referencing in the MDX
let _getCubeDimensions = () => []
function updateMDXCubeDimensions(dims) {
  _getCubeDimensions = () => dims ?? []
}

// For members of the current dimension (capped for safety)
let _getDimMembers = () => []
function updateMDXDimMembers(members) {
  _getDimMembers = () => (members ?? []).slice(0, 100) // hard safety cap for this slice
}

// "Active" dimension as seen by the completion provider (cursor-aware)
let _activeDimFromProvider = null
function updateActiveDimFromProvider(dim) {
  _activeDimFromProvider = dim || null
}
function getActiveDimFromProvider() {
  return _activeDimFromProvider
}



const DEFAULT_MDX = `-- MDX Sandbox  •  Ctrl+Enter to execute
-- Replace placeholders with your actual cube and dimension names

SELECT
  NON EMPTY {TM1SubsetAll([DimensionName])} ON COLUMNS,
  NON EMPTY {TM1SubsetAll([DimensionName2])} ON ROWS
FROM [CubeName]`

// ── Monaco MDX language registration ─────────────────────────────────────────

let _mdxRegistered = false
function registerMDXLanguage(monaco) {
  if (_mdxRegistered) return
  _mdxRegistered = true

  monaco.languages.register({ id: 'mdx' })

  monaco.languages.setMonarchTokensProvider('mdx', {
    ignoreCase: true,
    keywords: MDX_KEYWORDS,
    tokenizer: {
      root: [
        [/--.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/'[^']*'/, 'string'],
        [/"[^"]*"/, 'string'],
        [/\[[^\]]*\]/, 'variable.other'],
        [/\b(TM1\w+)\b/i, 'type.identifier'],
        [/\b(SELECT|FROM|WHERE|WITH|MEMBER|SET|AS|ON|COLUMNS|ROWS|NON|EMPTY|ALL|PROPERTIES)\b/i, 'keyword'],
        [/\b(CrossJoin|Filter|TopCount|BottomCount|Order|Descendants|Ancestors|PeriodsToDate|Sum|Avg|Count|NonEmpty|Hierarchize|Distinct|Union|Intersect|Except|IIf|IsEmpty|CoalesceEmpty|Generate|Extract)\b/i, 'type.identifier'],
        [/\b(ASC|DESC|BASC|BDESC|SELF|BEFORE|AFTER|BEFORE_AND_AFTER|SELF_AND_BEFORE|SELF_AND_AFTER|SELF_BEFORE_AFTER|LEAVES)\b/i, 'constant.language'],
        [/[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/, 'number'],
        [/[{}()\[\]]/, '@brackets'],
        [/[,;.]/, 'delimiter'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  })

  // Simple client-side context detection for better autocomplete ordering
  function isInsideFromCube(textBefore) {
    const upper = textBefore.toUpperCase()
    const lastFrom = upper.lastIndexOf('FROM')
    if (lastFrom === -1) return false

    const afterFrom = textBefore.slice(lastFrom)
    const opens = (afterFrom.match(/\[/g) || []).length
    const closes = (afterFrom.match(/\]/g) || []).length

    // We're still writing/editing the cube name if there's an unclosed [ after FROM
    return opens > closes
  }

  function getMDXContext(textBefore) {
    const upper = textBefore.toUpperCase()
    if (isInsideFromCube(textBefore)) return 'from'
    if (/\]\s*\.\s*$/.test(textBefore) || /\]\s*\.\s*\[/.test(textBefore)) {
      // After [Cube].  → dimensions
      // After [Dim].[Dim]. or [Dim].[Dim].[Hier]. → member position
      const dimLike = (textBefore.match(/\[[^\]]+\]\.\[[^\]]+\]/g) || []).length
      return dimLike >= 1 ? 'after-dimension' : 'after-cube'
    }
    if (/\[\s*$/.test(textBefore) || textBefore.endsWith('[')) return 'bracket'
    if (/\bSELECT\b/i.test(upper.slice(-30))) return 'select'
    if (/\bWHERE\b/i.test(upper.slice(-30))) return 'where'
    if (/\bWITH\b/i.test(upper.slice(-30))) return 'with'
    return 'default'
  }

  function getSortForContext(label, context) {
    const l = label.toUpperCase()
    // Prioritize useful things in common MDX contexts (client-side only for now)
    if (context === 'from' && (l.includes('SUBSET') || l.includes('CROSS') || l.includes('FILTER') || l.includes('SET'))) return '0' + label
    if (context === 'bracket' && (l.includes('CURRENT') || l.includes('MEMBER') || l.includes('LEVEL') || l.includes('HIERARCHY'))) return '0' + label
    if (context === 'default' && l.startsWith('TM1')) return '0' + label
    if (['SELECT', 'FROM', 'WHERE', 'WITH', 'NON', 'EMPTY'].includes(label)) return '1' + label
    return '9' + label
  }

  monaco.languages.registerCompletionItemProvider('mdx', {
    triggerCharacters: ['[', '.', '(', ' '],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      }

      const textBefore = model.getValueInRange({
        startLineNumber: 1, startColumn: 1,
        endLineNumber: position.lineNumber, endColumn: position.column,
      })
      const context = getMDXContext(textBefore)

      const kwSuggestions = MDX_KEYWORDS.map(k => ({
        label: k,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: k,
        range,
        sortText: getSortForContext(k, context),
      }))

      const fnSuggestions = MDX_FUNCTIONS.map(f => ({
        label: f.label,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: f.insert,
        documentation: f.doc,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        sortText: getSortForContext(f.label, context),
      }))

      // Real cubes from the connected server (only in FROM context for this slice)
      let cubeSuggestions = []
      if (context === 'from') {
        // Smart insertion: look at the character right before the word being replaced,
        // not the character before the cursor. This correctly handles replacing inside
        // an existing [CubeName] placeholder without producing [[Cube]].
        const charBeforeRange = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn - 1,
          endLineNumber: position.lineNumber,
          endColumn: word.startColumn,
        })
        const needsBrackets = charBeforeRange !== '['

        cubeSuggestions = _getCubes().map((cube) => ({
          label: cube,
          kind: monaco.languages.CompletionItemKind.Value,
          insertText: needsBrackets ? `[${cube}]` : cube,
          detail: 'Cube',
          range,
          sortText: '0' + cube, // highest priority when typing after FROM
        }))
      }

      // Dimensions for the current cube the user has referenced (after-cube context)
      let dimSuggestions = []
      if (context === 'after-cube' || context === 'bracket') {
        dimSuggestions = _getCubeDimensions().map((dim) => ({
          label: dim,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: `[${dim}].[${dim}]`,
          detail: 'Dimension',
          range,
          sortText: '1' + dim,
        }))
      }

      // Member-level suggestions after a dimension reference (tiny first pass — static high-value patterns)
      let memberSuggestions = []
      if (context === 'after-dimension') {
        // Try to extract the last dimension name from the text for nice filled-in suggestions
        const lastDimMatch = textBefore.match(/\[([^\]]+)\]\s*\.\s*\[([^\]]+)\]\s*\.?\s*$/)
        const dimName = lastDimMatch ? lastDimMatch[2] : 'Dim'

        // Smart insertion check (shared by both static patterns and real members)
        const charBeforeRange = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn - 1,
          endLineNumber: position.lineNumber,
          endColumn: word.startColumn,
        })
        const isInsideMemberRef = charBeforeRange === '.' || charBeforeRange === '['

        const usefulMemberPatterns = [
          { label: 'CurrentMember', insert: `[${dimName}].[${dimName}].CurrentMember` },
          { label: 'Children',      insert: `[${dimName}].[${dimName}].Children` },
          { label: 'Parent',        insert: `[${dimName}].[${dimName}].Parent` },
          { label: 'Level',         insert: `[${dimName}].[${dimName}].Level` },
          { label: 'TM1FilterByLevel (leaves)', insert: `TM1FilterByLevel({[${dimName}].[${dimName}].Members}, 0)` },
        ]

        memberSuggestions = usefulMemberPatterns.map(p => ({
          label: p.label,
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: isInsideMemberRef 
            ? p.insert.substring(p.insert.lastIndexOf('.') + 1) 
            : p.insert,
          detail: 'Member expression',
          range,
          sortText: '0' + p.label, // very high priority in member position
        }))

        // Real members for the current dimension (capped at source)
        // Update the provider-driven active dim so the component can fetch
        // more accurate members for large queries.
        if (dimName && dimName !== 'Dim') {
          updateActiveDimFromProvider(dimName)
        }

        const realMembers = _getDimMembers()
        realMembers.forEach((el) => {
          const memberName = el.Name ?? el
          // Use the locally extracted dimName (from text before cursor) for insert text.
          // This makes suggestions feel cursor-aware even if the fetched member list
          // is still for the previous "last in document" dimension.
          memberSuggestions.push({
            label: memberName,
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: isInsideMemberRef ? memberName : `[${dimName}].[${dimName}].[${memberName}]`,
            detail: 'Member',
            range,
            sortText: '2' + memberName,
          })
        })
      }

      return { suggestions: [...cubeSuggestions, ...dimSuggestions, ...memberSuggestions, ...kwSuggestions, ...fnSuggestions] }
    },
  })
}

// ── Results grid (AG Grid) ────────────────────────────────────────────────────
// Uses the same cellset→grid mapping + theming pattern as CubeViewer.jsx (and ViewEditor, DimensionEditor).
// Duplicated helpers here for Step 0.1 minimal change; can be extracted to @/lib later.

function parseDimFromUniqueName(un) {
  return un?.match(/^\[([^\]]+)\]/)?.[1] ?? ''
}

function parseCellset(data) {
  if (!data?.Axes?.length) return null
  const colAx = data.Axes.find(a => a.Ordinal === 0)
  const rowAx = data.Axes.find(a => a.Ordinal === 1)
  if (!colAx) return null

  const colTuples = colAx.Tuples ?? []
  const rowTuples = rowAx ? (rowAx.Tuples ?? []) : []

  // Column headers — join multi-member tuples
  const cols = colTuples.map(t => (t.Members ?? []).map(m => m.Name).join(' / '))

  // Row headers — keep as arrays for multi-dim split
  const rowDimNames = (rowTuples[0]?.Members ?? []).map(m => parseDimFromUniqueName(m.UniqueName))
  const rows = rowTuples.map(t => (t.Members ?? []).map(m => m.Name))

  const numCols = cols.length
  const cellMap = {}
  ;(data.Cells ?? []).forEach(c => { cellMap[c.Ordinal] = c })

  const grid = (rows.length ? rows : [[]]).map((_, ri) =>
    cols.map((_, ci) => {
      const c = cellMap[ri * numCols + ci]
      return c ? (c.FormattedValue ?? c.Value ?? '') : ''
    })
  )

  return { cols, rows, rowDimNames, grid }
}

function buildGridData(parsed) {
  if (!parsed) return { colDefs: [], rowData: [] }
  const { cols, rows, rowDimNames, grid } = parsed
  const rowDimCount = rowDimNames.length || 1

  const rowColDefs = Array.from({ length: rowDimCount }, (_, i) => ({
    field: `__row_${i}__`,
    headerName: rowDimNames[i] ?? '',
    pinned: 'left',
    width: 160,
    minWidth: 60,
    resizable: true,
    cellStyle: (params) => {
      // Visually deduplicate outer dimensions
      if (i < rowDimCount - 1 && params.node.rowIndex > 0) {
        const prev = params.api.getDisplayedRowAtIndex(params.node.rowIndex - 1)?.data?.[`__row_${i}__`]
        if (prev === params.value) return { fontWeight: 600, color: 'var(--ag-row-border-color, #ccc)' }
      }
      return { fontWeight: 600 }
    },
  }))

  const colDefs = [
    ...rowColDefs,
    ...cols.map((c, i) => ({
      field: `c${i}`, headerName: c, width: 110, minWidth: 60, resizable: true, type: 'numericColumn',
      valueFormatter: p => (p.value === '' || p.value == null) ? '—' : String(p.value),
      cellStyle: p => (p.value === '' || p.value == null) ? { color: '#888' } : {},
    })),
  ]

  const rowData = grid.map((row, ri) => {
    const obj = {}
    const members = rows[ri] ?? []
    Array.from({ length: rowDimCount }, (_, i) => { obj[`__row_${i}__`] = members[i] ?? '' })
    row.forEach((v, ci) => { obj[`c${ci}`] = v })
    return obj
  })

  return { colDefs, rowData }
}

function ResultGrid({ axes, cells, truncated }) {
  const { dark } = useStore()
  const gridRef = useRef(null)

  // Keep lightweight extraction for the exact stats banner UX (cheap, no full parse needed)
  const colAxis = axes?.find(a => a.Ordinal === 0)
  const rowAxis = axes?.find(a => a.Ordinal === 1)
  const colTuples = colAxis?.Tuples ?? []
  const rowTuples = rowAxis?.Tuples ?? []

  const parsed = useMemo(() => {
    if (!axes?.length || !cells) return null
    return parseCellset({ Axes: axes, Cells: cells })
  }, [axes, cells])

  const { colDefs, rowData } = useMemo(() => buildGridData(parsed), [parsed])

  const handleExportCSV = () => {
    gridRef.current?.api?.exportDataAsCsv()
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {truncated && (
        <div className="px-3 py-1 text-[10px] text-yellow-500 bg-yellow-500/10 border-b border-border shrink-0">
          Results capped at 50,000 cells — refine your query to see all data
        </div>
      )}
      <div className="text-[10px] text-muted-foreground px-3 py-1 border-b border-border shrink-0 flex items-center justify-between">
        <span>
          {colTuples.length} col{colTuples.length !== 1 ? 's' : ''} × {Math.max(rowTuples.length, 1)} row{Math.max(rowTuples.length, 1) !== 1 ? 's' : ''}
          {'  •  '}{cells.length} cell{cells.length !== 1 ? 's' : ''}
        </span>
        {colDefs.length > 0 && (
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border hover:bg-muted transition-colors"
            title="Export visible results as CSV"
          >
            <Download size={10} /> CSV
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {colDefs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs select-none">
            No data returned
          </div>
        ) : (
          <AgGridReact
            ref={gridRef}
            theme={dark ? darkTheme : lightTheme}
            columnDefs={colDefs}
            rowData={rowData}
            suppressMovableColumns
            enableCellTextSelection
            defaultColDef={{ sortable: false }}
            onFirstDataRendered={p => p.api.autoSizeAllColumns()}
          />
        )}
      </div>
    </div>
  )
}

// ── Reference panel ───────────────────────────────────────────────────────────

function ReferencePanel({ onInsert }) {
  const [openCat, setOpenCat] = useState('TM1 Functions')

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="text-xs font-semibold">MDX Reference</div>
        <div className="text-[10px] text-muted-foreground">Click any example to insert at cursor</div>
      </div>
      <div className="flex-1 overflow-auto">
        {MDX_REFERENCE.map(cat => (
          <div key={cat.category}>
            <button
              onClick={() => setOpenCat(o => o === cat.category ? null : cat.category)}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground border-b border-border/50 sticky top-0 bg-sidebar z-10"
            >
              {openCat === cat.category ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {cat.category}
            </button>
            {openCat === cat.category && (
              <div className="py-0.5">
                {cat.items.map(item => (
                  <button
                    key={item.label}
                    onClick={() => onInsert(item.code)}
                    className="w-full text-left px-3 py-1.5 hover:bg-sidebar-accent group border-b border-border/20"
                  >
                    <div className="text-xs text-sidebar-foreground group-hover:text-sidebar-accent-foreground font-medium">
                      {item.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                      {item.description}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MDXSandbox({ tab, onCursor }) {
  const { dark } = useStore()
  const editorRef = useRef(null)
  const [mdx, setMdx]       = useState(tab.content ?? DEFAULT_MDX)
  const [result, setResult] = useState(null)
  const [error, setError]   = useState(null)
  const [running, setRunning] = useState(false)
  const [showRef, setShowRef] = useState(true)

  // Simple query history (last 30 successful queries, persisted to localStorage)
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('mdx-query-history')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [showHistory, setShowHistory] = useState(false)
  const [mode, setMode] = useState('guided') // 'raw' | 'guided' — default to the new Guided Builder per user request ("done with small slices get it done now")

  // Handler for switching from Guided back to Raw, optionally seeding the editor with generated MDX
  const switchToRaw = (initialMdx) => {
    if (initialMdx) setMdx(initialMdx)
    setMode('raw')
  }

  const saveToHistory = (query) => {
    const trimmed = query.trim()
    if (!trimmed || trimmed.startsWith('--')) return

    const entry = { query: trimmed, ts: Date.now() }

    setHistory(prev => {
      // Remove duplicates of this exact query
      const filtered = prev.filter(h => h.query !== trimmed)
      const next = [entry, ...filtered].slice(0, 30)
      try {
        localStorage.setItem('mdx-query-history', JSON.stringify(next))
      } catch {}
      return next
    })
  }

  // Live cubes from the connected server (used for FROM-context completions)
  const { data: cubes = [] } = useCubes(tab.server)
  useEffect(() => {
    updateMDXCubes(cubes)
  }, [cubes])

  // Derive a "current cube" from the MDX text (simple heuristic for the first cube in FROM)
  const currentCube = useMemo(() => {
    const fromMatch = mdx.match(/FROM\s+\[([^\]]+)\]/i)
    return fromMatch ? fromMatch[1] : null
  }, [mdx])

  // Load dimensions for the current cube the user is working with
  const { data: cubeDims = [] } = useCubeDimensions(tab.server, currentCube)
  useEffect(() => {
    updateMDXCubeDimensions(cubeDims)
  }, [cubeDims])

  // Derive a "current dimension" from the MDX text (last [Dim].[Dim] reference)
  const currentDim = useMemo(() => {
    const matches = mdx.match(/\[[^\]]+\]\.\[[^\]]+\]/g) || []
    if (matches.length > 0) {
      const last = matches[matches.length - 1]
      const dimMatch = last.match(/\]\.\[([^\]]+)\]/)
      return dimMatch ? dimMatch[1] : null
    }
    return null
  }, [mdx])

  // Load (capped) members for the current dimension
  const { data: dimMembers = [] } = useElements(tab.server, currentDim)
  useEffect(() => {
    updateMDXDimMembers(dimMembers)
  }, [dimMembers])

  const execute = async () => {
    console.log('[MDX] Execute button clicked, current mdx:', mdx)
    const q = mdx.trim()
    // Strip leading comment lines (lines starting with --) before deciding if the query is empty
    const withoutComments = q.replace(/^\s*--.*$/gm, '').trim()
    if (!withoutComments) {
      console.log('[MDX] Execute aborted: empty or comment-only')
      return
    }

    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/mdx/execute?server=${encodeURIComponent(tab.server)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mdx: q }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Execution failed')
      setResult(data)
      saveToHistory(q)
    } catch (e) {
      // Try to parse structured TM1 errors (they often come back as JSON strings)
      let parsedError = e.message
      try {
        const maybeJson = JSON.parse(e.message)
        if (typeof maybeJson === 'object' && maybeJson !== null) {
          parsedError = maybeJson
        }
      } catch {
        // not JSON, keep as string
      }
      setError(parsedError)
    } finally {
      setRunning(false)
    }
  }

  const insertSnippet = (code) => {
    const editor = editorRef.current
    if (!editor) { setMdx(code); return }
    const sel = editor.getSelection()
    editor.executeEdits('mdx-ref', [{ range: sel, text: code }])
    editor.focus()
  }

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    registerMDXLanguage(monaco)
    editor.onDidChangeCursorPosition(e => {
      onCursor?.({ line: e.position.lineNumber, col: e.position.column })
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, execute)
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left: editor + results */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">

        {/* Toolbar - fixed above the resizable split */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/40 shrink-0">
          {mode === 'raw' && (
            <>
              <button
                onClick={execute}
                disabled={running}
                className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                {running ? 'Running…' : 'Execute'}
              </button>
              <span className="text-[10px] text-muted-foreground">Ctrl+Enter</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center border border-border rounded text-xs">
              <button
                onClick={() => setMode('guided')}
                className={cn('px-2 py-1 rounded-l', mode === 'guided' && 'bg-primary text-primary-foreground')}
              >
                Guided
              </button>
              <button
                onClick={() => setMode('raw')}
                className={cn('px-2 py-1 border-l border-border rounded-r', mode === 'raw' && 'bg-primary text-primary-foreground')}
              >
                Raw Editor
              </button>
            </div>

            <button
              onClick={() => setShowHistory(v => !v)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors',
                showHistory
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              History
            </button>
            <button
              onClick={() => setShowRef(v => !v)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors',
                showRef
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              <BookOpen size={11} />
              Reference
            </button>
          </div>
        </div>

        {/* Simple query history (toggleable) */}
        {showHistory && history.length > 0 && mode === 'raw' && (
          <div className="shrink-0 border-b border-border bg-muted/30 max-h-40 overflow-auto text-xs">
            {history.map((h, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setMdx(h.query)
                  setShowHistory(false)
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-muted border-b border-border/50 font-mono text-muted-foreground hover:text-foreground"
                title={h.query}
              >
                <span className="text-[10px] text-muted-foreground/60 mr-2">
                  {new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {h.query.length > 120 ? h.query.slice(0, 117) + '...' : h.query}
              </button>
            ))}
          </div>
        )}

        {mode === 'guided' ? (
          <div className="flex-1 min-h-0">
            <GuidedMDXBuilder server={tab.server} onSwitchToRaw={switchToRaw} />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex items-center justify-center text-muted-foreground text-sm border border-dashed m-4 rounded">
            Raw MDX editor (Monaco + AG Grid results) — temporarily stubbed for build diagnosis. Switch to Guided or restore full raw branch.
          </div>
      )

      </div>

      {/* Reference panel */}
      {showRef && (
        <div className="w-72 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
          <ReferencePanel onInsert={insertSnippet} />
        </div>
      )}
    </div>
  )
}
