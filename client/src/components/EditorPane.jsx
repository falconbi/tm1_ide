import { useEffect, useRef, useState, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useRules, useSaveRules, useLineage, useLineageConsumers } from '@/hooks/useApi'
import { registerTM1Completions, registerTM1Theme } from '@/lib/tm1-functions'
import ProcessEditor from '@/components/ProcessEditor'
import SubsetEditor from '@/components/SubsetEditor'
import DimensionEditor from '@/components/DimensionEditor'
import ViewEditor from '@/components/ViewEditor'
import MDXSandbox from '@/components/MDXSandbox'
import { toast } from 'sonner'
import { GitBranch, ChevronRight, ChevronDown, Loader2, ChevronsUpDown, ChevronsDownUp, ListTree, AlignLeft, Settings, Locate, Braces } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadSettings, saveSettings } from '@/lib/formatters/settings.js'
import { getSnippets } from '@/lib/tm1-snippets.js'
import SnippetPanel from '@/components/SnippetPanel'

// ── Lineage panel ─────────────────────────────────────────────────────────────

function TreeNode({ cube, tree, depth, onOpen, visited = new Set() }) {
  const [open, setOpen] = useState(depth < 2)
  const node = tree[cube]
  if (!node) return null
  const sources = node.sources ?? []
  const cycle = visited.has(cube)
  const nextVisited = new Set(visited).add(cube)

  return (
    <div className={cn('text-xs', depth > 0 && 'ml-4 border-l border-border pl-2')}>
      <div className="flex items-center gap-1 py-0.5 group">
        {sources.length > 0 && !cycle ? (
          <button onClick={() => setOpen(o => !o)} className="shrink-0 text-muted-foreground">
            {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : <span className="w-3 shrink-0" />}
        <button
          onClick={() => onOpen(cube)}
          className="font-mono hover:text-primary truncate text-left"
          title={cube}
        >
          {cube}
        </button>
        {cycle && <span className="text-muted-foreground/50 text-[10px]">(cycle)</span>}
        {node.error && <span className="text-red-400 text-[10px]">(error)</span>}
        {!node.hasRules && !cycle && <span className="text-muted-foreground/50 text-[10px]">no rules</span>}
      </div>
      {open && !cycle && sources.map(s => (
        <TreeNode key={s} cube={s} tree={tree} depth={depth + 1} onOpen={onOpen} visited={nextVisited} />
      ))}
    </div>
  )
}

function LineagePanel({ server, cube, onOpen }) {
  const [mode, setMode] = useState('sources')
  const { data: srcData, isFetching: srcFetching }   = useLineage(server, cube, mode === 'sources')
  const { data: conData, isFetching: conFetching }   = useLineageConsumers(server, cube, mode === 'consumers')

  const fetching = mode === 'sources' ? srcFetching : conFetching

  return (
    <div className="w-64 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lineage</span>
        {fetching && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
      </div>

      <div className="flex px-2 py-1.5 gap-1 border-b border-border shrink-0">
        {['sources', 'consumers'].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn('flex-1 py-0.5 text-xs rounded capitalize',
              mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-2 py-2">
        {mode === 'sources' && srcData && (
          <TreeNode cube={srcData.root} tree={srcData.tree} depth={0} onOpen={onOpen} />
        )}
        {mode === 'consumers' && conData && (
          conData.consumers.length === 0
            ? <p className="text-xs text-muted-foreground px-1">No cubes reference this cube.</p>
            : conData.consumers.map(c => (
                <button key={c} onClick={() => onOpen(c)}
                  className="flex items-center w-full px-1 py-0.5 text-xs font-mono hover:text-primary text-left truncate">
                  {c}
                </button>
              ))
        )}
        {!srcData && !conData && !fetching && (
          <p className="text-xs text-muted-foreground px-1">Loading…</p>
        )}
      </div>
    </div>
  )
}

// ── Rules editor ─────────────────────────────────────────────────────────────

function RulesEditor({ tab, onCursor }) {
  const { initTabContent, updateTabContent, markTabSaved, clearScrollTo, openTab, server, dark, themeVersion, setFormatSettingsOpen } = useStore()
  const { data, isLoading } = useRules(tab.server, tab.cube)
  const saveRules = useSaveRules()
  const registeredRef = useRef(false)
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const formatPopupRef = useRef(null)
  const [showLineage, setShowLineage] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [regionsCollapsed, setRegionsCollapsed] = useState(false)
  const [showRegionMenu, setShowRegionMenu] = useState(false)
  const [showFormatPopup, setShowFormatPopup] = useState(false)
  const [formatStruct, setFormatStruct] = useState(() => loadSettings().rules.expressionFormatter ?? null)

  const openCube = useCallback((cube) => {
    openTab({ id: `rules:${tab.server}:${cube}`, type: 'rules', label: cube, server: tab.server, cube, content: null })
  }, [tab.server])

  const content = tab.content ?? data?.rules ?? ''

  useEffect(() => {
    if (data?.rules != null && !tab.dirty) {
      initTabContent(tab.id, data.rules)
    }
  }, [data])

  useEffect(() => {
    if (tab.scrollToLine && editorRef.current) {
      editorRef.current.revealLineInCenter(tab.scrollToLine)
      editorRef.current.setPosition({ lineNumber: tab.scrollToLine, column: 1 })
      clearScrollTo(tab.id)
    }
  }, [tab.scrollToLine])

  // Close region menu on click outside
  useEffect(() => {
    if (!showRegionMenu) return
    const handler = (e) => {
      if (!e.target.closest('.region-menu-container')) setShowRegionMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showRegionMenu])

  // Close format popup on click outside
  useEffect(() => {
    if (!showFormatPopup) return
    const handler = (e) => {
      if (formatPopupRef.current && !formatPopupRef.current.contains(e.target)) setShowFormatPopup(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showFormatPopup])

  const runFormat = () => {
    const s = loadSettings()
    saveSettings({ ...s, rules: { ...s.rules, expressionFormatter: formatStruct } })
    editorRef.current?.getAction('editor.action.formatDocument').run()
    setShowFormatPopup(false)
  }

  useEffect(() => {
    if (monacoRef.current) registerTM1Theme(monacoRef.current, dark)
  }, [dark, themeVersion])

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    if (!registeredRef.current) {
      registerTM1Completions(monaco, () => server)
      registerTM1Theme(monaco, dark)
      registeredRef.current = true
    }
    editor.onDidChangeCursorPosition(e => {
      onCursor({ line: e.position.lineNumber, col: e.position.column })
    })

    // Prevent browser's Ctrl+S "Save Page" dialog and trigger save instead
    const keyDownDisposable = editor.onKeyDown(e => {
      if (e.keyCode === monaco.KeyCode.KeyS && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.browserEvent.preventDefault()
        e.browserEvent.stopPropagation()
        const id = toast.loading('Saving rules…')
        saveRules.mutate(
          { server: tab.server, cube: tab.cube, rules: editor.getValue() },
          {
            onSuccess: () => { markTabSaved(tab.id); toast.success('Rules saved', { id }) },
            onError:   (err) => toast.error(err.message, { id }),
          },
        )
      }
      if (e.keyCode === monaco.KeyCode.KeyF && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.browserEvent.preventDefault()
        e.browserEvent.stopPropagation()
        editor.getAction('editor.action.formatDocument').run()
      }
    })
    if (tab.scrollToLine) {
      editor.revealLineInCenter(tab.scrollToLine)
      editor.setPosition({ lineNumber: tab.scrollToLine, column: 1 })
      clearScrollTo(tab.id)
    }
  }

  const toggleRegions = () => {
    const editor = editorRef.current
    if (!editor) return
    if (regionsCollapsed) {
      editor.trigger('fold', 'editor.unfoldAll')
      setRegionsCollapsed(false)
    } else {
      editor.trigger('fold', 'editor.foldAll')
      setRegionsCollapsed(true)
    }
  }

  const getRegions = () => {
    const editor = editorRef.current
    if (!editor) return []
    const regions = []
    const lineCount = editor.getModel().getLineCount()
    for (let line = 1; line <= lineCount; line++) {
      const text = editor.getModel().getLineContent(line).trim()
      const match = text.match(/^#Region\s+(.*)$/i)
      if (match) {
        regions.push({ line, name: match[1].trim() || 'Region' })
      }
    }
    return regions
  }

  const goToRegion = (line) => {
    const editor = editorRef.current
    if (!editor) return
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
    setShowRegionMenu(false)
  }

  const insertSnippet = (code) => {
    const editor = editorRef.current
    if (!editor) return
    const sel = editor.getSelection()
    editor.executeEdits('snippet', [{ range: sel, text: code }])
    editor.focus()
  }

  if (isLoading && tab.content === null) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading rules…</div>
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-hidden relative">
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
          <div ref={formatPopupRef} className="relative format-popup-container">
            <button
              onClick={() => setShowFormatPopup(v => !v)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs border bg-background/80 transition-colors',
                showFormatPopup ? 'border-primary text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
              )}
              title="Format Document (Ctrl+Shift+F)"
            >
              <AlignLeft size={11} />
              Format
            </button>
            {showFormatPopup && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Structure</div>
                <div className="flex flex-col gap-1 mb-3">
                  {[
                    { id: null,             label: 'No Change',      desc: 'Keep existing line breaks' },
                    { id: 'tm1-verbose',    label: 'TM1 Verbose',    desc: 'Each string arg on its own line' },
                    { id: 'tm1-structured', label: 'TM1 Structured', desc: 'Group consecutive string args' },
                  ].map(opt => (
                    <button
                      key={opt.id ?? 'none'}
                      onClick={() => setFormatStruct(opt.id)}
                      className={cn(
                        'flex flex-col items-start px-2 py-1.5 rounded border text-left transition-colors',
                        formatStruct === opt.id
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                      )}
                    >
                      <span className="text-xs font-medium">{opt.label}</span>
                      <span className="text-[10px] opacity-70">{opt.desc}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={runFormat}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    <AlignLeft size={11} /> Format
                  </button>
                  <button
                    onClick={() => { setShowFormatPopup(false); setFormatSettingsOpen(true) }}
                    className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Format Settings"
                  >
                    <Settings size={11} />
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="relative region-menu-container">
            <button
              onClick={() => setShowRegionMenu(v => !v)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
                showRegionMenu ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
              )}
              title="Go to region"
            >
              <ListTree size={11} />
              Regions
            </button>
            {showRegionMenu && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded shadow-lg z-50 max-h-64 overflow-auto text-xs">
                {getRegions().length === 0 ? (
                  <div className="px-3 py-1.5 text-muted-foreground italic">No regions found</div>
                ) : (
                  getRegions().map(r => (
                    <button
                      key={r.line}
                      onClick={() => goToRegion(r.line)}
                      className="flex items-center gap-1.5 w-full px-3 py-1 text-left hover:bg-muted text-sidebar-foreground truncate"
                      title={`Line ${r.line}`}
                    >
                      <span className="text-muted-foreground/50 font-mono text-[10px] shrink-0">{r.line}</span>
                      <span className="truncate">{r.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            onClick={toggleRegions}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
              regionsCollapsed ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
            )}
            title={regionsCollapsed ? 'Expand all regions' : 'Collapse all regions'}
          >
            {regionsCollapsed ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
            {regionsCollapsed ? 'Expand' : 'Collapse'}
          </button>
          <button
            onClick={() => setShowSnippets(s => !s)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
              showSnippets ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
            )}
            title="Toggle snippets panel"
          >
            <Braces size={11} />
            Snippets
          </button>
          <button
            onClick={() => setShowLineage(s => !s)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
              showLineage ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
            )}
            title="Toggle lineage trace"
          >
            <GitBranch size={11} />
            Lineage
          </button>
        </div>
        <MonacoEditor
          height="100%"
          language="tm1rules"
          value={content}
          theme={dark ? 'vs-dark' : 'vs'}
          onChange={v => updateTabContent(tab.id, v)}
          onMount={handleMount}
          options={{ fontSize: 13, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false }}
        />
      </div>
      {showSnippets && (
        <div className="w-72 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
          <SnippetPanel snippets={getSnippets('rules')} onInsert={insertSnippet} />
        </div>
      )}
      {showLineage && (
        <LineagePanel server={tab.server} cube={tab.cube} onOpen={openCube} />
      )}
    </div>
  )
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * @param {import('@/store').Tab} tab
 * @returns {import('@/store').RevealTarget|null}
 */
function getRevealTarget(tab) {
  if (!tab) return null
  if (tab.type === 'rules')     return { type: 'rules',     server: tab.server, cube: tab.cube }
  if (tab.type === 'process')   return { type: 'process',   server: tab.server, name: tab.name }
  if (tab.type === 'subset')    return { type: 'subset',    server: tab.server, dimension: tab.dimension, subsetName: tab.subsetName }
  if (tab.type === 'dimension') return { type: 'dimension', server: tab.server, dimension: tab.dimension }
  if (tab.type === 'cubeview' || tab.type === 'view') {
    if (tab.viewName) return { type: 'view', server: tab.server, cube: tab.cube, viewName: tab.viewName }
    return { type: 'cube', server: tab.server, cube: tab.cube }
  }
  return null
}

export default function EditorPane({ groupId }) {
  const { tabs, groups, setRevealTarget, setActiveGroup } = useStore()
  const group = groups.find(g => g.id === groupId)
  const tab = tabs.find(t => t.id === group?.activeTabId)
  const [cursor, setCursorLocal] = useState({ line: 1, col: 1 })

  const handleCursor = (pos) => setCursorLocal(pos)

  if (!tab) {
    return (
      <div className="flex-1 flex flex-col min-h-0" onClick={() => setActiveGroup(groupId)}>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm select-none">
          Open an object from the explorer to start editing.
        </div>
        <div className="h-5" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" onClick={() => setActiveGroup(groupId)}>
      <div className="flex-1 min-h-0">
        {tab.type === 'rules'      && <RulesEditor    key={tab.id} tab={tab} onCursor={handleCursor} />}
        {tab.type === 'process'    && <ProcessEditor  key={tab.id} tab={tab} />}
        {tab.type === 'subset'     && <SubsetEditor   key={tab.id} tab={tab} />}
        {tab.type === 'dimension'  && <DimensionEditor key={tab.id} tab={tab} />}
        {(tab.type === 'view' || tab.type === 'cubeview') && <ViewEditor key={tab.id} tab={tab} />}
        {tab.type === 'mdxsandbox' && <MDXSandbox     key={tab.id} tab={tab} onCursor={handleCursor} />}
      </div>
      <div className="flex items-center px-3 py-0.5 bg-muted border-t border-border text-xs text-muted-foreground shrink-0">
        <span>Ln {cursor.line}, Col {cursor.col}</span>
        <span className="ml-4">
          {tab.type === 'rules' ? 'TM1 Rules' : tab.type === 'subset' ? 'MDX' : tab.type === 'dimension' ? 'Dimension' : tab.type === 'view' || tab.type === 'cubeview' ? 'View' : tab.type === 'mdxsandbox' ? 'MDX' : 'TM1 TI'}
        </span>
        {getRevealTarget(tab) && (
          <button
            onClick={() => setRevealTarget(getRevealTarget(tab))}
            className="ml-auto flex items-center gap-1 hover:text-foreground transition-colors"
            title="Show in tree"
          >
            <Locate size={11} /> Show in tree
          </button>
        )}
      </div>
    </div>
  )
}
