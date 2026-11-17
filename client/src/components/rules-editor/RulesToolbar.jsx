import {
  GitBranch, Loader2, ChevronsUpDown, ChevronsDownUp, ListTree, AlignLeft, Settings,
  Save, Map, Microscope, ShieldCheck, HelpCircle, ListFilter, Undo2, Redo2, Braces, History,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export default function RulesToolbar({
  dirty, saving, onSave, onUndo, onRedo,
  checking, checkResult, onCheck,
  showFormatPopup, onToggleFormatPopup, formatPopupRef, formatStruct, onSelectFormatStruct,
  runFormat, onOpenFormatSettings,
  showRegionMenu, onToggleRegionMenu, regionList, onGoToRegion,
  regionsCollapsed, onToggleRegions,
  showSnippets, onToggleSnippets,
  showTrace, onToggleTrace,
  showMinimap, onToggleMinimap,
  showLineage, onToggleLineage,
  showRuleLens, onToggleRuleLens,
  showHistory, onToggleHistory,
  onShowHelp,
}) {
  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
      <button
        onClick={onToggleHistory}
        title="Object history"
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs border bg-background/80 transition-colors',
          showHistory ? 'border-primary text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
        )}
      >
        <History size={11} />
      </button>
      <button
        onClick={onUndo}
        title="Undo (Ctrl/Cmd+Z)"
        className="flex items-center gap-1 px-2 py-1 rounded text-xs border bg-background/80 border-border text-muted-foreground hover:text-foreground transition-colors"
      >
        <Undo2 size={11} />
      </button>
      <button
        onClick={onRedo}
        title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
        className="flex items-center gap-1 px-2 py-1 rounded text-xs border bg-background/80 border-border text-muted-foreground hover:text-foreground transition-colors"
      >
        <Redo2 size={11} />
      </button>
      <button
        onClick={onSave}
        disabled={!dirty || saving}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
          dirty
            ? 'bg-primary text-primary-foreground border-primary hover:opacity-90'
            : 'bg-background/80 border-border text-muted-foreground opacity-40'
        )}
        title="Save (Ctrl+S)"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
        Save
      </button>
      <button
        onClick={onCheck}
        disabled={checking}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-all disabled:opacity-40',
          checkResult === 'pass' && 'border-emerald-500 text-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.4)]',
          checkResult === 'fail' && 'border-red-500 text-red-400 shadow-[0_0_8px_2px_rgba(239,68,68,0.4)]',
          !checkResult && 'bg-background/80 border-border text-muted-foreground hover:text-foreground',
        )}
        title="Run CheckRules + static analysis now"
      >
        {checking ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
        Check
      </button>
      <div ref={formatPopupRef} className="relative format-popup-container">
        <button
          onClick={onToggleFormatPopup}
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
                  onClick={() => onSelectFormatStruct(opt.id)}
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
                onClick={onOpenFormatSettings}
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
          onClick={onToggleRegionMenu}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
            showRegionMenu ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
          )}
          title="Go to region"
        >
          <ListTree size={11} />
        </button>
        {showRegionMenu && (
          <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded shadow-lg z-50 max-h-64 overflow-auto text-xs">
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
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
          regionsCollapsed ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
        )}
        title={regionsCollapsed ? 'Expand all regions' : 'Collapse all regions'}
      >
        {regionsCollapsed ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
      </button>
      <button
        onClick={onToggleSnippets}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
          showSnippets ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
        )}
        title="Toggle function reference panel"
      >
        <Braces size={11} />
      </button>
      <button
        onClick={onToggleTrace}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
          showTrace ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
        )}
        title="Trace cell calculation"
      >
        <Microscope size={11} />
        Trace
      </button>
      <button
        onClick={onToggleMinimap}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
          showMinimap ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
        )}
        title="Toggle minimap"
      >
        <Map size={11} />
      </button>
      <button
        onClick={onToggleLineage}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
          showLineage ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
        )}
        title="Toggle rules lineage — which cubes this cube's rules read, and who reads it"
      >
        <GitBranch size={11} />
      </button>
      <button
        onClick={onToggleRuleLens}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
          showRuleLens ? 'bg-primary text-primary-foreground border-primary' : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
        )}
        title="Toggle the rule lens — rule areas, measures, DB sources and feeders"
      >
        <ListFilter size={11} />
      </button>
      <button
        onClick={onShowHelp}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs border bg-background/80 border-border text-muted-foreground hover:text-foreground transition-colors"
        title="Help — Rules Editor"
      >
        <HelpCircle size={11} />
      </button>
    </div>
  )
}
