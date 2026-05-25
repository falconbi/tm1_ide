import { useState, useRef } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { Play, Loader2, BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MDX_REFERENCE, MDX_KEYWORDS, MDX_FUNCTIONS } from '@/lib/mdx-reference.js'

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

  monaco.languages.registerCompletionItemProvider('mdx', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      }
      const kwSuggestions = MDX_KEYWORDS.map(k => ({
        label: k, kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: k, range,
      }))
      const fnSuggestions = MDX_FUNCTIONS.map(f => ({
        label: f.label, kind: monaco.languages.CompletionItemKind.Function,
        insertText: f.insert, documentation: f.doc,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
      }))
      return { suggestions: [...kwSuggestions, ...fnSuggestions] }
    },
  })
}

// ── Results grid ──────────────────────────────────────────────────────────────

function ResultGrid({ axes, cells, truncated }) {
  const colAxis = axes.find(a => a.Ordinal === 0)
  const rowAxis = axes.find(a => a.Ordinal === 1)
  const colTuples = colAxis?.Tuples ?? []
  const rowTuples = rowAxis?.Tuples ?? []
  const colCount = Math.max(1, colTuples.length)
  const tupleLabel = t => t.Members.map(m => m.Name).join(' / ')

  const cellValue = (ri, ci) => {
    const ordinal = rowTuples.length > 0 ? ri * colCount + ci : ci
    const cell = cells[ordinal]
    if (!cell) return ''
    return cell.FormattedValue !== '' && cell.FormattedValue != null
      ? cell.FormattedValue
      : (cell.Value ?? '')
  }

  const displayRows = rowTuples.length > 0 ? rowTuples : [null]

  return (
    <div>
      {truncated && (
        <div className="px-3 py-1 text-[10px] text-yellow-500 bg-yellow-500/10 border-b border-border">
          Results capped at 50,000 cells — refine your query to see all data
        </div>
      )}
      <div className="text-[10px] text-muted-foreground px-3 py-1 border-b border-border">
        {colTuples.length} col{colTuples.length !== 1 ? 's' : ''} × {Math.max(rowTuples.length, 1)} row{Math.max(rowTuples.length, 1) !== 1 ? 's' : ''}
        {'  •  '}{cells.length} cell{cells.length !== 1 ? 's' : ''}
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-muted">
            {rowAxis && <th className="px-2 py-1 border border-border text-left font-medium sticky left-0 bg-muted min-w-24"></th>}
            {colTuples.map((t, i) => (
              <th key={i} className="px-2 py-1 border border-border text-right font-mono font-normal text-muted-foreground whitespace-nowrap">
                {tupleLabel(t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, ri) => (
            <tr key={ri} className="hover:bg-muted/20">
              {rowAxis && (
                <td className="px-2 py-0.5 border border-border bg-muted/40 font-mono text-muted-foreground whitespace-nowrap sticky left-0">
                  {row ? tupleLabel(row) : ''}
                </td>
              )}
              {colTuples.map((_, ci) => (
                <td key={ci} className="px-2 py-0.5 border border-border text-right font-mono">
                  {String(cellValue(ri, ci))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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

        {/* Toolbar */}
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

        {/* Error output */}
        {error && (
          <div className="shrink-0 max-h-48 overflow-auto border-t border-red-800 bg-red-950/30 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-red-400 mb-1">Error</div>
            <pre className="text-xs text-red-300 whitespace-pre-wrap font-mono">{error}</pre>
          </div>
        )}

        {/* Results grid */}
        {result && !error && (
          <div className="shrink-0 max-h-72 overflow-auto border-t border-border">
            <ResultGrid axes={result.Axes} cells={result.Cells} truncated={result.truncated} />
          </div>
        )}

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
