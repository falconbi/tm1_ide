import { cn } from '@/lib/utils'
import { ChevronDown, Play, Braces, Search, Bug, Map, ListTree, ChevronsUpDown, ChevronsDownUp, Undo2, Redo2, History } from 'lucide-react'
import { CODE_TABS } from '@/lib/process-editor/constants'

// Section tabs and the action row: history, undo/redo, save/save-as/create,
// Check, Capture, Run, regions, snippets and minimap.
export default function ProcessToolbar({
  tab, activeSection, onSectionChange, edits,
  showHistory, onToggleHistory, onUndo, onRedo,
  draftName, onDraftNameChange, onCreateNew, creating,
  onSave, saveDisabled, saving,
  showSaveMenu, saveMenuRect, onToggleSaveMenu, onCloseSaveMenu, onSaveAs,
  hasData, onToggleCheck, showCheck, onToggleDebug, showDebug,
  onToggleSnippets, showSnippets, onRun,
  showRegionMenu, regionRect, regionList, onOpenRegionMenu, onGoToRegion, regionBtnRef,
  regionsCollapsed, onToggleRegions, onToggleMinimap, showMinimap,
}) {
  return (
    <div className="flex items-center border-b border-border bg-muted shrink-0 overflow-x-auto">
      {CODE_TABS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onSectionChange(key)}
          className={cn(
            'px-4 py-1.5 text-xs font-medium border-r border-border transition-colors',
            activeSection === key
              ? 'bg-background text-foreground border-t-2 border-t-primary -mt-px'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
          )}
        >
          {label}
          {edits[key] !== undefined && (
            <span className="ml-1.5 text-orange-400">●</span>
          )}
        </button>
      ))}

      <div className="ml-auto flex items-center gap-1 mr-2">
        <button
          onClick={onToggleHistory}
          disabled={!tab.name}
          title="Object history"
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors disabled:opacity-40',
            showHistory ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          <History size={11} />
        </button>
        <button
          onClick={onUndo}
          title="Undo (Ctrl/Cmd+Z)"
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Undo2 size={11} />
        </button>
        <button
          onClick={onRedo}
          title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Redo2 size={11} />
        </button>
        {!tab.name ? (
          <>
            <input
              value={draftName}
              onChange={e => onDraftNameChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onCreateNew()}
              placeholder="Process name…"
              className="px-2 py-1 text-xs border rounded bg-background font-mono outline-none focus:border-primary w-44"
            />
            <button
              onClick={onCreateNew}
              disabled={!draftName.trim() || creating}
              className="px-3 py-1 text-xs rounded bg-emerald-700 text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {creating ? 'Creating…' : 'Create & Save'}
            </button>
          </>
        ) : (
          <div className="relative flex items-center">
            <button
              onClick={onSave}
              disabled={saveDisabled || saving}
              title="Save (Ctrl+S)"
              className="px-3 py-1 text-xs rounded-l bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect()
                onToggleSaveMenu({ top: r.bottom + 4, right: window.innerWidth - r.right })
              }}
              disabled={!hasData}
              title="Save options"
              className="px-1 py-1 text-xs rounded-r bg-primary text-primary-foreground border-l border-primary-foreground/20 disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              <ChevronDown size={11} />
            </button>
            {showSaveMenu && saveMenuRect && (
              <div className="fixed bg-popover border border-border rounded shadow-lg py-1 w-44"
                style={{ top: saveMenuRect.top, right: saveMenuRect.right, zIndex: 9999 }}
                onMouseLeave={onCloseSaveMenu}>
                <button onClick={onSaveAs}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors">
                  Save As… (new name)
                </button>
              </div>
            )}
          </div>
        )}
        <button
          onClick={onToggleCheck}
          disabled={!hasData}
          title="Check code for errors and warnings"
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors disabled:opacity-40',
            showCheck ? 'bg-amber-600 text-white border-amber-600 hover:bg-amber-700' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          <Search size={11} />
          <span className="hidden sm:inline">Check</span>
        </button>
        <button
          onClick={onToggleDebug}
          disabled={!hasData}
          title="Debug capture — click gutter to add capture points"
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors disabled:opacity-40',
            showDebug ? 'bg-orange-600 text-white border-orange-600 hover:bg-orange-700' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          <Bug size={11} />
          <span className="hidden sm:inline">Capture</span>
        </button>
        <button
          onClick={onRun}
          disabled={!hasData}
          className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-green-600 text-white disabled:opacity-40 hover:bg-green-700 transition-colors"
        >
          <Play size={11} />
          Run
        </button>
        <div className="relative region-menu-container shrink-0">
          <button
            ref={regionBtnRef}
            onClick={onOpenRegionMenu}
            title="Go to region"
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors',
              showRegionMenu ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <ListTree size={11} />
          </button>
          {showRegionMenu && regionRect && (
            <div
              className="fixed w-56 bg-popover border border-border rounded shadow-lg max-h-64 overflow-auto text-xs"
              style={{ top: regionRect.top, right: regionRect.right, zIndex: 9999 }}
            >
              {regionList.length === 0 ? (
                <div className="px-3 py-1.5 text-muted-foreground italic">No regions found</div>
              ) : (
                regionList.map(r => (
                  <button
                    key={r.line}
                    onClick={() => onGoToRegion(r.line)}
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
          onClick={onToggleRegions}
          title={regionsCollapsed ? 'Expand all regions' : 'Collapse all regions'}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors',
            regionsCollapsed ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          {regionsCollapsed ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
        </button>
        <button
          onClick={onToggleSnippets}
          title="Function reference"
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors',
            showSnippets ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          <Braces size={11} />
        </button>
        <button
          onClick={onToggleMinimap}
          title="Toggle minimap"
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors',
            showMinimap ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          <Map size={11} />
        </button>
      </div>
    </div>
  )
}
