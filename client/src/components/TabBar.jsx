import { useStore } from '@/store'
import { X, Box, Cog, XSquare, ChevronDown, ChevronUp, Table2, FileCode2, Layers, Columns2, PanelRightClose, Database, Clock, Braces, Code2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const TYPE_ICON = {
  rules:           FileCode2,
  process:         Cog,
  cubeview:        Table2,
  view:            Table2,
  subset:          Layers,
  dimension:       Layers,
  chore:           Clock,
  sql:             Database,
  guidedmdxsubset: Braces,
  guidedmdxview:   Braces,
}

const getTabIcon = (tab) => {
  if ((tab.type === 'cubeview' || tab.type === 'view') && tab.viewType) {
    return tab.viewType.includes('MDXView') ? Code2 : Table2
  }
  return TYPE_ICON[tab.type] ?? Box
}

export default function TabBar({ groupId }) {
  const { tabs, groups, activeGroupId, setActiveTab, closeTab, closeAllTabs, closeGroup, splitGroup, tabsVisible, toggleTabs } = useStore()

  const group = groups.find(g => g.id === groupId)
  const groupTabs = group ? group.tabIds.map(id => tabs.find(t => t.id === id)).filter(Boolean) : []
  const activeTabId = group?.activeTabId ?? null
  const isActiveGroup = activeGroupId === groupId
  const multiGroup = groups.length > 1

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

  if (!tabsVisible) {
    return (
      <div className={cn('flex items-center border-b border-border bg-muted/40 shrink-0 h-5', isActiveGroup && multiGroup && 'border-t-2 border-t-primary')}>
        <button
          onClick={toggleTabs}
          title="Show tabs"
          className="flex items-center gap-1 px-2 h-full text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
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
    <div className={cn('flex items-center border-b border-border bg-background shrink-0', isActiveGroup && multiGroup && 'border-t-2 border-t-primary')}>
      <button onClick={toggleTabs} title="Hide tabs" className="shrink-0 px-1.5 h-full self-stretch text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-r border-border">
        <ChevronUp size={10} />
      </button>
      <div className="flex items-center overflow-x-auto scrollbar-none flex-1 min-w-0">
        {groupTabs.map(tab => {
          const Icon = getTabIcon(tab)
          const active = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 border-r border-border cursor-pointer shrink-0 text-xs max-w-40 group',
                active
                  ? 'bg-background text-foreground border-t-2 border-t-primary -mt-px'
                  : 'bg-muted/60 text-muted-foreground hover:bg-background hover:text-foreground',
              )}
            >
              <Icon size={10} className="shrink-0" />
              <span className="truncate">{tab.label}</span>
              {tab.dirty && <span className="text-orange-400 text-[10px]">●</span>}
              <button
                onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                className="ml-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 p-0.5"
              >
                <X size={9} />
              </button>
            </div>
          )
        })}
      </div>
      <button
        onClick={splitGroup}
        title="Split editor right"
        className="shrink-0 px-2 self-stretch text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-l border-border"
      >
        <Columns2 size={11} />
      </button>
      {multiGroup && (
        <button
          onClick={() => closeGroup(groupId)}
          title="Close group"
          className="shrink-0 px-2 self-stretch text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-l border-border"
        >
          <PanelRightClose size={11} />
        </button>
      )}
      <button
        onClick={handleCloseAll}
        title="Close all tabs"
        className="shrink-0 px-2 self-stretch text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-l border-border"
      >
        <XSquare size={11} />
      </button>
    </div>
  )
}
