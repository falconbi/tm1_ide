import { ChevronRight, ChevronDown, Loader2, List, GitBranch, Plus, X, ClipboardList, Table2, Search, ListOrdered, MapPin, Grid3x3, Cog, HelpCircle } from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import HelpPanel from '@/components/HelpPanel'
import HierarchyFromAttributeDialog from '@/components/HierarchyFromAttributeDialog'
import { AlternateBanner } from './ElementPanel'

export default function DimensionToolbar({
  tab, view, setView, hierarchies, selectedHierarchy, onSelectHierarchy,
  addingHierarchy, setAddingHierarchy, newHierarchyName, setNewHierarchyName,
  hierMenu, setHierMenu, fromAttr, setFromAttr, handleFromAttrDone, createHierarchy, run,
  filteredElements, elements, busy, error, setAddRoot, setBulkAdd,
  showIndex, setShowIndex, setShowPicklist, showHelp, setShowHelp,
  dimCubes, dimProcs, showCubes, setShowCubes, filterSearch, setFilterSearch,
}) {
  return (
    <>
      {/* Toolbar row 1 — title + hierarchy + actions */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted shrink-0">
        <span className="text-xs font-semibold">{tab.dimension}</span>
        <button
          onClick={() => {
            const { setRevealTarget } = useStore.getState()
            setRevealTarget({
              type: tab.hierarchy && tab.hierarchy !== tab.dimension ? 'hierarchy' : 'dimension',
              server: tab.server,
              dimension: tab.dimension,
              hierarchy: tab.hierarchy,
            })
          }}
          className="p-1 rounded hover:bg-muted text-amber-400 hover:text-amber-300 transition-colors"
          title="Show in Explorer tree"
        >
          <MapPin size={11} />
        </button>
        {hierarchies.filter(h => h !== 'Leaves').length > 1 && (
          <select
            value={selectedHierarchy}
            onChange={e => onSelectHierarchy(e.target.value)}
            className="text-xs bg-background border border-border rounded px-1.5 py-0.5 text-foreground max-w-36"
            title="Select hierarchy"
          >
            {hierarchies.filter(h => h !== 'Leaves').map(h => <option key={h} value={h}>{h}{h === tab.dimension ? ' (default)' : ' (alternate)'}</option>)}
          </select>
        )}
        {addingHierarchy ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newHierarchyName}
              onChange={e => setNewHierarchyName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newHierarchyName.trim()) {
                  run(async () => {
                    await createHierarchy(newHierarchyName.trim())
                  })
                }
                if (e.key === 'Escape') { setAddingHierarchy(false); setNewHierarchyName('') }
              }}
              onBlur={() => { setAddingHierarchy(false); setNewHierarchyName('') }}
              placeholder="Hierarchy name…"
              className="text-xs bg-background border border-primary rounded px-1.5 py-0.5 outline-none w-28"
            />
            <button onClick={() => { setAddingHierarchy(false); setNewHierarchyName('') }} className="text-muted-foreground hover:text-foreground"><X size={10} /></button>
          </div>
        ) : (
          <button
            onClick={() => setHierMenu(m => !m)}
            className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-background relative"
            title="New hierarchy"
          >
            <Plus size={9} /> Hierarchy
            {hierMenu && (
              <span className="absolute left-0 top-full mt-1 z-50 w-56 rounded border border-border bg-popover shadow-lg text-left py-1" onClick={e => e.stopPropagation()}>
                <span role="button" className="block px-3 py-1.5 hover:bg-muted text-foreground"
                  onClick={() => { setHierMenu(false); setFromAttr(true) }}>
                  From an attribute…<span className="block text-[10px] text-muted-foreground">Generated and kept in step by a process</span>
                </span>
                <span role="button" className="block px-3 py-1.5 hover:bg-muted text-foreground"
                  onClick={() => { setHierMenu(false); setAddingHierarchy(true); setNewHierarchyName('') }}>
                  Empty<span className="block text-[10px] text-muted-foreground">Built by hand in this editor</span>
                </span>
              </span>
            )}
          </button>
        )}
        <span className="text-xs text-muted-foreground">
          {filteredElements.length !== elements.length
            ? `${filteredElements.length} / ${elements.length} elements`
            : `${elements.length} elements`}
        </span>
        {busy && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
        {error && <span className="text-xs text-red-400 truncate max-w-40" title={error}>{error}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => { setAddRoot(true); setView('tree') }} disabled={busy}
            className="flex items-center gap-0.5 px-2 py-0.5 text-xs rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Plus size={10} /> Add
          </button>
          <button onClick={() => setBulkAdd(true)} disabled={busy}
            className="flex items-center gap-0.5 px-2 py-0.5 text-xs rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40">
            <ClipboardList size={10} /> Bulk
          </button>
          <span className="w-px h-4 bg-border mx-0.5" />
          <button onClick={() => setView('tree')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'tree' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <GitBranch size={11} /> Tree
          </button>
          <button onClick={() => setView('flat')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'flat' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <List size={11} /> Flat
          </button>
          <button onClick={() => setView('grid')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'grid' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <Grid3x3 size={11} /> Grid
          </button>
          <button onClick={() => setView('attrs')}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              view === 'attrs' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-background')}>
            <Table2 size={11} /> Attrs
          </button>
          <span className="w-px h-4 bg-border mx-0.5" />
          <button onClick={() => setShowIndex(v => !v)}
            className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded border transition-colors',
              showIndex ? 'bg-primary/10 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:bg-background hover:text-foreground')}
            title="Toggle element index">
            # Idx
          </button>
          <button onClick={() => setShowPicklist(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border text-muted-foreground hover:bg-background hover:text-foreground transition-colors">
            <ListOrdered size={11} /> Picklists
          </button>
          <span className="w-px h-4 bg-border mx-0.5" />
          <button onClick={() => setShowHelp(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
            title="Help — Dimension Editor">
            <HelpCircle size={11} />
          </button>
        </div>
      </div>
      <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="dimension" />
      <AlternateBanner server={tab.server} dimension={tab.dimension} hierarchy={selectedHierarchy} />
      {fromAttr && (
        <HierarchyFromAttributeDialog server={tab.server} dimension={tab.dimension} onClose={() => setFromAttr(false)}
          onDone={handleFromAttrDone} />
      )}

      {/* Toolbar row 2 — used in + filters */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/50 shrink-0 flex-wrap">
        {(dimCubes.length > 0 || dimProcs.length > 0) && (
          <span className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setShowCubes(s => !s)}
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors shrink-0">
              {showCubes ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Used in {dimCubes.length} cube{dimCubes.length !== 1 ? 's' : ''}{dimProcs.length > 0 ? `, ${dimProcs.length} TI` : ''}
            </button>
            {showCubes && <>
              {dimCubes.map(c => (
                <span key={c} className="px-1.5 py-px rounded bg-background border border-border text-[10px] font-mono text-muted-foreground">{c}</span>
              ))}
              {dimProcs.map((p, i) => (
                <span key={`p-${i}`} className="flex items-center gap-1 px-1.5 py-px rounded bg-background border border-border text-[10px] font-mono text-muted-foreground">
                  <Cog size={8} />{p.process}
                </span>
              ))}
            </>}
          </span>
        )}
        {/* the one element filter — Tree, Flat and Attrs; not Grid, which edits and applies every row */}
        <span className="ml-auto flex items-center gap-2">
          {view !== 'grid' && <div className="flex items-center gap-1 bg-background border border-border rounded px-1.5 py-0.5">
            <Search size={10} className="text-muted-foreground shrink-0" />
            <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
              placeholder="Filter elements…"
              className="text-xs bg-transparent outline-none w-28 placeholder:text-muted-foreground" />
            {filterSearch && (
              <button onClick={() => setFilterSearch('')} className="text-muted-foreground hover:text-foreground shrink-0">
                <X size={9} />
              </button>
            )}
          </div>}
        </span>
      </div>
    </>
  )
}
