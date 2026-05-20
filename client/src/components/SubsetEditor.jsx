import { useState, useEffect, useRef, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@/store'
import { useSubset, useSaveSubset, usePreviewMDX, useGenerateMDX, useElements } from '@/hooks/useApi'
import { MDX_CATALOG, MDX_FUNCTIONS_FLAT, MDX_ADVANCED_PATTERNS } from '@/lib/tm1-mdx-catalog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Play, Loader2, Sparkles, Copy, Search, ChevronDown, ChevronRight } from 'lucide-react'
import SubsetVisualEditor from './SubsetVisualEditor'

const TYPE_ICON  = { N: '○', C: '◆', S: '"' }
const TYPE_COLOR = { N: 'text-blue-500', C: 'text-orange-500', S: 'text-green-500' }

const MDX_TEMPLATES = [
  { label: 'All members',         mdx: '{[{dim}].[{dim}].Members}' },
  { label: 'Leaf only',           mdx: '{TM1FilterByLevel({[{dim}].[{dim}].Members}, 0)}' },
  { label: 'Consolidated only',   mdx: '{TM1FilterByLevel({[{dim}].[{dim}].Members}, 1)}' },
  { label: 'Filter by attribute', mdx: '{Filter({[{dim}].[{dim}].Members}, [{dim}].[{dim}].CurrentMember.Properties("Attribute") = "Value")}' },
  { label: 'Top 10',              mdx: '{TopCount({[{dim}].[{dim}].Members}, 10)}' },
]

// ── Function Palette ──────────────────────────────────────────────────────────

function FnCard({ fn, onInsert }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border/40">
      <div
        className="flex items-start gap-1 px-2 py-1.5 hover:bg-muted cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <span className="mt-px shrink-0 text-muted-foreground">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-mono font-semibold text-primary">{fn.name}</span>
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{fn.description}</p>
        </div>
      </div>

      {open && (
        <div className="px-3 pb-2 space-y-1.5 bg-muted/30">
          {/* Signature */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-0.5">Signature</p>
            <code className="text-[10px] font-mono text-foreground">{fn.signature}</code>
          </div>

          {/* Parameters */}
          {fn.params.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-0.5">Parameters</p>
              <ul className="space-y-0.5">
                {fn.params.map((p, i) => {
                  const [name, ...rest] = p.split(' — ')
                  return (
                    <li key={i} className="text-[10px]">
                      <span className="font-mono text-primary">{name}</span>
                      {rest.length > 0 && <span className="text-muted-foreground"> — {rest.join(' — ')}</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* Example */}
          {fn.example && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-0.5">Example</p>
              <code className="text-[10px] font-mono text-green-400 break-all">{fn.example}</code>
            </div>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onInsert(fn) }}
            className="mt-1 w-full py-0.5 text-[10px] rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Insert at cursor
          </button>
        </div>
      )}
    </div>
  )
}

function FunctionPalette({ onInsert }) {
  const [query, setQuery] = useState('')
  const [openCats, setOpenCats] = useState(() => new Set())

  const toggle = (cat) => setOpenCats(s => {
    const n = new Set(s); n.has(cat) ? n.delete(cat) : n.add(cat); return n
  })

  const q = query.toLowerCase()
  const filtered = MDX_CATALOG.map(c => ({
    ...c,
    fns: c.fns.filter(f => !q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)),
  })).filter(c => c.fns.length > 0)

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs">
          <Search size={10} className="text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search functions…"
            className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/50"
          />
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {filtered.map(cat => (
          <div key={cat.category}>
            <button
              onClick={() => toggle(cat.category)}
              className="flex items-center gap-1.5 w-full px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground bg-muted/50"
            >
              {openCats.has(cat.category) ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              {cat.category}
            </button>
            {openCats.has(cat.category) && cat.fns.map(fn => (
              <FnCard key={fn.name} fn={fn} onInsert={onInsert} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Register Monaco MDX completions + signature help ─────────────────────────

function registerMDXLanguage(monaco, dimension, getElements) {
  // Completions: functions + members
  monaco.languages.registerCompletionItemProvider('tm1mdx', {
    triggerCharacters: ['.', '[', '('],
    provideCompletionItems: async (model, position) => {
      const textBefore = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
      const word = model.getWordUntilPosition(position)
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }

      const suggestions = []

      // Function completions
      for (const fn of MDX_FUNCTIONS_FLAT) {
        suggestions.push({
          label: fn.name,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: fn.signature,
          documentation: { value: `**${fn.name}**\n\n${fn.description}\n\n*Example:* \`${fn.example}\`` },
          insertText: fn.template,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })
      }

      // Member completions — triggered after [Dim].[Dim].
      const memberTrigger = new RegExp(`\\[${dimension}\\]\\.\\[${dimension}\\]\\.\\s*$`, 'i')
      if (memberTrigger.test(textBefore)) {
        const elements = await getElements()
        for (const el of (elements ?? [])) {
          suggestions.push({
            label: el.Name,
            kind: monaco.languages.CompletionItemKind.Value,
            detail: el.Type === 'N' ? 'Leaf' : el.Type === 'C' ? 'Consolidated' : 'String',
            insertText: `[${el.Name}]`,
            range,
            sortText: el.Type === 'C' ? '0' + el.Name : '1' + el.Name,
          })
        }
      }

      // Dimension/hierarchy shorthand
      if (/\[$/.test(textBefore)) {
        suggestions.push({
          label: `[${dimension}].[${dimension}]`,
          kind: monaco.languages.CompletionItemKind.Module,
          detail: 'This dimension',
          insertText: `[${dimension}].[${dimension}]`,
          range,
        })
      }

      return { suggestions }
    },
  })

  // Signature help
  monaco.languages.registerSignatureHelpProvider('tm1mdx', {
    signatureHelpTriggerCharacters: ['(', ','],
    provideSignatureHelp: (model, position) => {
      const text = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
      // Find innermost open function call
      let depth = 0; let fnStart = -1
      for (let i = text.length - 1; i >= 0; i--) {
        if (text[i] === ')') depth++
        else if (text[i] === '(') {
          if (depth === 0) { fnStart = i; break }
          depth--
        }
      }
      if (fnStart < 0) return null
      const fnName = text.slice(0, fnStart).match(/[\w]+$/)?.[0]
      if (!fnName) return null
      const fn = MDX_FUNCTIONS_FLAT.find(f => f.name.toLowerCase() === fnName.toLowerCase())
      if (!fn || fn.params.length === 0) return null

      const activeParam = (text.slice(fnStart).match(/,/g) ?? []).length

      return {
        value: {
          signatures: [{
            label: fn.signature,
            documentation: fn.description,
            parameters: fn.params.map(p => ({ label: p })),
          }],
          activeSignature: 0,
          activeParameter: Math.min(activeParam, fn.params.length - 1),
        },
        dispose: () => {},
      }
    },
  })
}

// ── Pattern Card ─────────────────────────────────────────────────────────────

function PatternCard({ pattern: p, dimension, onUse }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border/40">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 hover:bg-muted text-left"
      >
        <span className="shrink-0 text-muted-foreground">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
        <span className="text-xs font-semibold text-foreground">{p.name}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-1.5 bg-muted/30">
          <p className="text-[10px] text-muted-foreground leading-tight">{p.description}</p>
          <pre className="text-[9px] font-mono text-green-400 bg-muted/50 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap">{p.mdx(dimension)}</pre>
          <button onClick={onUse}
            className="w-full py-0.5 text-[10px] rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
            Use this pattern
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SubsetEditor({ tab }) {
  const { server, dark, markTabSaved, bumpSubsetVersion } = useStore()
  const queryClient = useQueryClient()
  const { data, isLoading } = useSubset(tab.server, tab.dimension, tab.subsetName)
  const saveSubset  = useSaveSubset()
  const previewMDX  = usePreviewMDX()
  const generateMDX = useGenerateMDX()
  const { data: elements } = useElements(tab.server, tab.dimension)

  const [mode, setMode]         = useState('visual')    // 'visual' | 'mdx'
  const [mdx, setMdx]           = useState(null)
  const [members, setMembers]   = useState(null)
  const [dirty, setDirty]       = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [copyingPrompt, setCopyingPrompt] = useState(false)
  const [rightTab, setRightTab] = useState('members')   // 'members' | 'functions' | 'patterns'
  const [validating, setValidating] = useState(false)

  const editorRef      = useRef(null)
  const monacoRef      = useRef(null)
  const registeredRef  = useRef(false)
  const validateTimer  = useRef(null)
  const elementsRef    = useRef(null)
  elementsRef.current  = elements

  useEffect(() => {
    if (data && mdx === null) {
      setMdx(data.Expression ?? '')
      setMode(data.Expression ? 'mdx' : 'visual')
    }
  }, [data])

  // Inline validation — debounced 800ms
  useEffect(() => {
    if (!mdx?.trim() || !editorRef.current || !monacoRef.current) return
    clearTimeout(validateTimer.current)
    validateTimer.current = setTimeout(async () => {
      setValidating(true)
      try {
        const enc = encodeURIComponent
        const r = await fetch(`/api/subset/preview?server=${enc(tab.server)}&dimension=${enc(tab.dimension)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mdx, limit: 1 }),
        })
        const model = editorRef.current.getModel()
        if (r.ok) {
          monacoRef.current.editor.setModelMarkers(model, 'mdx-validate', [])
        } else {
          const d = await r.json().catch(() => ({}))
          monacoRef.current.editor.setModelMarkers(model, 'mdx-validate', [{
            severity: monacoRef.current.MarkerSeverity.Error,
            message: d.error || 'Invalid MDX',
            startLineNumber: 1, startColumn: 1,
            endLineNumber: editorRef.current.getModel().getLineCount(),
            endColumn: 9999,
          }])
        }
      } catch { /* ignore network errors during validation */ }
      finally { setValidating(false) }
    }, 800)
    return () => clearTimeout(validateTimer.current)
  }, [mdx])

  const handleExecute = () => {
    if (!mdx?.trim()) return
    previewMDX.mutate(
      { server: tab.server, dimension: tab.dimension, mdx },
      {
        onSuccess: (d) => { setMembers(d.members); setRightTab('members') },
        onError:   (e) => toast.error(e.message),
      }
    )
  }

  const handleSave = () => {
    const id = toast.loading('Saving subset…')
    saveSubset.mutate(
      { server: tab.server, dimension: tab.dimension, name: tab.subsetName, mdx },
      {
        onSuccess: () => {
          setDirty(false)
          markTabSaved(tab.id)
          toast.success('Subset saved', { id })
          bumpSubsetVersion(tab.server, tab.dimension)
        },
        onError:   (e) => toast.error(e.message, { id }),
      }
    )
  }

  const applyTemplate = (t) => {
    setMdx(t.mdx.replaceAll('{dim}', tab.dimension))
    setDirty(true); setMembers(null)
  }

  const handleGenerate = () => {
    if (!aiPrompt.trim() || generateMDX.isPending) return
    generateMDX.mutate(
      { server: tab.server, dimension: tab.dimension, prompt: aiPrompt },
      {
        onSuccess: (d) => { setMdx(d.mdx); setDirty(true); setMembers(null) },
        onError:   (e) => toast.error(e.message),
      }
    )
  }

  const handleCopyPrompt = async () => {
    if (copyingPrompt) return
    setCopyingPrompt(true)
    try {
      const enc = encodeURIComponent
      const r = await fetch(`/api/elements?server=${enc(tab.server)}&dimension=${enc(tab.dimension)}`)
      const els = await r.json()
      const sample = els.slice(0, 200)
        .map(e => `${e.Name} (${e.Type === 'N' ? 'leaf' : e.Type === 'C' ? 'consolidated' : 'string'}, level ${e.Level})`)
        .join('\n')
      const prompt = `You are a TM1 MDX expert. Generate a valid TM1 MDX set expression.

Return ONLY the raw MDX expression — no markdown, no explanation, no code fences. Wrap the entire expression in outer {}.

Dimension: ${tab.dimension}

Sample elements (up to 200):
${sample}

Request: ${aiPrompt || '(describe what members you want)'}

Common TM1 MDX functions: TM1FilterByLevel, TM1FilterByPattern, TM1Sort, TopCount, BottomCount, Filter, CrossJoin, Descendants, Children, Ancestors, Members.
Leaf = Type N (level 0). Consolidated = Type C (level > 0).
Member reference: [${tab.dimension}].[${tab.dimension}].[MemberName]`
      await navigator.clipboard.writeText(prompt)
      toast.success('Prompt copied to clipboard')
    } catch (e) { toast.error('Failed to copy: ' + e.message) }
    finally { setCopyingPrompt(false) }
  }

  const handleInsertFunction = useCallback((fn) => {
    const editor = editorRef.current
    if (!editor) return
    // Replace placeholders with actual dimension name
    const snippet = fn.template.replaceAll('${1:Dim}', tab.dimension).replaceAll('${1:dim}', tab.dimension)
    const sel = editor.getSelection()
    editor.executeEdits('insert-fn', [{ range: sel, text: snippet, forceMoveMarkers: true }])
    editor.focus()
  }, [tab.dimension])

  const handleMount = (editor, monaco) => {
    editorRef.current  = editor
    monacoRef.current  = monaco

    // Fix paste
    editor.getDomNode()?.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      e.preventDefault(); e.stopPropagation()
      editor.executeEdits('paste', [{ range: editor.getSelection(), text, forceMoveMarkers: true }])
      editor.focus()
    }, true)

    if (!registeredRef.current) {
      registeredRef.current = true
      registerMDXLanguage(monaco, tab.dimension, () => Promise.resolve(elementsRef.current))
    }
  }

  if (isLoading && mdx === null) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading subset…</div>
  }

  const handleMdxConvert = (generatedMdx) => {
    setMdx(generatedMdx)
    setDirty(true)
    setMembers(null)
    setMode('mdx')
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Mode tabs ───────────────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-border bg-muted shrink-0">
        <div className="flex px-2 gap-0.5 py-1">
          {[{ id: 'visual', label: 'Visual' }, { id: 'mdx', label: 'MDX' }].map(t => (
            <button
              key={t.id}
              onClick={() => setMode(t.id)}
              className={cn(
                'px-3 py-0.5 text-xs rounded transition-colors',
                mode === t.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground font-medium px-1">{tab.dimension}</span>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-xs font-mono px-1">{tab.subsetName}</span>
      </div>

      {/* ── Visual mode ─────────────────────────────────────────────────────── */}
      {mode === 'visual' && (
        <SubsetVisualEditor
          tab={tab}
          onMdxConvert={handleMdxConvert}
        />
      )}

      {/* ── MDX mode ────────────────────────────────────────────────────────── */}
      {mode === 'mdx' && <>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/60 shrink-0">
        {validating && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExecute}
            disabled={!mdx?.trim() || previewMDX.isPending}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-green-600 text-white disabled:opacity-40 hover:bg-green-700 transition-colors"
          >
            {previewMDX.isPending ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            Execute
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saveSubset.isPending}
            className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {saveSubset.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── AI Prompt ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
        <Sparkles size={12} className="shrink-0 text-violet-400" />
        <input
          value={aiPrompt}
          onChange={e => setAiPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGenerate()}
          placeholder="Describe the members you want, e.g. all leaf members under EMEA"
          className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
        />
        <button onClick={handleCopyPrompt} disabled={copyingPrompt}
          className="flex items-center gap-1 px-2.5 py-0.5 text-xs rounded border border-border text-muted-foreground disabled:opacity-40 hover:bg-muted transition-colors shrink-0"
          title="Copy prompt for external AI">
          {copyingPrompt ? <Loader2 size={11} className="animate-spin" /> : <Copy size={11} />}
          Copy Prompt
        </button>
        <button onClick={handleGenerate} disabled={!aiPrompt.trim() || generateMDX.isPending}
          className="flex items-center gap-1 px-2.5 py-0.5 text-xs rounded bg-violet-600 text-white disabled:opacity-40 hover:bg-violet-700 transition-colors shrink-0">
          {generateMDX.isPending ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          Generate
        </button>
      </div>

      {/* ── Editor + Right Panel ─────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Monaco */}
        <div className="flex-1 min-w-0">
          <MonacoEditor
            height="100%"
            language="tm1mdx"
            value={mdx ?? ''}
            theme={dark ? 'vs-dark' : 'vs'}
            onChange={v => { setMdx(v); setDirty(true); setMembers(null) }}
            onMount={handleMount}
            options={{
              fontSize: 13,
              minimap: { enabled: false },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              lineNumbers: 'off',
              suggestOnTriggerCharacters: true,
              quickSuggestions: true,
              parameterHints: { enabled: true },
            }}
          />
        </div>

        {/* Right panel */}
        <div className="w-64 shrink-0 border-l border-border flex flex-col bg-sidebar">

          {/* Tabs */}
          <div className="flex border-b border-border shrink-0">
            {[
              { id: 'members',  label: 'Members' },
              { id: 'functions', label: 'Fns' },
              { id: 'patterns', label: 'Patterns' },
            ].map(t => (
              <button key={t.id} onClick={() => setRightTab(t.id)}
                className={cn('flex-1 py-1.5 text-xs transition-colors',
                  rightTab === t.id ? 'border-b-2 border-primary text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}>
                {t.label}
                {t.id === 'members' && members && <span className="ml-1 text-muted-foreground">({members.length})</span>}
              </button>
            ))}
          </div>

          {/* Members */}
          {rightTab === 'members' && (
            <div className="flex-1 min-h-0 overflow-auto">
              {!members && !previewMDX.isPending && (
                <p className="px-3 py-3 text-xs text-muted-foreground">Click Execute to preview members.</p>
              )}
              {previewMDX.isPending && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin text-muted-foreground" />
                </div>
              )}
              {members?.map(m => (
                <div key={m.name} className="flex items-center gap-2 px-3 py-0.5 text-xs hover:bg-muted">
                  <span className={cn('shrink-0 text-[10px]', TYPE_COLOR[m.type])}>{TYPE_ICON[m.type] ?? '·'}</span>
                  <span className="font-mono truncate">{m.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Functions */}
          {rightTab === 'functions' && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <FunctionPalette onInsert={handleInsertFunction} />
            </div>
          )}

          {/* Advanced Patterns */}
          {rightTab === 'patterns' && (
            <div className="flex-1 min-h-0 overflow-auto">
              {MDX_ADVANCED_PATTERNS[0].patterns.map(p => (
                <PatternCard key={p.name} pattern={p} dimension={tab.dimension}
                  onUse={() => { setMdx(p.mdx(tab.dimension)); setDirty(true); setMembers(null) }} />
              ))}
            </div>
          )}
        </div>
      </div>

      </>}
    </div>
  )
}
