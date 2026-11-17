import { Component, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useCubeDimensions, useViews, useExecuteMDX, useViewAxes } from '@/hooks/useApi'
import { toast } from 'sonner'
import { Loader2, Table2, GripVertical, GripHorizontal, LayoutGrid, Rows3, Columns3, Filter, ZapOff, ChevronDown, ChevronUp, WrapText, AlertTriangle, ArrowUpDown } from 'lucide-react'
import HelpPanel from '@/components/HelpPanel'
import TransactionLogPanel from '@/components/TransactionLogPanel'
import CellContextMenu from '@/components/CellContextMenu'
import SourceViewPreview from '@/components/view-editor/SourceViewPreview.jsx'
import DropZone from '@/components/view-editor/axes/DropZone.jsx'
import TraceSidePanel from '@/components/view-editor/trace/TraceSidePanel.jsx'
import { cn } from '@/lib/utils'
import { formatMDX } from '@/lib/mdx-format'
import { useGridAppearance } from '@/lib/grid-appearance'
import PivotGrid from '@/components/PivotGrid'
import GridToolbar from '@/components/GridToolbar'
import { ConflictBanner, ConflictSaveWarning } from '@/components/ConflictBanner'
import DiffViewerModal from '@/components/DiffViewerModal'
import ViewToolbar from '@/components/view-editor/ViewToolbar.jsx'
import ViewAiBar from '@/components/view-editor/ViewAiBar.jsx'
import ViewUsedIn from '@/components/view-editor/ViewUsedIn.jsx'
import useViewLayout from '@/components/view-editor/hooks/useViewLayout.js'
import useViewMdx from '@/components/view-editor/hooks/useViewMdx.js'
import useViewTrace from '@/components/view-editor/hooks/useViewTrace.js'
import useViewSource from '@/components/view-editor/hooks/useViewSource.js'
import useViewResultState from '@/components/view-editor/hooks/useViewResultState.js'
import useViewLoad from '@/components/view-editor/hooks/useViewLoad.js'
import useViewRun from '@/components/view-editor/hooks/useViewRun.js'
import useViewSave from '@/components/view-editor/hooks/useViewSave.js'
import useViewShortcuts from '@/components/view-editor/hooks/useViewShortcuts.js'
import useViewUsedIn from '@/components/view-editor/hooks/useViewUsedIn.js'
import useViewPivotData from '@/components/view-editor/hooks/useViewPivotData.js'
import useFlatGrid from '@/components/view-editor/hooks/useFlatGrid.js'
import useCellWrite from '@/components/view-editor/hooks/useCellWrite.js'

ModuleRegistry.registerModules([AllCommunityModule])

class GridErrorBoundary extends Component {
    constructor(props) { super(props); this.state = { error: null } }
    static getDerivedStateFromError(error) { return { error } }
    render() {
        if (this.state.error) {
            return (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground p-8">
                    <AlertTriangle size={28} className="text-amber-500" />
                    <p className="font-medium text-foreground">View could not be rendered</p>
                    <p className="text-xs text-center max-w-xs">{this.state.error.message}</p>
                    <button
                        className="mt-2 px-3 py-1.5 rounded border text-xs hover:bg-muted"
                        onClick={() => this.setState({ error: null })}
                    >Retry</button>
                </div>
            )
        }
        return this.props.children
    }
}

export default function ViewEditor({ tab }) {
    const { dark, openTab, patchTab } = useStore()
    const app = useGridAppearance()
    const rulesVersion = useStore(s => s.rulesVersions[`${tab.server}::${tab.cube}`] ?? 0)
    const { data: cubeDims = [] } = useCubeDimensions(tab.server, tab.cube)
    const { data: views    = [] } = useViews(tab.server, tab.cube)
    const executeMDX   = useExecuteMDX()
    const loadViewAxes = useViewAxes()

    const [showHelp, setShowHelp] = useState(false)

    const layout = useViewLayout({ tab, cubeDims, patchTab, openTab })
    const mdxState = useViewMdx({ tab, patchTab, setAxes: layout.setAxes, axes: layout.axes })
    const trace = useViewTrace({ tab, patchTab })
    const source = useViewSource({ tab })
    const resultState = useViewResultState()
    const load = useViewLoad({ tab, cubeDims, layout, mdx: mdxState, source, resultState, patchTab, loadViewAxes })
    const run = useViewRun({ tab, layout, mdx: mdxState, resultState, executeMDX, rulesVersion })
    const save = useViewSave({ tab, views, openTab, layout, mdx: mdxState, run, isOriginallyNative: load.isOriginallyNative })
    useViewShortcuts({ handleExecute: run.handleExecute, handleSave: save.handleSave, handleSaveAs: save.handleSaveAs, viewName: tab.viewName })
    const usedIn = useViewUsedIn({ tab })
    const pivot = useViewPivotData({
        tab, cubeDims, axes: layout.axes,
        dimAliases: layout.dimAliases, aliasValueMaps: layout.aliasValueMaps,
        suppressZeros: layout.suppressZeros, app, gridResult: resultState.gridResult,
    })
    const flat = useFlatGrid({ tab, app, baseFlatColDefs: pivot.baseFlatColDefs, rowData: pivot.rowData })
    const { flatGridRef, flatRootRef, flatSavedWidthsRef } = flat
    const cell = useCellWrite({
        tab, cubeDims, axes: layout.axes,
        hierarchies: pivot.hierarchies, columnHierarchies: pivot.columnHierarchies,
        hierarchyData: pivot.hierarchyData, handleExecute: run.handleExecute,
    })

    const { axes, bench } = layout
    const { mode, mdx, setMdx, setMdxDirty, hasAI, aiPrompt, setAiPrompt, handleGenerateAI, generateViewMDX } = mdxState
    const { isOriginallyNative, mdxTooComplex } = load
    const { editorRef } = mdxState
    const { traceRef } = trace
    const isLoadingView = loadViewAxes.isPending
    const useHierarchy  = !flat.flatMode && !!(pivot.rowDims.length > 0 && pivot.pivotData && resultState.result)

    if (source.sourceMode) {
        return (
            <SourceViewPreview
                key={`${tab.server}:${tab.cube}:${tab.viewName}`}
                server={tab.server}
                cube={tab.cube}
                view={tab.viewName}
                processes={source.sourceProcesses}
                onOpenFull={() => source.setSourceOverride(true)}
            />
        )
    }

    return (
        <div className="flex h-full min-h-0">
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <ConflictBanner conflict={save.openConflict?.id !== save.dismissedId ? save.openConflict : null} onDismiss={() => save.setDismissedId(save.openConflict?.id)} />
            <ConflictSaveWarning
              conflict={save.saveConflict}
              onSaveAnyway={() => { save.setSaveConflict(null); save.executeSave(tab.viewName) }}
              onCancel={() => save.setSaveConflict(null)}
              onShowDiff={() => {
                const payload = save.buildSavePayload()
                save.setConflictDiff({
                  object_type: 'view',
                  object_name: tab.viewName,
                  detail:      tab.cube,
                  timestamp:   save.saveConflict.timestamp,
                  action:      'CONFLICT',
                  session_name: null,
                  before_state: save.saveConflict.after_state ?? (payload.nativeAxes ? { type: 'native', definition: payload.nativeAxes } : { type: 'mdx', mdx: payload.mdx ?? '' }),
                  after_state:  payload.nativeAxes ? { type: 'native', definition: payload.nativeAxes } : { type: 'mdx', mdx: payload.mdx ?? '' },
                })
              }}
            />
            {save.conflictDiff && <DiffViewerModal entry={save.conflictDiff} onClose={() => save.setConflictDiff(null)} />}

            <ViewToolbar
                tab={tab}
                views={views}
                layout={layout}
                mdxState={mdxState}
                save={save}
                run={run}
                load={load}
                flat={flat}
                cell={cell}
                isLoadingView={isLoadingView}
                setShowHelp={setShowHelp}
                showSaveMenu={save.showSaveMenu}
                setShowSaveMenu={save.setShowSaveMenu}
            />
            <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="view" />

            <ViewAiBar hasAI={hasAI} aiPrompt={aiPrompt} setAiPrompt={setAiPrompt} handleGenerateAI={handleGenerateAI} generateViewMDX={generateViewMDX} />

            {/* Complex MDX banner — Visual mode locked */}
            {mdxTooComplex && (
                <div className="shrink-0 px-3 py-1.5 border-b border-border bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 text-[10px] flex items-center gap-2">
                    <AlertTriangle size={11} className="shrink-0" />
                    <span>Visual mode unavailable — MDX uses <strong>{mdxTooComplex.join(', ')}</strong>. Replace these with named subsets to enable visual editing.</span>
                </div>
            )}

            {/* Native view in MDX mode warning */}
            {isOriginallyNative && mode === 'mdx' && !mdxTooComplex && (
                <div className="shrink-0 px-3 py-1 border-b border-border bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 text-[10px] flex items-center gap-1">
                    <ZapOff size={10} />
                    <span>Editing in MDX mode — saving will convert this Native view to MDX.</span>
                </div>
            )}

            <ViewUsedIn tab={tab} openTab={openTab} usedIn={usedIn} />

            {/* Visual builder */}
            {mode === 'visual' && (
                <div className="shrink-0 border-b border-border bg-muted/10">
                    {!layout.builderCollapsed && (
                        <DndContext sensors={layout.sensors} onDragStart={({ active }) => layout.setActiveDrag(active.id)} onDragEnd={(e) => layout.handleDragEnd(e, resultState.result)}>
                            <div className="px-3 py-2 grid grid-cols-4 gap-2">
                                <DropZone id="rows"    label="Rows"    icon={Rows3}    dims={axes.rows}    server={tab.server} onRemove={layout.removeDim} onSubsetChange={layout.setSubset} onMemberChange={layout.setMember} onMembersChange={layout.setMembers} onMemberSetChange={layout.setMemberSet} onHierarchyChange={layout.setHierarchy} usedKeys={layout.usedKeys} onReorder={(f,t) => layout.reorderDim('rows',f,t)}    accent="text-muted-foreground" dimAliases={layout.dimAliases} onAliasChange={layout.handleAliasChange} onBuildSubset={layout.handleBuildSubset} />
                                <DropZone id="columns" label="Columns" icon={Columns3} dims={axes.columns} server={tab.server} onRemove={layout.removeDim} onSubsetChange={layout.setSubset} onMemberChange={layout.setMember} onMembersChange={layout.setMembers} onMemberSetChange={layout.setMemberSet} onHierarchyChange={layout.setHierarchy} usedKeys={layout.usedKeys} onReorder={(f,t) => layout.reorderDim('columns',f,t)} accent="text-muted-foreground" dimAliases={layout.dimAliases} onAliasChange={layout.handleAliasChange} onBuildSubset={layout.handleBuildSubset} />
                                <DropZone id="pages"   label="Filter"  icon={Filter}   dims={axes.pages}   server={tab.server} onRemove={layout.removeDim} onSubsetChange={layout.setSubset} onMemberChange={layout.setMember} onMembersChange={layout.setMembers} onHierarchyChange={layout.setHierarchy} usedKeys={layout.usedKeys} onReorder={(f,t) => layout.reorderDim('pages',f,t)}   accent="text-muted-foreground" dimAliases={layout.dimAliases} onAliasChange={layout.handleAliasChange} onBuildSubset={layout.handleBuildSubset} />
                                <DropZone id="bench"   label="Bench"   icon={LayoutGrid} dims={bench}      server={tab.server} onRemove={() => {}}  onSubsetChange={() => {}}  onMemberChange={() => {}}  onMembersChange={() => {}}  onReorder={() => {}}                           accent="text-muted-foreground" />
                            </div>
                            <DragOverlay>
                                {layout.activeDim && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 rounded border text-xs bg-muted border-primary shadow-lg">
                                        <GripVertical size={11} /><span className="font-mono">{layout.activeDim.dimension}</span>
                                    </div>
                                )}
                            </DragOverlay>
                        </DndContext>
                    )}
                    {/* Collapse / expand toggle for the whole builder row */}
                    <div className="flex items-center gap-2 px-3 py-1">
                        <button onClick={() => layout.setBuilderCollapsed(c => !c)}
                            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors py-0.5 rounded"
                            title={layout.builderCollapsed ? 'Expand view builder' : 'Collapse view builder'}>
                            {layout.builderCollapsed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                            <LayoutGrid size={10} /> View builder
                        </button>
                        {layout.builderCollapsed && (
                            <span className="text-[10px] text-muted-foreground/60 truncate">
                                Rows {axes.rows.length} · Columns {axes.columns.length} · Filter {axes.pages.length} · Bench {bench.length}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* MDX editor */}
            {mode === 'mdx' && (
                <div className="shrink-0 border-b border-border flex flex-col min-h-0" style={{ height: mdxState.mdxEditorHeight }}>
                    <div className="flex items-center justify-between px-2 py-0.5 border-b border-border bg-muted/30 shrink-0">
                        <span className="text-[10px] text-muted-foreground">MDX</span>
                        <button
                            onClick={() => { const f = formatMDX(mdx); setMdx(f); setMdxDirty(true) }}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                            title="Format MDX"
                        >
                            <WrapText size={10} /> Format
                        </button>
                    </div>
                    <MonacoEditor
                        key={`mdx-editor-${tab.id}`}
                        height="100%"
                        language="tm1mdx"
                        value={mdx}
                        theme={dark ? 'vs-dark' : 'vs'}
                        onChange={v => { setMdx(v ?? ''); setMdxDirty(true) }}
                        onMount={(editor, monaco) => {
                            editorRef.current = editor
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save.handleSave)
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run.handleExecute)
                        }}
                        options={{
                            fontSize: 13,
                            minimap: { enabled: false },
                            wordWrap: 'on',
                            scrollBeyondLastLine: false,
                            lineNumbers: 'on',
                            folding: false,
                            fixedOverflowWidgets: true,
                            wordBasedSuggestions: 'off',
                        }}
                    />
                </div>
            )}

            {mode === 'mdx' && (
                <div onMouseDown={mdxState.startMdxEditorResize}
                    className="shrink-0 h-1.5 cursor-row-resize flex items-center justify-center hover:bg-primary/20 transition-colors group"
                    title="Drag to resize editor">
                    <GripHorizontal size={12} className="text-muted-foreground/40 group-hover:text-primary/60" />
                </div>
            )}

            {/* Truncation warning */}
            {resultState.truncated && (
                <div className="shrink-0 px-3 py-1 bg-yellow-500/10 border-b border-yellow-500/30 text-yellow-600 dark:text-yellow-400 text-xs flex items-center gap-1.5">
                    <span>⚠</span>
                    <span>Result capped at 50,000 cells — add filters or subsets to narrow the view.</span>
                </div>
            )}

            {/* Flat-mode hint */}
            {flat.flatMode && (
                <div className="shrink-0 px-3 py-1 bg-sky-500/10 border-b border-sky-500/30 text-sky-600 dark:text-sky-400 text-xs flex items-center gap-1.5">
                    <ArrowUpDown size={11} />
                    <span>Flat view — click a column header to sort. Toggle <span className="font-medium">Flat</span> off to return to the hierarchy view.</span>
                </div>
            )}

            {/* Grid */}
            {resultState.tooBig ? (
                <div className="flex-1 flex items-center justify-center text-sm select-none">
                    <div className="text-center max-w-md space-y-3 px-4">
                        <AlertTriangle size={28} className="mx-auto text-amber-500" />
                        <p className="text-foreground">This view has <span className="font-semibold">{resultState.resultRows.toLocaleString()}</span> rows.</p>
                        <p className="text-muted-foreground text-xs">Drawing that many rows can freeze the browser. Narrow it with a subset or a title member, or show it anyway.</p>
                        <button
                            onClick={() => resultState.setBigConfirmed(resultState.result)}
                            className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                            Show all {resultState.resultRows.toLocaleString()} rows
                        </button>
                    </div>
                </div>
            ) : !resultState.result ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm select-none">
                    <div className="text-center">
                        <Table2 size={32} className="mx-auto mb-2 opacity-30" />
                        <p>{mode === 'visual' ? 'Arrange dimensions then press Execute' : 'Edit MDX then press Execute'}</p>
                    </div>
                </div>
            ) : useHierarchy ? (
                <div className="flex-1 min-h-0">
                    <GridErrorBoundary>
                        <PivotGrid
                            key={tab.server && tab.cube ? `hg::${tab.server}::${tab.cube}::${tab.viewName || 'adhoc'}` : undefined}
                            pivot={pivot.pivotData}
                            rowHierarchies={pivot.hierarchies}
                            colHierarchies={pivot.columnHierarchies}
                            rowNames={run.rowNames}
                            dark={dark}
                            totals={layout.totalsPosition}
                            colTotals={layout.colTotalsPosition}
                            onWrite={cell.handlePivotWrite}
                            onError={e => { toast.error(e.message); cell.scheduleRefresh() }}
                            onContextMenu={cell.handlePivotContextMenu}
                            onDrill={run.handleDrill}
                            storageKey={tab.server && tab.cube ? `hg::${tab.server}::${tab.cube}::${tab.viewName || 'adhoc'}` : undefined}
                            appearance={app}
                        />
                    </GridErrorBoundary>
                </div>
            ) : !pivot.parsed || pivot.parsed.grid.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No data returned</div>
            ) : (
                <div ref={flatRootRef} className={cn('flex flex-col flex-1 min-h-0', cn(app.settings.headerTint && 'grid-wrap-accent', app.settings.headerBold && 'grid-wrap-bold'))} style={app.wrapperStyle}>
                    <GridToolbar
                        apiRef={flatGridRef}
                        scopeRef={flatRootRef}
                        onFit={() => flatGridRef.current?.api?.autoSizeAllColumns?.()}
                        onReset={flat.handleFlatResetWidths}
                        onSearch={flat.handleFlatSearch}
                        frozen={flat.flatFreezeTop}
                        onToggleFreeze={() => flat.setFlatFreezeTop(f => !f)}
                        showCsv
                        onCsv={flat.handleFlatExportCSV}
                        appearance={app}
                    />
                    <div className="flex-1 min-h-0">
                        <AgGridReact
                            ref={flatGridRef}
                            theme={app.makeTheme(dark)}
                            columnDefs={flat.colDefs}
                            rowData={pivot.rowData}
                            quickFilterText={flat.flatQuickFilter || undefined}
                            suppressMovableColumns
                            enableCellTextSelection
                            defaultColDef={{ sortable: true }}
                            onColumnResized={flat.onFlatColumnResized}
                            onFirstDataRendered={p => { if (!Object.keys(flatSavedWidthsRef.current).length) p.api.autoSizeAllColumns() }}
                            onCellContextMenu={cell.handleCellContextMenu}
                        />
                    </div>
                </div>
            )}
        </div>
        {cell.showLog && (
            <TransactionLogPanel
                server={tab.server}
                cube={tab.cube}
                cubeDims={cubeDims}
                tupleFilter={cell.logTuple}
                onClearFilter={() => cell.setLogTuple(null)}
                onClose={() => { cell.setShowLog(false); cell.setLogTuple(null) }}
            />
        )}
        {cell.cellCtx && (
            <CellContextMenu
                ctx={cell.cellCtx}
                onClose={() => cell.setCellCtx(null)}
                onTrace={(ctx) => { trace.setTraceCtx({ ...ctx, cubeDims }); cell.setCellCtx(null) }}
            />
        )}
        {trace.traceCtx && (
            <TraceSidePanel
                key={`${trace.traceCtx.server}:${trace.traceCtx.cube}:${(trace.traceCtx.dimElemPairs ?? []).map(p => `${p.dim}=${p.element}`).join('|')}`}
                ctx={trace.traceCtx}
                initialStack={traceRef.current?.ctx === trace.traceCtx ? traceRef.current?.stack : null}
                onStackChange={st => { if (traceRef.current) traceRef.current.stack = st }}
                onClose={() => trace.setTraceCtx(null)}
            />
        )}
        </div>
    )
}
