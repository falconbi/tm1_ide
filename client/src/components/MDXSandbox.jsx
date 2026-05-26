import { useState, useRef, useMemo } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { Play, Loader2, BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MDX_REFERENCE, MDX_KEYWORDS, MDX_FUNCTIONS } from '@/lib/mdx-reference.js'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

ModuleRegistry.registerModules([AllCommunityModule])

const lightTheme = themeBalham.withPart(colorSchemeLight).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })
const darkTheme  = themeBalham.withPart(colorSchemeDark).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })

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
  function getMDXContext(textBefore) {
    const upper = textBefore.toUpperCase()
    if (/\bFROM\s*$/.test(upper) || /\bFROM\s*\[$/.test(upper)) return 'from'
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

      return { suggestions: [...kwSuggestions, ...fnSuggestions] }
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {truncated && (
        <div className="px-3 py-1 text-[10px] text-yellow-500 bg-yellow-500/10 border-b border-border shrink-0">
          Results capped at 50,000 cells — refine your query to see all data
        </div>
      )}
      <div className="text-[10px] text-muted-foreground px-3 py-1 border-b border-border shrink-0">
        {colTuples.length} col{colTuples.length !== 1 ? 's' : ''} × {Math.max(rowTuples.length, 1)} row{Math.max(rowTuples.length, 1) !== 1 ? 's' : ''}
        {'  •  '}{cells.length} cell{cells.length !== 1 ? 's' : ''}
      </div>
      <div className="flex-1 min-h-0">
        {colDefs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs select-none">
            No data returned
          </div>
        ) : (
          <AgGridReact
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

  const execute = async () => {
    const q = mdx.trim()
    if (!q || q.startsWith('--')) {
      // strip comment-only lines and retry
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
    } catch (e) {
      setError(e.message)
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
          <button
            onClick={execute}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            {running ? 'Running…' : 'Execute'}
          </button>
          <span className="text-[10px] text-muted-foreground">Ctrl+Enter</span>
          <div className="ml-auto">
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

        {/* Vertical resizable split: Editor (top) vs Output/Results (bottom) */}
        <PanelGroup direction="vertical" className="flex-1 min-h-0">
          {/* Editor + Error (top pane) */}
          <Panel defaultSize={72} minSize={40} className="flex flex-col min-h-0">
            {/* Monaco editor */}
            <div className="flex-1 min-h-0">
              <MonacoEditor
                height="100%"
                language="mdx"
                value={mdx}
                theme={dark ? 'vs-dark' : 'vs'}
                onChange={v => setMdx(v ?? '')}
                onMount={handleMount}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  suggestOnTriggerCharacters: true,
                }}
              />
            </div>

            {/* Error output stays with the editor */}
            {error && (
              <div className="shrink-0 max-h-48 overflow-auto border-t border-red-800 bg-red-950/30 px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-red-400 mb-1">Error</div>
                <pre className="text-xs text-red-300 whitespace-pre-wrap font-mono">{error}</pre>
              </div>
            )}
          </Panel>

          {/* Horizontal resize handle - drag up/down to resize the Output panel */}
          <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 transition-colors cursor-row-resize shrink-0" />

          {/* Output / Results (bottom pane) */}
          <Panel defaultSize={28} minSize={12} className="flex flex-col min-h-0 border-t border-border">
            {result && !error ? (
              <ResultGrid axes={result.Axes} cells={result.Cells} truncated={result.truncated} />
            ) : (
              <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground select-none">
                Run a query (Ctrl+Enter) to see results here
              </div>
            )}
          </Panel>
        </PanelGroup>

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
