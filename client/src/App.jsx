import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'
import { Sun, Moon, Search, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import ServerSelector from '@/components/ServerSelector'
import Explorer from '@/components/Explorer'
import TabBar from '@/components/TabBar'
import EditorPane from '@/components/EditorPane'
import StatusBar from '@/components/StatusBar'
import FindReplace from '@/components/FindReplace'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

export default function App() {
  const { dark, setDark, loadForge } = useStore()
  const [showFind, setShowFind]       = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)

  useEffect(() => { loadForge() }, [])

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
                title="Find & Replace"
              >
                <Search size={15} />
              </button>
              <button
                onClick={() => setDark(!dark)}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title={dark ? 'Light mode' : 'Dark mode'}
              >
                {dark ? <Sun size={15} /> : <Moon size={15} />}
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
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
