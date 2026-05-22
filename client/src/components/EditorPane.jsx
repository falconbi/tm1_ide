import { useEffect, useRef, useState, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useRules, useSaveRules, useLineage, useLineageConsumers } from '@/hooks/useApi'
import { registerTM1Completions, registerTM1Theme } from '@/lib/tm1-functions'
import ProcessEditor from '@/components/ProcessEditor'
import SubsetEditor from '@/components/SubsetEditor'
import DimensionEditor from '@/components/DimensionEditor'
import ViewEditor from '@/components/ViewEditor'
import { toast } from 'sonner'
import { GitBranch, ChevronRight, ChevronDown, Loader2, ChevronsUpDown, ChevronsDownUp, ListTree, AlignLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const { initTabContent, updateTabContent, markTabSaved, clearScrollTo, openTab, server, dark } = useStore()
  const { data, isLoading } = useRules(tab.server, tab.cube)
  const saveRules = useSaveRules()
  const registeredRef = useRef(false)
  const editorRef = useRef(null)
  const [showLineage, setShowLineage] = useState(false)
  const [regionsCollapsed, setRegionsCollapsed] = useState(false)
  const [showRegionMenu, setShowRegionMenu] = useState(false)

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

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    if (!registeredRef.current) {
      registerTM1Completions(monaco, () => server)
      registerTM1Theme(monaco)
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

  if (isLoading && tab.content === null) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading rules…</div>
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0 relative">
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
          <button
            onClick={() => editorRef.current?.getAction('editor.action.formatDocument').run()}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-border bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
            title="Format Document (Ctrl+Shift+F)"
          >
            <AlignLeft size={11} />
            Format
          </button>
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
      {showLineage && (
        <LineagePanel server={tab.server} cube={tab.cube} onOpen={openCube} />
      )}
    </div>
  )
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export default function EditorPane() {
  const { tabs, activeTab, setCursor } = useStore()
  const [cursor, setCursorLocal] = useState({ line: 1, col: 1 })
  const tab = tabs.find(t => t.id === activeTab)

  const handleCursor = (pos) => setCursorLocal(pos)

  if (!tab) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm select-none">
          Open an object from the explorer to start editing.
        </div>
        <div className="h-5" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 min-h-0">
        {tab.type === 'rules'     && <RulesEditor     key={tab.id} tab={tab} onCursor={handleCursor} />}
        {tab.type === 'process'   && <ProcessEditor    key={tab.id} tab={tab} />}
        {tab.type === 'subset'    && <SubsetEditor     key={tab.id} tab={tab} />}
        {tab.type === 'dimension' && <DimensionEditor  key={tab.id} tab={tab} />}
        {(tab.type === 'view' || tab.type === 'cubeview') && <ViewEditor key={tab.id} tab={tab} />}
      </div>
      <div className="flex items-center px-3 py-0.5 bg-muted border-t border-border text-xs text-muted-foreground shrink-0">
        <span>Ln {cursor.line}, Col {cursor.col}</span>
        <span className="ml-4">
          {tab.type === 'rules' ? 'TM1 Rules' : tab.type === 'subset' ? 'MDX' : tab.type === 'dimension' ? 'Dimension' : tab.type === 'view' || tab.type === 'cubeview' ? 'View' : 'TM1 TI'}
        </span>
      </div>
    </div>
  )
}
