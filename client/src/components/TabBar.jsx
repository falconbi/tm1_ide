import { useState, useRef, useEffect } from 'react'
import { useStore } from '@/store'
import {
  X, Box, Cog, XSquare, ChevronDown, ChevronUp, Table2, Sigma, Layers,
  Columns2, Rows2, PanelRightClose, Database, Clock, Braces, Code2,
  ArrowRight, ChevronsRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const TYPE_ICON = {
  rules:         Sigma,
  process:       Cog,
  cubeview:      Table2,
  view:          Table2,
  subset:        Layers,
  dimension:     Layers,
  chore:         Clock,
  sql:           Database,
  guidedmdxview: Braces,
  cubeeditor:    Box,
}

const getTabIcon = (tab) => {
  if ((tab.type === 'cubeview' || tab.type === 'view') && tab.viewType) {
    return tab.viewType.includes('MDXView') ? Code2 : Table2
  }
  return TYPE_ICON[tab.type] ?? Box
}

// ── Context menu ──────────────────────────────────────────────────────────────
function ContextMenu({ tabId, groupId, x, y, onClose }) {
  const { closeTab, closeOtherTabsInGroup, closeTabsToRight, openTabInOtherGroup, moveTabToGroup, splitGroup, groups } = useStore()
  const ref = useRef(null)
  const multiGroup = groups.length > 1
  const otherGroup = groups.find(g => g.id !== groupId)

  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key  = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose])

  // Clamp to viewport
  const style = {
    position: 'fixed',
    top: Math.min(y, window.innerHeight - 200),
    left: Math.min(x, window.innerWidth - 220),
    zIndex: 9999,
  }

  const item = (icon, label, onClick, danger = false) => (
    <button
      key={label}
      onClick={() => { onClick(); onClose() }}
      className={cn(
        'flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs transition-colors',
        danger ? 'text-red-400 hover:bg-red-500/10' : 'text-foreground hover:bg-muted',
      )}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div
      ref={ref}
      style={style}
      className="bg-popover border border-border rounded-lg shadow-xl py-1 w-52 select-none"
    >
      {item(<Columns2 size={11} />, 'Split Right', () => splitGroup('horizontal', tabId))}
      {item(<Rows2 size={11} />, 'Split Down', () => splitGroup('vertical', tabId))}
      {multiGroup && otherGroup && item(<ArrowRight size={11} />, 'Move to other pane', () => moveTabToGroup(tabId, groupId, otherGroup.id))}
      <div className="border-t border-border my-1" />
      {item(<ChevronsRight size={11} />, 'Close to the right', () => closeTabsToRight(tabId, groupId))}
      {item(<XSquare size={11} />, 'Close others', () => closeOtherTabsInGroup(tabId, groupId))}
      <div className="border-t border-border my-1" />
      {item(<X size={11} />, 'Close', () => closeTab(tabId), true)}
    </div>
  )
}

// ── TabBar ────────────────────────────────────────────────────────────────────
export default function TabBar({ groupId }) {
  const {
    tabs, groups, activeGroupId,
    setActiveTab, closeTab, closeAllTabs, closeGroup, splitGroup,
    tabsVisible, toggleTabs,
    reorderTabInGroup, openTabInOtherGroup, setSplitDirection, splitDirection,
  } = useStore()

  const group      = groups.find(g => g.id === groupId)
  const groupTabs  = group ? group.tabIds.map(id => tabs.find(t => t.id === id)).filter(Boolean) : []
  const activeTabId = group?.activeTabId ?? null
  const isActiveGroup = activeGroupId === groupId
  const multiGroup = groups.length > 1

  // ── Context menu ────────────────────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState(null) // { tabId, x, y }

  const handleContextMenu = (e, tabId) => {
    e.preventDefault()
    setCtxMenu({ tabId, x: e.clientX, y: e.clientY })
  }

  // ── Drag to reorder ─────────────────────────────────────────────────────────
  const dragIdx    = useRef(null)
  const [dragOver, setDragOver] = useState(null)

  const handleDragStart = (e, idx) => {
    dragIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
    // Ghost image — transparent
    const ghost = document.createElement('div')
    ghost.style.opacity = '0'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    setTimeout(() => document.body.removeChild(ghost), 0)
  }

  const handleDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOver !== idx) setDragOver(idx)
  }

  const handleDrop = (e, idx) => {
    e.preventDefault()
    if (dragIdx.current !== null && dragIdx.current !== idx) {
      reorderTabInGroup(groupId, dragIdx.current, idx)
    }
    dragIdx.current = null
    setDragOver(null)
  }

  const handleDragEnd = () => { dragIdx.current = null; setDragOver(null) }

  // ── Close all ───────────────────────────────────────────────────────────────
  const handleCloseAll = () => {
    const dirty = groupTabs.filter(t => t.dirty).map(t => t.label)
    if (dirty.length > 0) {
      const ok = window.confirm(
        `${dirty.length} tab${dirty.length > 1 ? 's have' : ' has'} unsaved changes:\n\n${dirty.join('\n')}\n\nClose all anyway?`
      )
      if (!ok) return
    }
    if (multiGroup) closeGroup(groupId)
    else closeAllTabs()
  }

  // ── Collapsed state ─────────────────────────────────────────────────────────
  if (!tabsVisible) {
    return (
      <div className={cn('flex items-center border-b border-border bg-muted/40 shrink-0 h-5', isActiveGroup && multiGroup && 'border-t-2 border-t-primary')}>
        <button onClick={toggleTabs} title="Show tabs" className="flex items-center gap-1 px-2 h-full text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <ChevronDown size={10} />
          {groupTabs.length > 0 && <span>{groupTabs.length} tab{groupTabs.length !== 1 ? 's' : ''}</span>}
        </button>
      </div>
    )
  }

  if (!groupTabs.length) {
    return (
      <div className={cn('flex items-center border-b border-border bg-background shrink-0 h-6', isActiveGroup && multiGroup && 'border-t-2 border-t-primary')}>
        <button onClick={toggleTabs} title="Hide tabs" className="px-2 h-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <ChevronUp size={10} />
        </button>
      </div>
    )
  }

  return (
    <>
      {ctxMenu && (
        <ContextMenu
          tabId={ctxMenu.tabId}
          groupId={groupId}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <div className={cn('flex items-center border-b border-border bg-background shrink-0', isActiveGroup && multiGroup && 'border-t-2 border-t-primary')}>
        <button onClick={toggleTabs} title="Hide tabs" className="shrink-0 px-1.5 h-full self-stretch text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-r border-border">
          <ChevronUp size={10} />
        </button>

        <div className="flex items-center overflow-x-auto scrollbar-none flex-1 min-w-0">
          {groupTabs.map((tab, idx) => {
            const Icon = getTabIcon(tab)
            const active = tab.id === activeTabId
            const isDragTarget = dragOver === idx && dragIdx.current !== idx
            return (
              <div
                key={tab.id}
                draggable
                onDragStart={e => handleDragStart(e, idx)}
                onDragOver={e => handleDragOver(e, idx)}
                onDrop={e => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                onClick={() => setActiveTab(tab.id)}
                onContextMenu={e => handleContextMenu(e, tab.id)}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 border-r border-border cursor-pointer shrink-0 text-xs max-w-44 group transition-colors',
                  active ? 'bg-background text-foreground border-t-2 border-t-primary -mt-px' : 'bg-muted/60 text-muted-foreground hover:bg-background hover:text-foreground',
                  isDragTarget && 'border-l-2 border-l-primary',
                )}
              >
                <Icon size={10} className="shrink-0" />
                <span className="truncate">{tab.label}</span>
                {tab.dirty && <span className="text-orange-400 text-[10px]">●</span>}
                {multiGroup && (
                  <button
                    onClick={e => { e.stopPropagation(); openTabInOtherGroup(tab.id) }}
                    title="Open in other pane"
                    className="ml-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-primary/20 p-0.5 text-primary/70 hover:text-primary transition-opacity"
                  >
                    <ArrowRight size={9} />
                  </button>
                )}
                <button
                  onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                  className="ml-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 p-0.5 text-red-400 transition-opacity"
                >
                  <X size={9} />
                </button>
              </div>
            )
          })}
        </div>

        <button onClick={() => splitGroup('horizontal')} title="Split right" className="shrink-0 px-2 self-stretch text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-l border-border">
          <Columns2 size={11} />
        </button>
        <button onClick={() => splitGroup('vertical')} title="Split down" className="shrink-0 px-2 self-stretch text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-l border-border">
          <Rows2 size={11} />
        </button>
        {multiGroup && (
          <button
            onClick={() => setSplitDirection(splitDirection === 'horizontal' ? 'vertical' : 'horizontal')}
            title={`Switch to ${splitDirection === 'horizontal' ? 'vertical' : 'horizontal'} layout`}
            className="shrink-0 px-2 self-stretch text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-l border-border"
          >
            {splitDirection === 'horizontal' ? <Rows2 size={11} className="text-primary/70" /> : <Columns2 size={11} className="text-primary/70" />}
          </button>
        )}
        {multiGroup && (
          <button onClick={() => closeGroup(groupId)} title="Close group" className="shrink-0 px-2 self-stretch text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors border-l border-border">
            <PanelRightClose size={11} />
          </button>
        )}
        <button onClick={handleCloseAll} title="Close all tabs" className="shrink-0 px-2 self-stretch text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors border-l border-border">
          <XSquare size={11} />
        </button>
      </div>
    </>
  )
}
