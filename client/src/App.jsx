import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useState, useEffect, useRef, Fragment } from 'react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'
import { Search, PanelLeftClose, PanelLeftOpen, Keyboard, SlidersHorizontal, Database, Braces, Users, BookOpen, Rocket } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels' // used for inner editor split groups only
import ServerSelector from '@/components/ServerSelector'
import Explorer from '@/components/Explorer'
import TabBar from '@/components/TabBar'
import EditorPane from '@/components/EditorPane'
import StatusBar from '@/components/StatusBar'
import FindReplace from '@/components/FindReplace'
import ShortcutsHelp from '@/components/ShortcutsHelp'
import FormatSettings from '@/components/FormatSettings'
import EditorPreferences from '@/components/EditorPreferences'
import PeriodBuilder from '@/components/PeriodBuilder'
import SessionControl from '@/components/SessionControl'
import LoginPage from '@/components/LoginPage'
import UserManagement from '@/components/UserManagement'
import CatalogAdmin from '@/components/CatalogAdmin'
import DeployCenter from '@/components/DeployCenter'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

export default function App() {
  const { loadForge, formatSettingsOpen, setFormatSettingsOpen, openTab, openDeployCenter, server, token, clearAuth } = useStore()
  const groups         = useStore(s => s.groups)
  const splitDirection = useStore(s => s.splitDirection)
  const panelSizes     = useStore(s => s.panelSizes)
  const setPanelSizes  = useStore(s => s.setPanelSizes)
  const revealTarget   = useStore(s => s.revealTarget)

  const [showFind, setShowFind]                   = useState(false)
  const [showSidebar, setShowSidebar]             = useState(() => {
    try { return localStorage.getItem('tm1-sidebar') !== '0' } catch { return true }
  })
  const [showShortcuts, setShowShortcuts]         = useState(false)
  const [showPrefs, setShowPrefs]                 = useState(false)
  const [showPeriodBuilder, setShowPeriodBuilder] = useState(false)
  const [showUserMgmt, setShowUserMgmt]           = useState(false)
  const [showCatalog, setShowCatalog]             = useState(false)
  const [sidebarWidth, setSidebarWidth]           = useState(280)
  const [findWidth, setFindWidth]                 = useState(320)
  const dragRef = useRef(null)

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return
      const { target, startX, startW } = dragRef.current
      const delta = e.clientX - startX
      if (target === 'sidebar') setSidebarWidth(w => Math.min(500, Math.max(160, startW + delta)))
      else setFindWidth(w => Math.min(600, Math.max(240, startW + delta)))
    }
    const onUp = () => { dragRef.current = null; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  useEffect(() => {
    const handler = () => clearAuth()
    window.addEventListener('tm1-unauthorized', handler)
    return () => window.removeEventListener('tm1-unauthorized', handler)
  }, [])

  useEffect(() => { if (token) loadForge() }, [token])

  // Auto-show sidebar when revealing an object in the Explorer tree
  useEffect(() => {
    if (revealTarget && !showSidebar) setShowSidebar(true)
  }, [revealTarget, showSidebar])

  // Remember the sidebar's hidden/shown state across reloads
  useEffect(() => {
    try { localStorage.setItem('tm1-sidebar', showSidebar ? '1' : '0') } catch { /* ignore */ }
  }, [showSidebar])

  useEffect(() => {
    const onKey = (e) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (e.key === 'F1' || (ctrl && e.shiftKey && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        setShowShortcuts(true)
      }
      if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setShowSidebar(s => !s)
      }
      if (e.altKey && (e.key === ',' || e.key === '.' || e.key.toLowerCase() === 'w')) {
        const { groups, activeGroupId, closeTab, setActiveTab } = useStore.getState()
        const group = groups.find(g => g.id === activeGroupId)
        if (!group || !group.tabIds.length) return
        e.preventDefault()
        if (e.key.toLowerCase() === 'w') {
          if (group.activeTabId) closeTab(group.activeTabId)
        } else {
          const idx = group.tabIds.indexOf(group.activeTabId)
          const len = group.tabIds.length
          const next = e.key === '.'
            ? group.tabIds[(idx + 1) % len]
            : group.tabIds[(idx - 1 + len) % len]
          setActiveTab(next)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (!token) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <LoginPage />
        </TooltipProvider>
      </QueryClientProvider>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

          {/* ── Header ───────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
            <button
              onClick={() => setShowSidebar(s => !s)}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={showSidebar ? 'Hide sidebar (Ctrl+B)' : 'Show sidebar (Ctrl+B)'}
            >
              {showSidebar ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </button>
            <span className="font-semibold text-sm tracking-tight">TM1 IDE</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => openTab({ id: `guidedmdxview:${Date.now()}`, type: 'guidedmdxview', label: 'MDX Builder', server })}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Guided MDX View Builder"
              >
                <Braces size={15} />
              </button>
              <button
                onClick={() => openTab({ id: `sql:${Date.now()}`, type: 'sql', label: 'SQL Editor' })}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="SQL Editor"
              >
                <Database size={15} />
              </button>
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
                data-prefs-trigger
                onClick={() => setShowPrefs(p => !p)}
                className={cn('p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors', showPrefs && 'bg-muted text-foreground')}
                title="Editor Preferences"
              >
                <SlidersHorizontal size={15} />
              </button>

              <div className="w-px h-4 bg-border mx-1" />

              <button
                onClick={() => setShowCatalog(v => !v)}
                className={cn('p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors', showCatalog && 'bg-muted text-foreground')}
                title="Function Catalog (Rules / TI / MDX)"
              >
                <BookOpen size={15} />
              </button>
              {server && (
                <button
                  onClick={() => setShowUserMgmt(v => !v)}
                  className={cn('p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors', showUserMgmt && 'bg-muted text-foreground')}
                  title="User Management"
                >
                  <Users size={15} />
                </button>
              )}

              {/* Deploy — full-screen takeover: new deploy, history, import, baselines */}
              <button
                onClick={() => openDeployCenter({ server, view: 'history' })}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Deploy"
              >
                <Rocket size={15} />
              </button>

              <div className="w-px h-4 bg-border mx-1" />
              <SessionControl />

            </div>
          </div>

          {/* ── Body ─────────────────────────────────────────────────────── */}
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* Explorer sidebar */}
            {showSidebar && (
              <>
                <div style={{ width: sidebarWidth }} className="flex flex-col border-r border-border bg-sidebar shrink-0 min-w-0 overflow-hidden">
                  <ServerSelector />
                  <Explorer />
                </div>
                <div
                  className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize shrink-0"
                  onMouseDown={e => { dragRef.current = { target: 'sidebar', startX: e.clientX, startW: sidebarWidth }; document.body.style.cursor = 'col-resize'; e.preventDefault() }}
                />
              </>
            )}

            {/* Find & Replace panel */}
            {showFind && (
              <>
                <div style={{ width: findWidth }} className="shrink-0 min-w-0 overflow-hidden">
                  <FindReplace onClose={() => setShowFind(false)} />
                </div>
                <div
                  className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize shrink-0"
                  onMouseDown={e => { dragRef.current = { target: 'find', startX: e.clientX, startW: findWidth }; document.body.style.cursor = 'col-resize'; e.preventDefault() }}
                />
              </>
            )}

            {/* Editor groups */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              <PanelGroup direction={splitDirection} className="flex-1" onLayout={setPanelSizes}>
                {groups.map((group, i) => (
                  <Fragment key={group.id}>
                    {i > 0 && (
                      <PanelResizeHandle className={splitDirection === 'horizontal'
                        ? 'group relative w-1.5 bg-border hover:bg-primary/40 data-[resize-handle-active]:bg-primary transition-colors cursor-col-resize flex items-center justify-center'
                        : 'group relative h-1.5 bg-border hover:bg-primary/40 data-[resize-handle-active]:bg-primary transition-colors cursor-row-resize flex items-center justify-center'
                      }>
                        <div className={splitDirection === 'horizontal'
                          ? 'absolute w-4 h-8 flex flex-col items-center justify-center gap-0.5'
                          : 'absolute h-4 w-8 flex flex-row items-center justify-center gap-0.5'
                        }>
                          {[0,1,2].map(d => (
                            <div key={d} className={splitDirection === 'horizontal'
                              ? 'w-0.5 h-0.5 rounded-full bg-border group-hover:bg-primary/60 transition-colors'
                              : 'h-0.5 w-0.5 rounded-full bg-border group-hover:bg-primary/60 transition-colors'
                            } />
                          ))}
                        </div>
                      </PanelResizeHandle>
                    )}
                    <Panel className="flex flex-col min-w-0" defaultSize={panelSizes?.[i] ?? (100 / groups.length)}>
                      <EditorPane groupId={group.id} />
                      <TabBar groupId={group.id} />
                    </Panel>
                  </Fragment>
                ))}
              </PanelGroup>
            </div>


          </div>

          <StatusBar />

        </div>
        <ShortcutsHelp open={showShortcuts} onClose={() => setShowShortcuts(false)} />
        <EditorPreferences
          open={showPrefs}
          onClose={() => setShowPrefs(false)}
          onOpenPeriodBuilder={() => setShowPeriodBuilder(true)}
          onOpenFormatSettings={() => setFormatSettingsOpen(true)}
        />
        <FormatSettings open={formatSettingsOpen} onClose={() => setFormatSettingsOpen(false)} />
        {showUserMgmt && server && <UserManagement server={server} onClose={() => setShowUserMgmt(false)} />}
        {showCatalog && <CatalogAdmin server={server} onClose={() => setShowCatalog(false)} />}
        <PeriodBuilder open={showPeriodBuilder} onClose={() => setShowPeriodBuilder(false)} />
        <DeployCenter />
        <Toaster position="bottom-right" duration={3000} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
