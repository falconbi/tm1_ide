import { useState, useEffect, useRef, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@/store'
import { useSubset, useSaveSubset, usePreviewMDX, useGenerateMDX, useElements, useSubsetUsage, useAttrGrid } from '@/hooks/useApi'
import { MDX_CATALOG, MDX_FUNCTIONS_FLAT } from '@/lib/tm1-mdx-catalog'
import { MDX_PATTERN_CATEGORIES } from '@/lib/tm1-mdx-primer-patterns'
import { subsetApplyCallbacks } from '@/lib/subsetCallbacks'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Play, Loader2, Sparkles, Copy, Search, ChevronDown, ChevronRight, ChevronLeft, Box, Cog, MapPin, Clock, Save, AlignLeft, Check, X } from 'lucide-react'
import SubsetVisualEditor from './SubsetVisualEditor'

const TYPE_ICON  = { N: '○', C: '◆', S: '"' }
const TYPE_COLOR = { N: 'text-blue-400', C: 'text-amber-400', S: 'text-emerald-400' }

// Patterns that WRAP the existing expression (Filtering, Ranking, Sorting categories)
const WRAP_CATEGORIES = new Set(['Filtering', 'Ranking', 'Sorting'])

const SESSIONS_KEY = 'tm1-subset-sessions'
function loadSessions() { try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]') } catch { return [] } }
function saveSessionEntry(entry) {
  const list = loadSessions().filter(s => s.name !== entry.name)
  list.unshift({ ...entry, time: Date.now() })
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(list.slice(0, 30)))
}

function formatMDX(mdx) {
  if (!mdx?.trim()) return mdx
  let out = '', depth = 0, i = 0
  const pad = (n) => '  '.repeat(Math.max(0, n))
  while (i < mdx.length) {
    const ch = mdx[i]
    if (ch === '{') { out += '{\n' + pad(depth + 1); depth++ }
    else if (ch === '}') { depth--; out = out.trimEnd() + '\n' + pad(depth) + '}' }
    else if (ch === ',' && depth > 0) { out += ',\n' + pad(depth) }
    else if (ch === '\n') { /* collapse existing newlines */ out += ' ' }
    else { out += ch }
    i++
  }
  return out.trim()
}

// ── Function Palette ──────────────────────────────────────────────────────────
function FnCard({ fn, onInsert }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border/30 last:border-0">
      <div className="flex items-start gap-1.5 px-2.5 py-2 hover:bg-muted/40 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}>
        <span className="mt-0.5 shrink-0 text-muted-foreground/60">
          {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-mono font-semibold text-primary">{fn.name}</span>
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 line-clamp-2">{fn.description}</p>
        </div>
      </div>
      {open && (
        <div className="px-3 pb-2.5 space-y-2 bg-muted/20 border-t border-border/20">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-semibold mb-0.5">Signature</p>
            <code className="text-[10px] font-mono text-foreground/90 break-all">{fn.signature}</code>
          </div>
          {fn.params.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-semibold mb-0.5">Parameters</p>
              <ul className="space-y-0.5">
                {fn.params.map((p, i) => {
                  const [name, ...rest] = p.split(' — ')
                  return (
                    <li key={i} className="text-[10px]">
                      <span className="font-mono text-primary/80">{name}</span>
                      {rest.length > 0 && <span className="text-muted-foreground"> — {rest.join(' — ')}</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {fn.example && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-semibold mb-0.5">Example</p>
              <code className="text-[10px] font-mono text-emerald-400 break-all">{fn.example}</code>
            </div>
          )}
          <button onClick={(e) => { e.stopPropagation(); onInsert(fn) }}
            className="w-full py-1 text-[10px] rounded bg-primary/90 text-primary-foreground hover:bg-primary transition-colors">
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
  const toggle = (cat) => setOpenCats(s => { const n = new Set(s); n.has(cat) ? n.delete(cat) : n.add(cat); return n })
  const q = query.toLowerCase()
  const filtered = MDX_CATALOG.map(c => ({
    ...c,
    fns: c.fns.filter(f => !q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)),
  })).filter(c => c.fns.length > 0)
  return (
    <div className="flex flex-col h-full">
      <div className="px-2.5 py-2 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 text-xs">
          <Search size={10} className="text-muted-foreground/60 shrink-0" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search functions…"
            className="flex-1 bg-transparent outline-none text-[11px] placeholder:text-muted-foreground/40" />
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {filtered.map(cat => (
          <div key={cat.category}>
            <button onClick={() => toggle(cat.category)}
              className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground bg-muted/30 hover:bg-muted/50 transition-colors">
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

// ── Pattern Panel ─────────────────────────────────────────────────────────────
function PatternPanel({ dimension, onInsert, onWrap }) {
  const [openCats, setOpenCats] = useState(() => new Set())
  const toggle = (cat) => setOpenCats(s => { const n = new Set(s); n.has(cat) ? n.delete(cat) : n.add(cat); return n })
  return (
    <div className="flex-1 overflow-auto">
      {MDX_PATTERN_CATEGORIES.map(cat => {
        const isWrap = WRAP_CATEGORIES.has(cat.category)
        return (
          <div key={cat.category}>
            <button onClick={() => toggle(cat.category)}
              className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground bg-muted/30 hover:bg-muted/50 transition-colors">
              {openCats.has(cat.category) ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              {cat.category}
              {isWrap && <span className="ml-auto text-[8px] text-amber-400/70 normal-case font-normal">wraps</span>}
            </button>
            {openCats.has(cat.category) && (
              <div className="divide-y divide-border/20">
                {cat.patterns.map((p, idx) => (
                  <div key={idx} className="px-2.5 py-2 hover:bg-muted/30">
                    <div className="text-[11px] font-medium text-foreground/90 mb-0.5">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight mb-1 line-clamp-2">{p.description}</div>
                    <pre className="text-[9px] font-mono text-emerald-400/80 bg-muted/30 rounded px-1.5 py-1 overflow-x-auto whitespace-pre-wrap mb-1.5 max-h-16">
                      {p.mdx(dimension)}
                    </pre>
                    <button
                      onClick={() => isWrap ? onWrap(p.mdx(dimension)) : onInsert(p.mdx(dimension))}
                      className="w-full py-0.5 text-[10px] rounded bg-primary/80 text-primary-foreground hover:bg-primary transition-colors">
                      {isWrap ? 'Wrap expression' : 'Insert'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}


// ── Register Monaco MDX completions ──────────────────────────────────────────
function registerMDXLanguage(monaco, dimension, getElements) {
  monaco.languages.registerCompletionItemProvider('tm1mdx', {
    triggerCharacters: ['.', '[', '('],
    provideCompletionItems: async (model, position) => {
      const textBefore = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
      const word = model.getWordUntilPosition(position)
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
      const suggestions = []
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
      if (/\[$/.test(textBefore)) {
        suggestions.push({ label: `[${dimension}].[${dimension}]`, kind: monaco.languages.CompletionItemKind.Module, detail: 'This dimension', insertText: `[${dimension}].[${dimension}]`, range })
      }
      return { suggestions }
    },
  })
  monaco.languages.registerSignatureHelpProvider('tm1mdx', {
    signatureHelpTriggerCharacters: ['(', ','],
    provideSignatureHelp: (model, position) => {
      const text = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
      let depth = 0, fnStart = -1
      for (let i = text.length - 1; i >= 0; i--) {
        if (text[i] === ')') depth++
        else if (text[i] === '(') { if (depth === 0) { fnStart = i; break } depth-- }
      }
      if (fnStart < 0) return null
      const fnName = text.slice(0, fnStart).match(/[\w]+$/)?.[0]
      if (!fnName) return null
      const fn = MDX_FUNCTIONS_FLAT.find(f => f.name.toLowerCase() === fnName.toLowerCase())
      if (!fn || fn.params.length === 0) return null
      const activeParam = (text.slice(fnStart).match(/,/g) ?? []).length
      return {
        value: { signatures: [{ label: fn.signature, documentation: fn.description, parameters: fn.params.map(p => ({ label: p })) }], activeSignature: 0, activeParameter: Math.min(activeParam, fn.params.length - 1) },
        dispose: () => {},
      }
    },
  })
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SubsetEditor({ tab }) {
  const { server, dark, markTabSaved, bumpSubsetVersion, closeTab, openTab } = useStore()
  const queryClient = useQueryClient()
  const { data, isLoading } = useSubset(tab.server, tab.dimension, tab.subsetName)
  const saveSubset  = useSaveSubset()
  const previewMDX  = usePreviewMDX()
  const generateMDX = useGenerateMDX()
  const { data: elements } = useElements(tab.server, tab.dimension)
  const { data: usageData, isFetching: loadingUsage, refetch: refetchUsage } = useSubsetUsage(tab.server, tab.dimension, tab.subsetName)

  const hasApply = !!subsetApplyCallbacks.get(tab.id)

  const [mode, _setMode]     = useState('visual')
  const visualDirtyRef       = useRef(false)
  const visualMembersRef     = useRef([])
  const [mdx, setMdx]        = useState(null)
  const [members, setMembers] = useState(null)
  const [dirty, setDirty]    = useState(false)
  const [showAttrs, setShowAttrs] = useState(false)
  const [rightTab, setRightTab] = useState('functions')
  const { data: attrGrid } = useAttrGrid(showAttrs ? tab.server : null, tab.dimension, tab.dimension)
  const [rightWidth, setRightWidth] = useState(400)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const dragRef = useRef(null)
  const [validating, setValidating] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [copyingPrompt, setCopyingPrompt] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
  const saveAsRef = useRef(null)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [sessionName, setSessionName] = useState('')
  const [sessions, setSessions] = useState(loadSessions)
  const [savedIndicator, setSavedIndicator] = useState(false)

  const editorRef     = useRef(null)
  const monacoRef     = useRef(null)
  const registeredRef = useRef(false)
  const validateTimer = useRef(null)
  const elementsRef   = useRef(null)
  elementsRef.current = elements

  const setMode = (next) => {
    if (mode === 'visual' && next === 'mdx' && visualDirtyRef.current) {
      if (!window.confirm('Switch to MDX? Unsaved visual changes will be lost.')) return
    }
    if (mode === 'visual' && next === 'mdx' && visualMembersRef.current.length) {
      const names = visualMembersRef.current.map(m => `[${tab.dimension}].[${tab.dimension}].[${m.name ?? m}]`)
      setMdx(names.length ? `{${names.join(', ')}}` : '{}')
      setDirty(true); setMembers(null)
    }
    _setMode(next)
  }

  useEffect(() => {
    if (tab.mdx && mdx === null) { setMdx(tab.mdx); _setMode('mdx'); return }
    if (data && mdx === null) { setMdx(data.Expression ?? ''); _setMode(data.Expression ? 'mdx' : 'visual') }
  }, [data])

  // Inline validation
  useEffect(() => {
    if (!mdx?.trim() || !editorRef.current || !monacoRef.current) return
    clearTimeout(validateTimer.current)
    validateTimer.current = setTimeout(async () => {
      setValidating(true)
      try {
        const enc = encodeURIComponent
        const r = await fetch(`/api/subset/preview?server=${enc(tab.server)}&dimension=${enc(tab.dimension)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mdx, limit: 1 }),
        })
        const model = editorRef.current?.getModel()
        if (!model) return
        if (r.ok) {
          monacoRef.current.editor.setModelMarkers(model, 'mdx-validate', [])
        } else {
          const d = await r.json().catch(() => ({}))
          let [sl, sc] = [1, 1]
          const m = (d.error || '').match(/line\s+(\d+)/i); if (m) sl = parseInt(m[1], 10)
          const mc = (d.error || '').match(/column\s+(\d+)/i); if (mc) sc = parseInt(mc[1], 10)
          monacoRef.current.editor.setModelMarkers(model, 'mdx-validate', [{ severity: monacoRef.current.MarkerSeverity.Error, message: d.error || 'Invalid MDX', startLineNumber: sl, startColumn: sc, endLineNumber: sl, endColumn: sc + 1 }])
        }
      } catch {} finally { setValidating(false) }
    }, 800)
    return () => clearTimeout(validateTimer.current)
  }, [mdx])

  const getMDXToRun = () => {
    const editor = editorRef.current
    if (!editor) return mdx
    const sel = editor.getSelection()
    if (sel && !editor.getSelection().isEmpty()) return editor.getModel().getValueInRange(sel)
    return mdx
  }

  const handleExecute = () => {
    const mdxToRun = getMDXToRun()
    if (!mdxToRun?.trim()) return
    previewMDX.mutate(
      { server: tab.server, dimension: tab.dimension, mdx: mdxToRun },
      { onSuccess: (d) => { setMembers(d.members) }, onError: (e) => toast.error(e.message) }
    )
  }

  const handleFormat = () => {
    const formatted = formatMDX(mdx)
    if (formatted !== mdx) { setMdx(formatted); setDirty(true) }
  }

  const handleApply = () => {
    const cb = subsetApplyCallbacks.get(tab.id)
    if (cb) { cb(mdx); subsetApplyCallbacks.delete(tab.id); closeTab(tab.id) }
  }

  const handleSave = () => {
    const id = toast.loading('Saving…')
    saveSubset.mutate(
      { server: tab.server, dimension: tab.dimension, name: tab.subsetName, mdx },
      { onSuccess: () => { setDirty(false); markTabSaved(tab.id); toast.success('Saved', { id }); bumpSubsetVersion(tab.server, tab.dimension) }, onError: (e) => toast.error(e.message, { id }) }
    )
  }

  const commitSaveAs = () => {
    const name = saveAsName.trim(); setSaveAsOpen(false); setSaveAsName('')
    if (!name || name === tab.subsetName) return
    const id = toast.loading(`Saving as "${name}"…`)
    saveSubset.mutate(
      { server: tab.server, dimension: tab.dimension, name, mdx },
      { onSuccess: () => { toast.success(`Saved as "${name}"`, { id }); bumpSubsetVersion(tab.server, tab.dimension); closeTab(tab.id); openTab({ id: `subset:${tab.server}:${tab.dimension}:${name}`, type: 'subset', label: name, server: tab.server, dimension: tab.dimension, subsetName: name }) }, onError: e => toast.error(e.message, { id }) }
    )
  }

  const handleSaveSession = () => {
    if (!sessionName.trim() || !mdx) return
    saveSessionEntry({ name: sessionName.trim(), mdx, dimension: tab.dimension })
    setSessions(loadSessions())
    setSavedIndicator(true)
    setTimeout(() => setSavedIndicator(false), 2000)
    setSessionName('')
  }

  const handleLoadSession = (s) => {
    setMdx(s.mdx); setDirty(true); setMembers(null); setSessionsOpen(false)
  }

  const handleInsertFunction = useCallback((fn) => {
    const editor = editorRef.current; if (!editor) return
    const snippet = fn.template.replaceAll('${1:Dim}', tab.dimension).replaceAll('${1:dim}', tab.dimension)
    editor.focus(); editor.getContribution('snippetController2')?.insert(snippet)
  }, [tab.dimension])

  const handleInsertPattern = (expr) => {
    const editor = editorRef.current
    if (editor) {
      const pos = editor.getPosition()
      editor.executeEdits('insert', [{ range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }, text: expr }])
      editor.focus()
    } else { setMdx(expr) }
    setDirty(true); setMembers(null)
  }

  const handleWrapPattern = (wrapExpr) => {
    // The pattern is a complete set expression — replace current MDX
    setMdx(wrapExpr); setDirty(true); setMembers(null)
  }

  const handleMount = (editor, monaco) => {
    editorRef.current = editor; monacoRef.current = monaco
    editor.getDomNode()?.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain'); if (!text) return
      e.preventDefault(); e.stopPropagation()
      editor.executeEdits('paste', [{ range: editor.getSelection(), text, forceMoveMarkers: true }])
      editor.focus()
    }, true)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, handleExecute)
    if (!registeredRef.current) { registeredRef.current = true; registerMDXLanguage(monaco, tab.dimension, () => Promise.resolve(elementsRef.current)) }
  }

  const handleGenerate = () => {
    if (!aiPrompt.trim() || generateMDX.isPending) return
    generateMDX.mutate({ server: tab.server, dimension: tab.dimension, prompt: aiPrompt },
      { onSuccess: (d) => { setMdx(d.mdx); setDirty(true); setMembers(null) }, onError: (e) => toast.error(e.message) })
  }

  const handleCopyPrompt = async () => {
    setCopyingPrompt(true)
    try {
      const enc = encodeURIComponent
      const r = await fetch(`/api/elements?server=${enc(tab.server)}&dimension=${enc(tab.dimension)}`)
      const els = await r.json()
      const sample = els.slice(0, 200).map(e => `${e.Name} (${e.Type === 'N' ? 'leaf' : e.Type === 'C' ? 'consolidated' : 'string'}, level ${e.Level})`).join('\n')
      await navigator.clipboard.writeText(`TM1 MDX expert. Generate a valid TM1 MDX set expression for dimension: ${tab.dimension}\n\nSample elements:\n${sample}\n\nRequest: ${aiPrompt || '(describe what you want)'}`)
      toast.success('Prompt copied')
    } catch (e) { toast.error('Copy failed: ' + e.message) } finally { setCopyingPrompt(false) }
  }

  if (isLoading && mdx === null) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm"><Loader2 size={16} className="animate-spin mr-2" />Loading…</div>
  }

  const rightTabs = [
    { id: 'functions', label: 'Functions' },
    { id: 'patterns',  label: 'Patterns' },
    { id: 'usage',     label: 'Usage', badge: usageData ? usageData.cubes.length + usageData.processes.length : null },
  ]

  return (
    <div className="flex flex-col h-full bg-background">

      {/* ── Mode bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/40 shrink-0">
        <div className="flex gap-0.5 bg-muted rounded p-0.5">
          {[{ id: 'visual', label: 'Visual' }, { id: 'mdx', label: 'MDX' }].map(t => (
            <button key={t.id} onClick={() => setMode(t.id)}
              className={cn('px-3 py-0.5 text-xs rounded transition-colors',
                mode === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{tab.dimension}</span>
        {tab.subsetName && <>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-xs font-mono">{tab.subsetName}</span>
        </>}
        <button onClick={() => {
          const { setRevealTarget } = useStore.getState()
          setRevealTarget(tab.subsetName
            ? { type: 'subset',    server: tab.server, dimension: tab.dimension, subsetName: tab.subsetName }
            : { type: 'dimension', server: tab.server, dimension: tab.dimension }
          )
        }}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Show in tree">
          <MapPin size={11} />
        </button>
      </div>

      {/* ── Visual mode ──────────────────────────────────────────────────────── */}
      {mode === 'visual' && (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0">
            <SubsetVisualEditor tab={tab} onMdxConvert={(m) => { setMdx(m); setDirty(true); setMembers(null); _setMode('mdx') }}
              onVisualDirty={v => { visualDirtyRef.current = v }} onVisualMembersChange={m => { visualMembersRef.current = m }} />
          </div>
          <div className="w-60 shrink-0 border-l border-border flex flex-col">
            <div className="px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground">Usage</div>
            <div className="flex-1 overflow-auto p-2">
              <button onClick={() => refetchUsage()} disabled={loadingUsage}
                className="w-full flex items-center justify-center gap-1 px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 mb-2">
                {loadingUsage ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />} Scan for usage
              </button>
              {usageData && (
                <>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">Cube Views ({usageData.cubes.length})</div>
                  {usageData.cubes.map((u, i) => (
                    <div key={i} className="flex items-center gap-1 px-1 py-0.5 text-xs hover:bg-muted rounded">
                      <Box size={10} className="shrink-0 text-muted-foreground" />
                      <span className="font-mono truncate">{u.cube}</span><span className="text-muted-foreground/40">·</span>
                      <span className="font-mono truncate text-[10px]">{u.view}</span>
                    </div>
                  ))}
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1 mt-2">TI Processes ({usageData.processes.length})</div>
                  {usageData.processes.map((u, i) => (
                    <div key={i} className="flex items-center gap-1 px-1 py-0.5 text-xs hover:bg-muted rounded">
                      <Cog size={10} className="shrink-0 text-muted-foreground" /><span className="font-mono truncate">{u.process}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MDX mode ─────────────────────────────────────────────────────────── */}
      {mode === 'mdx' && (
        <div className="flex flex-col flex-1 min-h-0">

          {/* Toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-muted/20 shrink-0 flex-wrap">
            {validating && <Loader2 size={10} className="animate-spin text-muted-foreground/60 shrink-0" />}

            {/* Format */}
            <button onClick={handleFormat} disabled={!mdx?.trim()}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors" title="Format MDX">
              <AlignLeft size={11} /> Format
            </button>

            {/* Sessions */}
            <div className="relative">
              <button onClick={() => setSessionsOpen(o => !o)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted transition-colors">
                <Clock size={11} /> Sessions
              </button>
              {sessionsOpen && (
                <div className="absolute top-full left-0 mt-1 bg-popover border border-border rounded shadow-lg z-50 w-64 py-1">
                  <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
                    <input value={sessionName} onChange={e => setSessionName(e.target.value)} placeholder="Session name…"
                      className="flex-1 text-xs px-1.5 py-0.5 border rounded bg-background outline-none"
                      onKeyDown={e => e.key === 'Enter' && handleSaveSession()} />
                    <button onClick={handleSaveSession} disabled={!sessionName.trim() || !mdx}
                      className="px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1">
                      {savedIndicator ? <Check size={10} /> : <Save size={10} />}
                    </button>
                  </div>
                  {sessions.length === 0
                    ? <div className="px-3 py-2 text-xs text-muted-foreground">No saved sessions</div>
                    : sessions.map((s, i) => (
                      <button key={i} onClick={() => handleLoadSession(s)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center justify-between">
                        <span className="font-mono truncate flex-1 mr-2">{s.name}</span>
                        <span className="text-muted-foreground/60 shrink-0 text-[10px]">{new Date(s.time).toLocaleDateString()}</span>
                      </button>
                    ))
                  }
                </div>
              )}
            </div>

            <div className="flex-1" />

            {/* Execute — runs selection if highlighted, Ctrl+Enter shortcut */}
            <button onClick={handleExecute} disabled={!mdx?.trim() || previewMDX.isPending}
              className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-emerald-700 text-white disabled:opacity-40 hover:bg-emerald-600 transition-colors" title="Execute (Ctrl+Enter) — runs selection if highlighted">
              {previewMDX.isPending ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              Execute
            </button>

            {/* Apply — only shown when opened from Filter */}
            {hasApply && (
              <button onClick={handleApply} disabled={!mdx?.trim()}
                className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity">
                Apply
              </button>
            )}

            {/* Save As / Save */}
            {saveAsOpen ? (
              <input ref={saveAsRef} value={saveAsName} onChange={e => setSaveAsName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitSaveAs(); if (e.key === 'Escape') setSaveAsOpen(false) }}
                onBlur={commitSaveAs} placeholder="New name…"
                className="w-28 text-xs bg-background border border-border rounded px-1.5 py-1 outline-none font-mono" />
            ) : (
              <>
                <button onClick={() => { setSaveAsOpen(true); setSaveAsName(''); setTimeout(() => saveAsRef.current?.focus(), 0) }}
                  disabled={!mdx?.trim()}
                  className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors">
                  Save As
                </button>
                {tab.subsetName && (
                  <button onClick={handleSave} disabled={!dirty || saveSubset.isPending}
                    className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity">
                    {saveSubset.isPending ? 'Saving…' : 'Save'}
                  </button>
                )}
              </>
            )}
          </div>

          {/* AI bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/10 shrink-0">
            <Sparkles size={11} className="shrink-0 text-violet-400" />
            <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleGenerate()}
              placeholder="Describe the members you want…"
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/40" />
            <button onClick={handleCopyPrompt} disabled={copyingPrompt}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border text-muted-foreground disabled:opacity-40 hover:bg-muted transition-colors shrink-0">
              {copyingPrompt ? <Loader2 size={10} className="animate-spin" /> : <Copy size={10} />} Copy prompt
            </button>
            <button onClick={handleGenerate} disabled={!aiPrompt.trim() || generateMDX.isPending}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-violet-700 text-white disabled:opacity-40 hover:bg-violet-600 transition-colors shrink-0">
              {generateMDX.isPending ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} Generate
            </button>
          </div>

          {/* Editor + Right panel */}
          <div className="flex flex-1 min-h-0">

            {/* Left: Monaco + Results below */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">

              {/* Monaco */}
              <div className={cn('min-h-0', members !== null ? 'flex-1' : 'flex-1')}>
                <MonacoEditor height="100%" language="tm1mdx" value={mdx ?? ''} theme={dark ? 'vs-dark' : 'vs'}
                  onChange={v => { setMdx(v); setDirty(true); setMembers(null) }}
                  onMount={handleMount}
                  options={{ fontSize: 13, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, lineNumbers: 'off', suggestOnTriggerCharacters: true, quickSuggestions: true, parameterHints: { enabled: true } }} />
              </div>

              {/* Results panel — below editor, shown after Execute */}
              {(members !== null || previewMDX.isPending) && (
                <div className="h-56 shrink-0 border-t border-border flex flex-col bg-muted/5">
                  {/* Results header */}
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
                    <span className="text-xs font-medium">
                      {previewMDX.isPending ? 'Running…' : `${members?.length ?? 0} member${members?.length !== 1 ? 's' : ''}`}
                    </span>
                    {members !== null && (
                      <button onClick={() => setShowAttrs(a => !a)}
                        className={cn('flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border transition-colors',
                          showAttrs ? 'bg-primary/20 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}>
                        Attributes
                      </button>
                    )}
                    <button onClick={() => setMembers(null)} className="ml-auto text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors">
                      <X size={11} />
                    </button>
                  </div>

                  {/* Results body */}
                  {previewMDX.isPending
                    ? <div className="flex justify-center items-center flex-1"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>
                    : members?.length === 0
                    ? <p className="px-3 py-4 text-xs text-muted-foreground italic">No members returned — empty set.</p>
                    : (
                      <div className="flex-1 min-h-0 overflow-auto">
                        {/* Header row when attrs shown */}
                        {showAttrs && attrGrid?.attrs?.length > 0 && (
                          <div className="flex items-center gap-0 border-b border-border sticky top-0 bg-muted/80 backdrop-blur-sm">
                            <div className="w-8 shrink-0" />
                            <div className="flex-1 px-3 py-1 text-[10px] font-semibold text-muted-foreground">Element</div>
                            {attrGrid.attrs.map(a => (
                              <div key={a.Name} className="w-32 shrink-0 px-2 py-1 text-[10px] font-semibold text-muted-foreground truncate border-l border-border/40">{a.Name}</div>
                            ))}
                          </div>
                        )}
                        {members?.map((m, i) => {
                          const attrValues = showAttrs ? (attrGrid?.values?.[m.name] ?? {}) : null
                          return (
                            <div key={m.name} className={cn('flex items-center gap-0 hover:bg-muted/40', i % 2 === 0 ? '' : 'bg-muted/10')}>
                              <span className={cn('w-8 shrink-0 text-center text-[10px]', TYPE_COLOR[m.type])}>{TYPE_ICON[m.type] ?? '·'}</span>
                              <span className="flex-1 px-3 py-0.5 text-xs font-mono truncate">{m.name}</span>
                              {showAttrs && attrGrid?.attrs?.map(a => (
                                <span key={a.Name} className="w-32 shrink-0 px-2 py-0.5 text-xs text-muted-foreground truncate border-l border-border/20">{attrValues?.[a.Name] ?? ''}</span>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    )
                  }
                </div>
              )}
            </div>

            {/* Drag handle */}
            <div
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40 bg-border/60 transition-colors"
              onMouseDown={e => {
                e.preventDefault()
                const startX = e.clientX
                const startW = rightCollapsed ? 0 : rightWidth
                const onMove = (me) => {
                  const delta = startX - me.clientX
                  const newW = Math.max(200, Math.min(800, startW + delta))
                  setRightWidth(newW)
                  if (rightCollapsed) setRightCollapsed(false)
                }
                const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />

            {/* Right panel — Functions, Patterns, Usage only */}
            <div className="shrink-0 border-l border-border flex flex-col bg-sidebar transition-all"
              style={{ width: rightCollapsed ? 0 : rightWidth, overflow: rightCollapsed ? 'hidden' : undefined }}>
              <div className="flex items-center border-b border-border shrink-0">
                {rightTabs.map(t => (
                  <button key={t.id} onClick={() => setRightTab(t.id)}
                    className={cn('flex-1 py-1.5 text-[10px] whitespace-nowrap transition-colors',
                      rightTab === t.id ? 'border-b-2 border-primary text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}>
                    {t.label}
                    {t.badge != null && <span className="ml-1 text-muted-foreground/60">({t.badge})</span>}
                  </button>
                ))}
                <button onClick={() => setRightCollapsed(c => !c)}
                  className="px-2 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 border-l border-border"
                  title={rightCollapsed ? 'Expand panel' : 'Collapse panel'}>
                  {rightCollapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
                </button>
              </div>

              {rightTab === 'functions' && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <FunctionPalette onInsert={handleInsertFunction} />
                </div>
              )}

              {rightTab === 'patterns' && (
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="px-2.5 py-1.5 border-b border-border/40 text-[10px] text-muted-foreground/60 shrink-0">
                    <span className="text-amber-400/80">Wraps</span> = replaces expression. Others insert at cursor.
                  </div>
                  <PatternPanel dimension={tab.dimension} onInsert={handleInsertPattern} onWrap={handleWrapPattern} />
                </div>
              )}

              {rightTab === 'usage' && (
                <div className="flex-1 min-h-0 overflow-auto p-2">
                  <button onClick={() => refetchUsage()} disabled={loadingUsage}
                    className="w-full flex items-center justify-center gap-1 px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 mb-2">
                    {loadingUsage ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />} Scan for usage
                  </button>
                  {usageData && (
                    <>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">Cube Views ({usageData.cubes.length})</div>
                      {usageData.cubes.length === 0 && <p className="text-[10px] text-muted-foreground italic mb-2">Not used in any view</p>}
                      {usageData.cubes.map((u, i) => (
                        <div key={i} className="flex items-center gap-1 px-1 py-0.5 text-xs hover:bg-muted rounded">
                          <Box size={10} className="shrink-0 text-muted-foreground" />
                          <span className="font-mono truncate">{u.cube}</span><span className="text-muted-foreground/40">·</span>
                          <span className="font-mono truncate text-[10px]">{u.view}</span>
                          <span className="text-[10px] text-muted-foreground/60 shrink-0 ml-auto">{u.axis}</span>
                        </div>
                      ))}
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1 mt-3">TI Processes ({usageData.processes.length})</div>
                      {usageData.processes.length === 0 && <p className="text-[10px] text-muted-foreground italic">Not referenced in any process</p>}
                      {usageData.processes.map((u, i) => (
                        <div key={i} className="flex items-center gap-1 px-1 py-0.5 text-xs hover:bg-muted rounded">
                          <Cog size={10} className="shrink-0 text-muted-foreground" /><span className="font-mono truncate">{u.process}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
