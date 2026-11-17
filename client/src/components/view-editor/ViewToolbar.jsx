import { useStore } from '@/store'
import { buildMDX } from '@shared/pivot/mdx.js'
import { viewerAxesToBuilderConfig } from '@/lib/view-editor/complex-mdx.js'
import { cn } from '@/lib/utils'
import { viewTabId } from '@/lib/tab-ids'
import { MapPin, Eye, Code2, Braces, Clock, Check, Save, History, Table2, ZapOff, Rows3, Columns3, Zap, ChevronDown, RefreshCw, Loader2, HelpCircle } from 'lucide-react'

// The View editor toolbar: mode toggle, sessions, log, flat/suppress/totals,
// load-view picker, save menu and execute.
export default function ViewToolbar({
    tab, views, layout, mdxState, save, run, load, flat, cell,
    isLoadingView, setShowHelp, showSaveMenu, setShowSaveMenu,
}) {
    const { openTab } = useStore()
    const { axes, benchSlicers, suppressZeros, totalsPosition, setTotalsPosition, colTotalsPosition, setColTotalsPosition } = layout
    const {
        mode, setMode, setMdx, mdxDirty,
        sessionsOpen, setSessionsOpen, sessionName, setSessionName,
        sessions, sessionSavedIndicator, handleSaveSession, handleLoadSession,
    } = mdxState
    const { viewType, mdxTooComplex } = load
    const { handleExecute, isExecuting } = run
    const { showLog, setShowLog } = cell
    const { flatMode, setFlatMode } = flat
    const { handleSave, handleSaveAs, handleSaveAsNative, handleSetDefault } = save

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
            <span className="text-xs font-mono text-muted-foreground truncate">
                {tab.cube}
                {tab.viewName && <>
                    <span className="mx-1 text-muted-foreground/40">/</span>
                    <span className="text-foreground">{tab.viewName}</span>
                </>}
                {viewType && (
                    <span className="ml-1.5 text-[10px] px-1 py-px rounded border border-border text-muted-foreground bg-muted">
                        {viewType.includes('NativeView') ? 'Native' : 'MDX'}
                    </span>
                )}
            </span>

            <button
                onClick={() => {
                    const { setRevealTarget } = useStore.getState()
                    if (tab.viewName) {
                        setRevealTarget({ type: 'view', server: tab.server, cube: tab.cube, viewName: tab.viewName })
                    } else {
                        setRevealTarget({ type: 'cube', server: tab.server, cube: tab.cube })
                    }
                }}
                className="p-1 rounded hover:bg-muted text-amber-400 hover:text-amber-300 transition-colors"
                title="Show in tree"
            >
                <MapPin size={11} />
            </button>

            {/* Mode toggle */}
            <div className="flex items-center gap-0.5 bg-muted rounded p-0.5">
                <button
                    onClick={() => !mdxTooComplex && setMode('visual')}
                    disabled={!!mdxTooComplex}
                    title={mdxTooComplex
                        ? `Visual mode unavailable — MDX uses: ${mdxTooComplex.join(', ')}. Replace these with named subsets to enable.`
                        : undefined}
                    className={cn('flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors',
                        mode === 'visual' ? 'bg-background text-foreground shadow-sm'
                        : mdxTooComplex  ? 'text-muted-foreground/40 cursor-not-allowed'
                        : 'text-muted-foreground hover:text-foreground')}>
                    <Eye size={10} /> Visual
                </button>
                <button onClick={() => {
                    if (mode === 'visual') setMdx(buildMDX({ cube: tab.cube, ...axes, bench: benchSlicers, suppressZeros }))
                    setMode('mdx')
                }}
                    className={cn('flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors',
                        mode === 'mdx' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                    <Code2 size={10} /> MDX
                </button>
            </div>

            <button
                onClick={() => {
                    openTab({
                        id:           `guidedmdxview:${tab.server}:${tab.cube}:${Date.now()}`,
                        type:         'guidedmdxview',
                        label:        `Builder — ${tab.cube}`,
                        server:       tab.server,
                        cube:         tab.cube,
                        initialState: {
                            selectedCube: tab.cube,
                            dimConfig:    viewerAxesToBuilderConfig(axes),
                            step:         1,
                        },
                    })
                }}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Open in Guided MDX Builder"
            >
                <Braces size={10} /> Builder
            </button>

            {/* Saved sessions — named local drafts for experimenting */}
            <div className="relative">
                <button onClick={() => setSessionsOpen(o => !o)}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Saved sessions — local drafts, not saved to TM1">
                    <Clock size={10} /> Sessions
                </button>
                {sessionsOpen && (
                    <div className="absolute top-full left-0 mt-1 bg-popover border border-border rounded shadow-lg z-50 w-64 py-1">
                        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
                            <input value={sessionName} onChange={e => setSessionName(e.target.value)} placeholder="Session name…"
                                className="flex-1 text-xs px-1.5 py-0.5 border rounded bg-background outline-none"
                                onKeyDown={e => e.key === 'Enter' && handleSaveSession()} />
                            <button onClick={handleSaveSession} disabled={!sessionName.trim()}
                                className="px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1">
                                {sessionSavedIndicator ? <Check size={10} /> : <Save size={10} />}
                            </button>
                        </div>
                        {sessions.length === 0
                            ? <div className="px-3 py-2 text-xs text-muted-foreground">No saved sessions</div>
                            : sessions.map((s, i) => (
                                <button key={i} onClick={() => handleLoadSession(s)}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center justify-between">
                                    <span className="font-mono truncate flex-1 mr-2">{s.name}</span>
                                    <span className="text-muted-foreground/60 shrink-0 text-[10px]">{new Date(s.time).toLocaleDateString()}</span>
                                </button>
                            ))
                        }
                    </div>
                )}
            </div>

            <button
                onClick={() => setShowLog(v => !v)}
                title="Transaction log — see who changed what and when"
                className={cn(
                    'flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border transition-colors',
                    showLog
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
            >
                <History size={10} /> Log
            </button>

            <div className="flex-1" />

            <button onClick={() => setFlatMode(v => !v)}
                title={flatMode
                    ? 'Flat grid with sort-by-column — back to hierarchy view'
                    : 'Flat grid with sort-by-column (click column headers to sort)'}
                className={cn('flex items-center justify-center px-2 py-1.5 rounded border border-border text-[10px] transition-colors',
                    flatMode ? 'text-primary bg-primary/10 border-primary/40' : 'text-muted-foreground hover:bg-muted')}>
                <Table2 size={12} className="mr-1" /> Flat
            </button>

            <button onClick={() => {
                    const modes = ['none', 'rows', 'columns', 'all']
                    const idx = modes.indexOf(suppressZeros)
                    const next = modes[(idx + 1) % modes.length]
                    handleExecute({ suppressZeros: next })
                }}
                title={suppressZeros === 'none' ? 'Suppression off' : suppressZeros === 'rows' ? 'Suppress empty rows' : suppressZeros === 'columns' ? 'Suppress empty columns' : 'Suppress empty rows & columns'}
                className={cn('flex items-center justify-center p-1.5 rounded border border-border transition-colors',
                    suppressZeros === 'none' ? 'text-muted-foreground hover:bg-muted' : 'text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/30 border-emerald-400/40')}>
                {suppressZeros === 'none' ? <ZapOff size={12} /> : suppressZeros === 'rows' ? <Rows3 size={12} /> : suppressZeros === 'columns' ? <Columns3 size={12} /> : <Zap size={12} />}
            </button>

            <button onClick={() => setTotalsPosition(v => v === 'top' ? 'bottom' : 'top')}
                title={totalsPosition === 'bottom' ? 'Row totals at bottom' : 'Row totals at top'}
                className={cn('flex items-center justify-center px-2 py-1.5 rounded border border-border text-[10px] font-mono transition-colors',
                    totalsPosition === 'bottom' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted')}>
                {totalsPosition === 'bottom' ? '∑↓' : '∑↑'}
            </button>

            <button onClick={() => setColTotalsPosition(v => v === 'top' ? 'bottom' : 'top')}
                title={colTotalsPosition === 'bottom' ? 'Col totals at right' : 'Col totals at left'}
                className={cn('flex items-center justify-center px-2 py-1.5 rounded border border-border text-[10px] font-mono transition-colors',
                    colTotalsPosition === 'bottom' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted')}>
                {colTotalsPosition === 'bottom' ? '∑→' : '∑←'}
            </button>

            {views.length > 0 && !tab.viewName && (
                <select defaultValue=""
                    onChange={e => {
                        const v = e.target.value
                        if (!v) return
                        openTab({
                            id:       viewTabId(tab.server, tab.cube, v),
                            type:     'cubeview',
                            label:    `⊞ ${tab.cube} / ${v}`,
                            server:   tab.server,
                            cube:     tab.cube,
                            viewName: v,
                        })
                    }}
                    disabled={isLoadingView}
                    className="text-xs px-2 py-0.5 rounded border border-border bg-background text-muted-foreground">
                    <option value="">Load view…</option>
                    {views.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
            )}

            <div className="relative">
                <div className="flex items-center">
                    <button onClick={handleSave}
                        disabled={tab.viewName && mode === 'mdx' && !mdxDirty}
                        title="Save (Ctrl+S)"
                        className={cn('flex items-center gap-1 px-2 py-1 rounded-l text-xs border border-r-0 transition-colors',
                            !tab.viewName || (mode === 'mdx' && mdxDirty) || mode === 'visual'
                                ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                                : 'border-border text-muted-foreground hover:bg-muted')}>
                        <Save size={11} /> {tab.viewName ? 'Save' : 'Save As'}
                    </button>
                    <button onClick={() => setShowSaveMenu(v => !v)}
                        title="Save options"
                        className={cn('flex items-center px-1 py-1 rounded-r text-xs border transition-colors',
                            !tab.viewName || (mode === 'mdx' && mdxDirty) || mode === 'visual'
                                ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                                : 'border-border text-muted-foreground hover:bg-muted')}>
                        <ChevronDown size={10} />
                    </button>
                </div>
                {showSaveMenu && (
                    <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded shadow-lg py-1 w-44" onMouseLeave={() => setShowSaveMenu(false)}>
                        {mode === 'mdx' && (
                            <button onClick={() => { handleSaveAsNative(); setShowSaveMenu(false) }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors">
                                Save as Native view
                            </button>
                        )}
                        <button onClick={() => { handleSaveAs(); setShowSaveMenu(false) }}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors">
                            Save As… (new name)
                        </button>
                        {tab.viewName && (
                            <button onClick={() => { handleSetDefault(); setShowSaveMenu(false) }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors border-t border-border mt-1 pt-1.5">
                                Save as Default View
                            </button>
                        )}
                    </div>
                )}
            </div>

            <button onClick={handleExecute} disabled={isExecuting || isLoadingView}
                title="Execute / Refresh (Ctrl+Enter)"
                className="flex items-center justify-center p-1.5 rounded text-emerald-500 hover:bg-muted transition-colors disabled:opacity-40">
                {isExecuting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
            <button onClick={() => setShowHelp(true)}
                title="Help — View Editor"
                className="flex items-center justify-center p-1.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <HelpCircle size={12} />
            </button>
        </div>
    )
}
