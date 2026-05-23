import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'
import { Search, PanelLeftClose, PanelLeftOpen, Keyboard, Settings, SlidersHorizontal, BookType } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import ServerSelector from '@/components/ServerSelector'
import Explorer from '@/components/Explorer'
import TabBar from '@/components/TabBar'
import EditorPane from '@/components/EditorPane'
import StatusBar from '@/components/StatusBar'
import FindReplace from '@/components/FindReplace'
import ShortcutsHelp from '@/components/ShortcutsHelp'
import FormatSettings from '@/components/FormatSettings'
import EditorPreferences from '@/components/EditorPreferences'
import NamingDictionary from '@/components/NamingDictionary'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

export default function App() {
  const { loadForge, formatSettingsOpen, setFormatSettingsOpen } = useStore()
  const [showFind, setShowFind]           = useState(false)
  const [showSidebar, setShowSidebar]     = useState(true)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showNamingDict, setShowNamingDict] = useState(false)
  const [showPrefs, setShowPrefs]         = useState(false)

  useEffect(() => { loadForge() }, [])

  // Auto-show sidebar when revealing an object in the Explorer tree
  const revealTarget = useStore(s => s.revealTarget)
  useEffect(() => {
    if (revealTarget && !showSidebar) setShowSidebar(true)
  }, [revealTarget, showSidebar])

  useEffect(() => {
    const onKey = (e) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (e.key === 'F1' || (ctrl && e.shiftKey && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        setShowShortcuts(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

          {/* ── Header ───────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
            <button
              onClick={() => setShowSidebar(s => !s)}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            >
              {showSidebar ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </button>
            <span className="font-semibold text-sm tracking-tight">TM1 IDE</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setShowFind(f => !f)}
                className={cn('p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors', showFind && 'bg-muted text-foreground')}
                title="Find & Replace (Ctrl+F)"
              >
                <Search size={15} />
              </button>
              <button
                onClick={() => setShowShortcuts(true)}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Keyboard Shortcuts (F1)"
              >
                <Keyboard size={15} />
              </button>
              <button
                onClick={() => setShowNamingDict(true)}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Naming Dictionary"
              >
                <BookType size={15} />
              </button>
              <button
                data-prefs-trigger
                onClick={() => setShowPrefs(p => !p)}
                className={cn('p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors', showPrefs && 'bg-muted text-foreground')}
                title="Editor Preferences"
              >
                <SlidersHorizontal size={15} />
              </button>
              <button
                onClick={() => setFormatSettingsOpen(true)}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Format Settings"
              >
                <Settings size={15} />
              </button>
            </div>
          </div>

          {/* ── Body ─────────────────────────────────────────────────────── */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <PanelGroup direction="horizontal" className="flex-1">

              {/* Explorer sidebar */}
              {showSidebar && (
                <>
                  <Panel defaultSize={18} minSize={12} maxSize={35} className="flex flex-col border-r border-border bg-sidebar">
                    <ServerSelector />
                    <Explorer />
                  </Panel>
                  <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />
                </>
              )}

              {/* Find & Replace panel */}
              {showFind && (
                <>
                  <Panel defaultSize={22} minSize={18} maxSize={40}>
                    <FindReplace onClose={() => setShowFind(false)} />
                  </Panel>
                  <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />
                </>
              )}

              {/* Editor */}
              <Panel className="flex flex-col min-w-0">
                <EditorPane />
                <TabBar />
              </Panel>

            </PanelGroup>
          </div>

          <StatusBar />

        </div>
        <ShortcutsHelp open={showShortcuts} onClose={() => setShowShortcuts(false)} />
        <EditorPreferences open={showPrefs} onClose={() => setShowPrefs(false)} />
        <FormatSettings open={formatSettingsOpen} onClose={() => setFormatSettingsOpen(false)} />
        <NamingDictionary open={showNamingDict} onClose={() => setShowNamingDict(false)} />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
