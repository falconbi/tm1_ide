import { get, post } from '@/lib/api'
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { subsetApplyCallbacks } from '@/lib/subsetCallbacks'
import { useCubeDimensions, useElementsTrees, useHierarchiesFor, useViews, useExecuteMDX, useViewAxes, useSaveView, useSetDefaultView, usePawBookUsage, useViewUsage, useViewSourceUsage, useMultiFormatAttrs, useConflictCheck, useGenerateViewMDX, useConfig } from '@/hooks/useApi'
import { toast } from 'sonner'
import { RefreshCw, Loader2, Table2, GripVertical, GripHorizontal, LayoutGrid, Rows3, Columns3, Filter, ZapOff, Zap, Save, Code2, Eye, ChevronDown, BookOpen, ChevronUp, MapPin, WrapText, Braces, History, AlertTriangle, Cog, FileSearch, Sparkles, Clock, Check, ArrowUpDown, HelpCircle } from 'lucide-react'
import HelpPanel from '@/components/HelpPanel'
import TransactionLogPanel from '@/components/TransactionLogPanel'
import CellContextMenu from '@/components/CellContextMenu'
import SourceViewPreview from '@/components/view-editor/SourceViewPreview.jsx'
import DropZone from '@/components/view-editor/axes/DropZone.jsx'
import entryKey from '@/components/view-editor/axes/entry-key.js'
import TraceSidePanel from '@/components/view-editor/trace/TraceSidePanel.jsx'
import { cn } from '@/lib/utils'
import { formatMDX } from '@/lib/mdx-format'
import { viewTabId, processTabId } from '@/lib/tab-ids'
import { useGridAppearance } from '@/lib/grid-appearance'
import { cellsetToHierarchyData, parseCellset, buildGridData } from '@/lib/view-cellset'

ModuleRegistry.registerModules([AllCommunityModule])

import { buildMDX, widenPlacement } from '@shared/pivot/mdx.js'
import PivotGrid from '@/components/PivotGrid'
import { buildHierarchy, tupleIsLeaf } from '@shared/pivot/tree.js'
import { cellsetToPivot } from '@shared/pivot/cellset.js'
import GridToolbar from '@/components/GridToolbar'
import { ConflictBanner, ConflictSaveWarning } from '@/components/ConflictBanner'
import DiffViewerModal from '@/components/DiffViewerModal'
import { Component } from 'react'
import { loadViewSessions, saveViewSessionEntry } from '@/lib/view-editor/view-sessions.js'
import { detectComplexMDX, viewerAxesToBuilderConfig } from '@/lib/view-editor/complex-mdx.js'

const BIG_VIEW_ROWS = 5000

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
    const saveView     = useSaveView()
    const setDefault   = useSetDefaultView()
    const generateViewMDX = useGenerateViewMDX()

    // Visual builder state — seed from Builder handoff if provided
    // Use savedAxes to survive tab-switch remounts
    const [axes, setAxes] = useState(tab.savedAxes ?? tab.initialAxes ?? { rows: [], columns: [], pages: [] })
    const [benchState, setBenchState] = useState({}) // persists member/subset for benched dims
    const [suppressZeros, setSuppressZeros] = useState('rows')
    const [totalsPosition,    setTotalsPosition]    = useState('top')
    const [colTotalsPosition, setColTotalsPosition] = useState('top')
    const [activeDrag, setActiveDrag] = useState(null)
    const [showHelp, setShowHelp] = useState(false)

    // Flat (fallback) grid state — search + freeze + persisted widths
    const flatGridRef = useRef(null)
    const flatRootRef = useRef(null)
    const flatStorageKey = tab.server && tab.cube ? `ve-flat::${tab.server}::${tab.cube}::${tab.viewName || 'adhoc'}` : undefined
    const [flatQuickFilter, setFlatQuickFilter] = useState('')
    const [flatFreezeTop, setFlatFreezeTop] = useState(false)
    const [flatMode, setFlatMode] = useState(false)
    const flatSavedWidthsRef = useRef(null)
    if (flatSavedWidthsRef.current === null) {
        flatSavedWidthsRef.current = flatStorageKey
            ? (() => { try { return JSON.parse(localStorage.getItem(flatStorageKey) || '{}') } catch { return {} } })()
            : {}
    }
    const handleFlatSearch = useCallback((text) => {
        setFlatQuickFilter(text)
        if (text) setFlatFreezeTop(false)
    }, [])

    // Save axes to tab store on unmount so tab-switch preserves changes
    const axesRef = useRef(axes); axesRef.current = axes
    useEffect(() => () => patchTab(tab.id, { savedAxes: axesRef.current }), [])

    // Totals position — per-user IDE preference (classic native views have no
    // "totals position" property, so this can't ride on the TM1 view itself)
    const totalsPrefKey = `tm1-viewprefs:${tab.server}::${tab.cube}::${tab.viewName ?? '__new__'}`
    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(totalsPrefKey) ?? '{}')
            if (saved.totalsPosition)    setTotalsPosition(saved.totalsPosition)
            if (saved.colTotalsPosition) setColTotalsPosition(saved.colTotalsPosition)
        } catch { /* prefs absent/corrupt — defaults stand */ }
    }, [totalsPrefKey])
    useEffect(() => {
        try { localStorage.setItem(totalsPrefKey, JSON.stringify({ totalsPosition, colTotalsPosition })) } catch { /* storage denied — view prefs just don't persist */ }
    }, [totalsPrefKey, totalsPosition, colTotalsPosition])

    // MDX editor state — use savedMdx to survive remounts
    const [mdx, setMdx] = useState(tab.savedMdx ?? tab.initialMdx ?? '')
    const mdxRef = useRef(mdx); mdxRef.current = mdx
    useEffect(() => () => patchTab(tab.id, { savedMdx: mdxRef.current }), [])
    const [mdxDirty, setMdxDirty] = useState(false)

    // AI generate — front door for building a view from a description
    const { data: config } = useConfig()
    const hasAI = !!config?.hasAI
    const [aiPrompt, setAiPrompt] = useState('')
    const handleGenerateAI = useCallback(() => {
        if (!aiPrompt.trim() || generateViewMDX.isPending) return
        generateViewMDX.mutate({ server: tab.server, cube: tab.cube, prompt: aiPrompt }, {
            onSuccess: d => {
                setMdx(d.mdx)
                setMode('mdx')
                setMdxDirty(true)
                toast.success('MDX generated — review, then Save')
            },
            onError: e => toast.error(e.message),
        })
    }, [aiPrompt, generateViewMDX, tab.server, tab.cube])

    // Saved sessions — named local drafts, for experimenting before settling
    // on the final view. State here; handlers live below once `mode` exists.
    const [sessionsOpen, setSessionsOpen]     = useState(false)
    const [sessionName, setSessionName]       = useState('')
    const [sessions, setSessions]             = useState(loadViewSessions)
    const [sessionSavedIndicator, setSessionSavedIndicator] = useState(false)

    const [dimAliases, setDimAliases]         = useState({})
    const [aliasValueMaps, setAliasValueMaps] = useState({})
    const handleAliasChange = useCallback(async (dim, attr) => {
        setDimAliases(prev => ({ ...prev, [dim]: attr || null }))
        if (!attr) return
        const key = `${dim}:${attr}`
        if (aliasValueMaps[key]) return
        try {
            const map = await get(`/api/dimension/alias-values?server=${encodeURIComponent(tab.server)}&dimension=${encodeURIComponent(dim)}&alias=${encodeURIComponent(attr)}`)
            setAliasValueMaps(prev => ({ ...prev, [key]: map }))
        } catch { /* alias fetch failed — alias display just stays plain */ }
    }, [tab.server, aliasValueMaps])

    const [mdxEditorHeight, setMdxEditorHeight] = useState(224)
    const startMdxEditorResize = useCallback((e) => {
        e.preventDefault()
        const startY = e.clientY
        const startH = mdxEditorHeight
        const onMove = (mv) => setMdxEditorHeight(Math.max(80, Math.min(startH + (mv.clientY - startY), 600)))
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }, [mdxEditorHeight])
    const editorRef = useRef(null)

    // Results
    const [result, setResult] = useState(null)
    const [truncated, setTruncated] = useState(false)

    // View type + native/complexity tracking
    const [viewType,          setViewType]          = useState(null)
    const [isOriginallyNative, setIsOriginallyNative] = useState(false)
    const [mdxTooComplex,      setMdxTooComplex]      = useState(null)  // null | string[]

    // View mode: 'visual' | 'mdx'
    const [mode, setMode] = useState(tab.mode ?? (tab.initialMdx ? 'mdx' : 'visual'))
    const [showSaveMenu, setShowSaveMenu] = useState(false)
    const [builderCollapsed, setBuilderCollapsed] = useState(false)
    useEffect(() => { patchTab(tab.id, { mode }) }, [mode])

    // Saved-session handlers — captures whatever's current (visual axes or MDX,
    // whichever mode you're in) so restoring puts you back exactly where you left off.
    const handleSaveSession = useCallback(() => {
        if (!sessionName.trim()) return
        saveViewSessionEntry({ name: sessionName.trim(), cube: tab.cube, mode, mdx, axes })
        setSessions(loadViewSessions())
        setSessionSavedIndicator(true)
        setTimeout(() => setSessionSavedIndicator(false), 2000)
        setSessionName('')
    }, [sessionName, tab.cube, mode, mdx, axes])
    const handleLoadSession = useCallback((s) => {
        if (s.axes) setAxes(s.axes)
        if (s.mdx != null) setMdx(s.mdx)
        setMode(s.mode ?? 'visual')
        setSessionsOpen(false)
        toast.success(`Loaded "${s.name}"`)
    }, [])

    // Used In panel
    const [showUsedIn, setShowUsedIn] = useState(false)

    // Transaction Log panel
    const [showLog,   setShowLog]   = useState(false)
    const [logTuple,  setLogTuple]  = useState(null)   // null = whole cube, array = filtered cell
    const [dismissedId, setDismissedId]   = useState(null)
    const [saveConflict, setSaveConflict] = useState(null)
    const [conflictDiff, setConflictDiff] = useState(null)
    const [cellCtx,  setCellCtx]  = useState(null)
    const [traceCtx, setTraceCtx] = useState(() => tab.savedTrace?.ctx ?? null)
    // the open trace and its drill path survive a tab switch (saved onto the tab when the editor unmounts)
    const traceRef = useRef(tab.savedTrace ?? null)
    useEffect(() => { traceRef.current = traceCtx ? { ctx: traceCtx, stack: traceRef.current?.ctx === traceCtx ? traceRef.current.stack : null } : null }, [traceCtx])
    useEffect(() => () => patchTab(tab.id, { savedTrace: traceRef.current }), [])  // eslint-disable-line
    const { openConflict, checkBeforeSave } = useConflictCheck(tab.server, 'view', tab.viewName)
    const { data: pawBookData, isFetching: loadingPawBooks, refetch: refetchPawBooks } = usePawBookUsage(tab.server, tab.cube, tab.viewName)
    const { data: usageData,   isFetching: loadingUsage,   refetch: refetchUsage }    = useViewUsage(tab.server, tab.cube, tab.viewName)
    const { data: sourceUsage, isLoading: loadingSourceUsage } = useViewSourceUsage(tab.server, tab.cube, tab.viewName)
    const [sourceOverride, setSourceOverride] = useState(false)
    const sourceProcesses = sourceUsage?.processes ?? []
    const sourceMode = !!tab.viewName && sourceProcesses.length > 0 && !sourceOverride

    const refetchUsedIn = useCallback(() => { refetchUsage(); refetchPawBooks() }, [refetchUsage, refetchPawBooks])
    const loadingUsedIn = loadingUsage || loadingPawBooks

    // Loading guard using state (not ref) to survive StrictMode remounts
    const [loadedKey, setLoadedKey] = useState(null)

    const cubeHierQs = useHierarchiesFor(tab.server, cubeDims)
    const cubeHierStamp = cubeHierQs.map(q => q.dataUpdatedAt).join()
    const altEntries = useMemo(() => cubeDims.flatMap((d, i) => (cubeHierQs[i]?.data ?? [])
        .filter(h => h !== d && h !== 'Leaves').map(h => ({ dimension: d, hierarchy: h }))),
        [cubeDims, cubeHierStamp]) // eslint-disable-line react-hooks/exhaustive-deps
    const bench = useMemo(() => {
        const placed = new Set([...axes.rows, ...axes.columns, ...axes.pages].map(entryKey))
        const mains = cubeDims.filter(d => !placed.has(d)).map(d => ({
            dimension: d,
            ...(benchState[d] ?? { subset: null, member: null }),
        }))
        const alts = altEntries.filter(a => !placed.has(entryKey(a))).map(a => ({ ...a, alt: true, ...(benchState[entryKey(a)] ?? {}) }))
        return [...mains, ...alts]
    }, [cubeDims, axes, benchState, altEntries])
    // what goes into WHERE: the main hierarchies left on the bench (an ALT H there is only on offer)
    const benchSlicers = useMemo(() => bench.filter(b => !b.alt), [bench])

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

    // ── Parse MDX string to visual builder axes ───────────────────────────────
    const parseMdxToAxes = useCallback((mdxText) => {
        const make = (dim, subset = null, member = null) => ({ dimension: dim, subset, member })
        const cols = [], rows = [], pages = []

        // Extract axes part between SELECT and FROM
        const axisMatch = mdxText.match(/SELECT\s+([\s\S]*?)\s+FROM\s+\[/i)
        if (axisMatch) {
            const axesPart = axisMatch[1]

            // Find ordinal positions to split axes without overlap
            const colPos = axesPart.search(/\bON\s+(?:COLUMNS|0)\b/i)
            const rowPos = axesPart.search(/\bON\s+(?:ROWS|1)\b/i)

            let colExpr = null, rowExpr = null
            if (colPos >= 0 && rowPos >= 0) {
                if (colPos < rowPos) {
                    colExpr = axesPart.slice(0, colPos).replace(/,\s*$/, '').trim()
                    const afterCol = axesPart.indexOf(',', colPos)
                    rowExpr = axesPart.slice(afterCol + 1, rowPos).trim()
                } else {
                    rowExpr = axesPart.slice(0, rowPos).replace(/,\s*$/, '').trim()
                    const afterRow = axesPart.indexOf(',', rowPos)
                    colExpr = axesPart.slice(afterRow + 1, colPos).trim()
                }
            } else if (colPos >= 0) {
                colExpr = axesPart.slice(0, colPos).trim()
            } else if (rowPos >= 0) {
                rowExpr = axesPart.slice(0, rowPos).trim()
            }

            const extractSets = (expr) => {
                if (!expr) return []
                const sets = []
                let m
                // TM1SubsetToSet([Dim].[Hier], "Sub") or TM1SubsetToSet([Dim], "Sub")
                const subsetRe = /TM1SubsetToSet\s*\(\s*\[([^\]]+)\](?:\.[^\]]*\])?\s*,\s*"([^"]+)"(?:\s*,\s*"[^"]*")?\s*\)/gi
                while ((m = subsetRe.exec(expr)) !== null) sets.push(make(m[1], m[2]))
                // TM1SUBSETALL([Dim].[Hier])
                const allRe = /TM1SUBSETALL\s*\(\s*\[([^\]]+)\](?:\.[^\]]*\])?\s*\)/gi
                while ((m = allRe.exec(expr)) !== null) sets.push(make(m[1]))
                // [Dim].[Dim].Members or MEMBERS
                const membersRe = /\[([^\]]+)\]\.[^\]]*\]\.Members/gi
                while ((m = membersRe.exec(expr)) !== null) {
                    if (!sets.some(s => s.dimension === m[1])) sets.push(make(m[1]))
                }
                // {[Dim].[Dim].[M1], [Dim].[Dim].[M2], ...} — multi-member set
                const multiRe = /\{\s*(\[[^\]]+\]\.\[[^\]]+\]\.\[[^\]]+\](?:\s*,\s*\[[^\]]+\]\.\[[^\]]+\]\.\[[^\]]+\])*)\s*\}/gi
                while ((m = multiRe.exec(expr)) !== null) {
                    const memberMatches = [...m[1].matchAll(/\[([^\]]+)\]\.\[[^\]]+\]\.\[([^\]]+)\]/g)]
                    if (memberMatches.length > 0) {
                        const dim = memberMatches[0][1]
                        if (!sets.some(s => s.dimension === dim)) {
                            const members = memberMatches.map(mm => mm[2])
                            sets.push(members.length === 1
                                ? make(dim, null, members[0])
                                : { ...make(dim), members })
                        }
                    }
                }
                return sets
            }

            if (colExpr) cols.push(...extractSets(colExpr))
            if (rowExpr) rows.push(...extractSets(rowExpr))
        }

        // Extract WHERE slicers
        const whereMatch = mdxText.match(/WHERE\s*\(([\s\S]*?)\)\s*$/i)
        if (whereMatch) {
            for (const s of whereMatch[1].split(',')) {
                const trimmed = s.trim()
                // [Dim].[Hier].[Member] — specific member
                const m = trimmed.match(/\[([^\]]+)\]\.[^\]]*\]\.\[([^\]]+)\]/)
                if (m) { pages.push(make(m[1], null, m[2])); continue }
                // [Dim].[Hier].DefaultMember — placeholder slicer, keep dim in filter zone with no member
                const dm = trimmed.match(/\[([^\]]+)\]\.[^\]]*\]\.DefaultMember/i)
                if (dm) pages.push(make(dm[1]))
            }
        }

        return { columns: cols, rows, pages }
    }, [])

    // ── Load existing view ──────────────────────────────────────────────────
    useEffect(() => {
        if (!tab.viewName || !cubeDims.length) return
        // Wait for the cheap source-view check before fetching the cellset. A
        // source view is previewed from the first records instead.
        if (!sourceOverride && (loadingSourceUsage || sourceProcesses.length)) return
        const key = `${tab.server}:${tab.cube}:${tab.viewName}`
        if (loadedKey === key) return
        setLoadedKey(key)
        setResult(null)
        setTruncated(false)

        loadViewAxes.mutate(
            { server: tab.server, cube: tab.cube, view: tab.viewName },
            {
                onSuccess: ({ axisConfig, cellset, viewType: vt, nativeConfig, mdx: viewMdx }) => {
                    const make = (dim, subset = null, member = null, members = null, memberSet = null) => ({ dimension: dim, subset, member, members, memberSet })
                    let cols, rows, pages

                    if (viewMdx && vt?.includes('MDXView')) {
                        // MDX view — axis PLACEMENT comes from the executed cellset (axisConfig),
                        // which the server derives correctly for any MDX. parseMdxToAxes is only
                        // best-effort enrichment (member lists / named subsets) and is skipped
                        // per-axis when it can't resolve the dims the cellset actually returned.
                        const parsed = parseMdxToAxes(viewMdx)
                        const cfgDims = ord => (axisConfig.find(a => a.ordinal === ord)?.dimensions ?? [])
                        const enrich  = (parsedAxis, ord) => {
                            const dims = cfgDims(ord)
                            if (!dims.length) return parsedAxis
                            return dims.map(d => parsedAxis.find(p => p.dimension === d) ?? make(d))
                        }
                        cols  = enrich(parsed.columns, 0)
                        rows  = enrich(parsed.rows, 1)
                        pages = parsed.pages.length
                            ? parsed.pages
                            : (axisConfig.find(a => a.ordinal === 2)?.selectedMembers ?? []).map(({ dimension, member }) => make(dimension, null, member))
                    } else if (nativeConfig) {
                        // Native view — use native definition with actual subsets
                        cols  = nativeConfig.columns.map(c => make(c.dimension, c.subset, null, c.members ?? null, c.memberSet ?? null))
                        rows  = nativeConfig.rows.map(r => make(r.dimension, r.subset, null, r.members ?? null, r.memberSet ?? null))
                        pages = nativeConfig.titles.map(t => make(t.dimension, null, t.member))
                        // Restore persisted suppression (real SuppressEmptyRows/Columns on the native view)
                        setSuppressZeros(
                            nativeConfig.suppressEmptyRows && nativeConfig.suppressEmptyColumns ? 'all'
                            : nativeConfig.suppressEmptyRows    ? 'rows'
                            : nativeConfig.suppressEmptyColumns ? 'columns'
                            : 'none'
                        )
                    } else {
                        // Fallback to cellset axes
                        cols  = (axisConfig.find(a => a.ordinal === 0)?.dimensions ?? []).map(d => make(d))
                        rows  = (axisConfig.find(a => a.ordinal === 1)?.dimensions ?? []).map(d => make(d))
                        pages = (axisConfig.find(a => a.ordinal === 2)?.selectedMembers ?? []).map(({ dimension, member }) => make(dimension, null, member))
                    }
                    if (!cols.length && cubeDims.length) cols = [make(cubeDims[0])]
                    if (!rows.length && cubeDims.length > 1) rows = [make(cubeDims[1])]
                    setAxes({ rows, columns: cols, pages })
                    setResult(cellset)
                    setTruncated(cellset?.truncated ?? false)
                    setViewType(vt ?? null)
                    patchTab(tab.id, { viewType: vt ?? null })
                    const isNative = vt?.includes('NativeView') ?? false
                    const complex  = viewMdx ? detectComplexMDX(viewMdx) : null
                    setIsOriginallyNative(isNative)
                    setMdxTooComplex(complex)
                    // Lock to MDX mode when complex expressions are present
                    if (viewMdx && (complex || vt?.includes('MDXView'))) setMode('mdx')
                    setMdx(viewMdx || buildMDX({ cube: tab.cube, rows, columns: cols, pages, suppressZeros: 'none' }))
                    setMdxDirty(false)
                },
                onError: e => {
                    setLoadedKey(null)
                    if (tab.viewName !== 'Default') toast.error(e.message)
                },
            }
        )
    }, [tab.viewName, cubeDims, parseMdxToAxes, loadingSourceUsage, sourceProcesses, sourceOverride])

    // ── Default layout for new cube view (no viewName) ──────────────────────
    useEffect(() => {
        if (tab.viewName || !cubeDims.length || axes.columns.length || axes.rows.length) return
        const make = dim => ({ dimension: dim, subset: null, member: null })
        setAxes({
            columns: cubeDims.slice(0, 1).map(make),
            rows:    cubeDims.slice(1, 2).map(make),
            pages:   [],
        })
    }, [cubeDims])

    const findZone = (dimName) => {
        for (const zone of ['rows', 'columns', 'pages']) {
            if (axes[zone].find(d => entryKey(d) === dimName)) return zone
        }
        return 'bench'
    }

    const reorderDim = useCallback((zone, fromIdx, toIdx) => {
        setAxes(prev => {
            const arr = [...prev[zone]]
            const [item] = arr.splice(fromIdx, 1)
            arr.splice(toIdx, 0, item)
            return { ...prev, [zone]: arr }
        })
    }, [])

    const handleDragEnd = ({ active, over }) => {
        setActiveDrag(null)
        if (!over) return
        const dimName = active.id
        const overId  = over.id
        if (overId === `dim:${dimName}`) return

        let toZone, insertBeforeDim = null
        if (overId.startsWith('dim:')) {
            insertBeforeDim = overId.slice(4)
            toZone = findZone(insertBeforeDim)
        } else {
            if (!['rows', 'columns', 'pages', 'bench'].includes(overId)) return
            toZone = overId
        }

        let existing = [...axes.rows, ...axes.columns, ...axes.pages, ...bench]
            .find(d => entryKey(d) === dimName) ?? { dimension: dimName, subset: null, member: null }

        // Moving to Filter with nothing chosen: keep the first member it was showing (a filter left on
        // TM1's default member — e.g. a measure dimension's — leaves the grid blank)
        if (toZone === 'pages' && !existing.member) {
            const from = ['rows', 'columns'].find(z => axes[z].some(d => entryKey(d) === dimName))
            const shown = from && result?.Axes?.[from === 'columns' ? 0 : 1]?.Tuples?.[0]?.Members?.[axes[from].findIndex(d => entryKey(d) === dimName)]?.Name
            const first = existing.members?.[0] ?? shown
            if (first) existing = { ...existing, member: first, members: null, subset: null, memberSet: null }
        }

        if (toZone === 'bench') {
            // Preserve member/subset so it's remembered if moved back
            setBenchState(prev => ({ ...prev, [dimName]: { subset: existing.subset ?? null, member: existing.member ?? null, members: existing.members ?? null, memberSet: existing.memberSet ?? null } }))
            setAxes(prev => ({
                rows:    prev.rows.filter(d => entryKey(d) !== dimName),
                columns: prev.columns.filter(d => entryKey(d) !== dimName),
                pages:   prev.pages.filter(d => entryKey(d) !== dimName),
            }))
            return
        }

        // Moving to an active zone — clear saved bench state for this dim
        setBenchState(prev => { const n = { ...prev }; delete n[dimName]; return n })
        setAxes(prev => {
            const next = {
                rows:    prev.rows.filter(d => entryKey(d) !== dimName),
                columns: prev.columns.filter(d => entryKey(d) !== dimName),
                pages:   prev.pages.filter(d => entryKey(d) !== dimName),
            }
            if (insertBeforeDim) {
                const idx = next[toZone].findIndex(d => entryKey(d) === insertBeforeDim)
                next[toZone] = idx >= 0
                    ? [...next[toZone].slice(0, idx), existing, ...next[toZone].slice(idx)]
                    : [...next[toZone], existing]
            } else {
                next[toZone] = [...next[toZone], existing]
            }
            return next
        })
    }

    const removeDim = useCallback((dimName) => {
        setAxes(prev => ({
            rows:    prev.rows.filter(d => entryKey(d) !== dimName),
            columns: prev.columns.filter(d => entryKey(d) !== dimName),
            pages:   prev.pages.filter(d => entryKey(d) !== dimName),
        }))
    }, [])

    const setSubset = useCallback((dimName, subset) => {
        setAxes(prev => {
            const update = zone => zone.map(d => entryKey(d) === dimName ? { ...d, subset, member: null, members: null, memberSet: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const setMember = useCallback((dimName, member) => {
        setAxes(prev => {
            const update = zone => zone.map(d => entryKey(d) === dimName ? { ...d, member, members: null, memberSet: null, subset: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const setMembers = useCallback((dimName, members) => {
        setAxes(prev => {
            const update = zone => zone.map(d => entryKey(d) === dimName ? { ...d, members, member: null, subset: null, memberSet: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const setHierarchy = useCallback((dimName, hierarchy) => {
        setAxes(prev => {
            const update = zone => zone.map(d => entryKey(d) === dimName
                ? { ...d, hierarchy: hierarchy && hierarchy !== d.dimension ? hierarchy : undefined, subset: null, member: null, members: null, memberSet: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const setMemberSet = useCallback((dimName, memberSet) => {
        setAxes(prev => {
            const update = zone => zone.map(d => entryKey(d) === dimName ? { ...d, memberSet, subset: null, member: null, members: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const setCustomExpr = useCallback((dimName, customExpr) => {
        setAxes(prev => {
            const update = zone => zone.map(d => d.dimension === dimName ? { ...d, customExpr, subset: null, member: null, members: null, memberSet: null } : d)
            return { rows: update(prev.rows), columns: update(prev.columns), pages: update(prev.pages) }
        })
    }, [])

    const handleBuildSubset = useCallback((dimName) => {
        const tabId = `subset-filter:${tab.server}:${dimName}:${Date.now()}`
        const existing = [...axes.rows, ...axes.columns, ...axes.pages].find(d => d.dimension === dimName)
        subsetApplyCallbacks.set(tabId, (mdxExpr) => setCustomExpr(dimName, mdxExpr))
        openTab({ id: tabId, type: 'subset', label: `Build: ${dimName}`, server: tab.server, dimension: dimName, subsetName: null, mdx: existing?.customExpr ?? '', returnTabId: tab.id })
    }, [tab.server, tab.id, axes, openTab, setCustomExpr])

    // ── drill-down beyond the view (the grid's onDrill) ─────────────────────
    // Each step widens one row / column dimension's set: a total's children, everything below it,
    // its leaves instead of it, only it, or without it. View-only until saved (then as an MDX view);
    // cleared whenever the layout changes.
    const [drills, setDrills] = useState({})          // { 'rows|Dim': [{ scope, member, members }] }
    const [drillRun, setDrillRun] = useState(0)
    useEffect(() => { setDrills({}) }, [axes])
    // the grid's row headings — the same array until the rows change, so a redraw doesn't reset the grid
    const rowNames = useMemo(() => axes.rows.map(entryKey), [axes.rows])
    const effAxes = useMemo(() => {
        if (!Object.keys(drills).length) return axes
        const widen = (zone, list) => list.map(p => widenPlacement(p, drills[`${zone}|${entryKey(p)}`]))
        return { ...axes, rows: widen('rows', axes.rows), columns: widen('columns', axes.columns) }
    }, [axes, drills])
    const handleDrill = useCallback(({ axis, dimIdx, member, members, scope, count }) => {
        if (mode !== 'visual') { toast.info('Opening a total beyond the view works in the builder — switch from MDX to Visual'); return }
        const zone = axis === 'cols' ? 'columns' : 'rows'
        const p = axes[zone][dimIdx]; if (!p) return
        if (count > 2000 && !window.confirm(`This adds about ${count.toLocaleString()} ${zone === 'rows' ? 'rows' : 'columns'}. Continue?`)) return
        const key = `${zone}|${entryKey(p)}`
        setDrills(prev => ({ ...prev, [key]: [...(prev[key] ?? []), { scope, member, members }] }))
        setDrillRun(n => n + 1)
    }, [mode, axes])

    const handleExecute = useCallback((opts = {}) => {
        const sz    = 'suppressZeros' in opts ? opts.suppressZeros : suppressZeros
        const query = mode === 'mdx' ? mdx : buildMDX({ cube: tab.cube, ...effAxes, bench: benchSlicers, suppressZeros: sz })
        if (!query.trim()) {
            toast.error('No MDX to execute')
            return
        }
        const id = toast.loading('Executing…')
        executeMDX.mutate(
            { server: tab.server, mdx: query },
            {
                onSuccess: data => {
                    setResult(data)
                    setTruncated(data?.truncated ?? false)
                    if ('suppressZeros' in opts) setSuppressZeros(sz)
                    toast.success('Done', { id })
                },
                onError:   e    => toast.error(e.message, { id }),
            }
        )
    }, [mode, mdx, effAxes, benchSlicers, suppressZeros, tab.server, tab.cube])

    // run again once a drill step is in
    useEffect(() => { if (drillRun) handleExecute() }, [drillRun]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Auto-execute default layout once ────────────────────────────────────
    const [autoExecuted, setAutoExecuted] = useState(false)
    useEffect(() => {
        if (tab.viewName || autoExecuted || !axes.columns.length || result !== null) return
        setAutoExecuted(true)
        handleExecute()
    }, [axes, autoExecuted, tab.viewName, result, handleExecute])

    // Sync MDX when visual axes change (if in visual mode)
    const isFirstAxesRender = useRef(true)
    useEffect(() => {
        if (mode !== 'visual') return
        setMdx(buildMDX({ cube: tab.cube, ...axes, bench: benchSlicers, suppressZeros }))
        setMdxDirty(false)

        // Auto-execute after axes settle (skip initial mount)
        if (isFirstAxesRender.current) { isFirstAxesRender.current = false; return }
        if (!axes.columns.length && !axes.rows.length) return
        const t = setTimeout(() => handleExecute(), 800)
        return () => clearTimeout(t)
    }, [axes, mode])

    // Auto-refresh when rules for this cube are saved
    const prevRulesVersion = useRef(rulesVersion)
    useEffect(() => {
        if (rulesVersion === prevRulesVersion.current) return
        prevRulesVersion.current = rulesVersion
        if (result !== null) handleExecute()
    }, [rulesVersion])

    // When switching to MDX mode, mark dirty so save is enabled
    const prevModeRef = useRef(mode)
    useEffect(() => {
        if (prevModeRef.current === 'visual' && mode === 'mdx') {
            setMdxDirty(true)
        } else if (prevModeRef.current === 'mdx' && mode === 'visual') {
            // Sync visual axes from whatever is currently in the MDX editor
            if (mdx.trim()) {
                const parsed = parseMdxToAxes(mdx)
                if (parsed.rows.length || parsed.columns.length || parsed.pages.length) {
                    setAxes(parsed)
                }
            }
        }
        prevModeRef.current = mode
    }, [mode, mdx, parseMdxToAxes])

    const buildSavePayload = useCallback(() => {
        const usesAltH = [...axes.rows, ...axes.columns, ...axes.pages].some(d => d.hierarchy && d.hierarchy !== d.dimension)
        const drilled = Object.keys(drills).length > 0
        if (mode === 'visual' && (usesAltH || drilled)) {
            toast.info(drilled ? 'Saved as an MDX view, with what you opened' : 'This view uses an ALT H, so it is saved as an MDX view')
            return { mdx: buildMDX({ cube: tab.cube, ...effAxes, bench: benchSlicers, suppressZeros }) }
        }
        if (mode === 'visual') {
            return { nativeAxes: {
                rows: axes.rows, columns: axes.columns, titles: axes.pages,
                suppressEmptyRows:    suppressZeros === 'rows'    || suppressZeros === 'all',
                suppressEmptyColumns: suppressZeros === 'columns' || suppressZeros === 'all',
            } }
        }
        return { mdx: mdx }
    }, [mode, mdx, axes, effAxes, drills, suppressZeros, benchSlicers, tab.cube])

    const executeSave = useCallback((name) => {
        if (isOriginallyNative && mode === 'mdx') {
            if (!window.confirm('Saving in MDX mode will convert this Native view to MDX. This affects PAX and Architect users.\n\nContinue?')) return
        }
        const id = toast.loading('Saving view…')
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name, ...buildSavePayload() },
            {
                onSuccess: () => { setMdxDirty(false); toast.success(`Saved "${name}"`, { id }) },
                onError:   e => toast.error(e.message, { id }),
            }
        )
    }, [isOriginallyNative, mode, buildSavePayload, tab.server, tab.cube, saveView])

    const handleSave = useCallback(async () => {
        const name = tab.viewName ?? prompt('View name?')
        if (!name) return
        if (tab.viewName) {
            const conflict = await checkBeforeSave()
            if (conflict) { setSaveConflict(conflict); return }
        }
        executeSave(name)
    }, [tab.viewName, checkBeforeSave, executeSave])

    const handleSaveAsNative = useCallback(() => {
        const name = prompt('Save as native view…')
        if (!name) return
        const parsed = parseMdxToAxes(mdx)
        if (!parsed.columns.length && !parsed.rows.length) { toast.error('Could not parse MDX axes — switch to Visual mode and arrange dimensions first'); return }
        const id = toast.loading('Saving as Native…')
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name, nativeAxes: { rows: parsed.rows, columns: parsed.columns, titles: parsed.pages } },
            {
                onSuccess: () => { setMdxDirty(false); toast.success(`Saved "${name}" as Native`, { id }) },
                onError:   e => toast.error(e.message, { id }),
            }
        )
    }, [mdx, parseMdxToAxes, tab.server, tab.cube, tab.viewName, saveView])

    const handleSaveAs = useCallback(() => {
        const currentName = tab.viewName || ''
        const suggested = currentName ? currentName.replace(/\s*\(default\)\s*$/i, '') : ''
        const name = prompt('Save view as…', suggested)
        if (!name) return
        const exists = views.some(v => v.name === name && name !== tab.viewName)
        if (exists && !window.confirm(`View "${name}" already exists. Overwrite?`)) return
        const id = toast.loading(`Saving "${name}"…`)
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name, ...buildSavePayload() },
            {
                onSuccess: () => {
                    setMdxDirty(false)
                    toast.success(`Saved "${name}"`, { id })
                    openTab({
                        id:       viewTabId(tab.server, tab.cube, name),
                        type:     'cubeview',
                        label:    `⊞ ${tab.cube} / ${name}`,
                        server:   tab.server,
                        cube:     tab.cube,
                        viewName: name,
                    })
                },
                onError: e => toast.error(e.message, { id }),
            }
        )
    }, [buildSavePayload, tab.server, tab.cube, tab.viewName, openTab, views])

    const handleSetDefault = useCallback(() => {
        if (!window.confirm(`Overwrite the default view for [${tab.cube}]?\n\nThis will save the current layout as "Default".`)) return
        const id = toast.loading('Setting as default…')
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name: 'Default', ...buildSavePayload() },
            {
                onSuccess: () => {
                    setDefault.mutate(
                        { server: tab.server, cube: tab.cube, name: 'Default' },
                        {
                            onSuccess: () => { toast.success('Default view saved', { id }) },
                            onError:   e => toast.error(e.message, { id }),
                        }
                    )
                },
                onError: e => toast.error(e.message, { id }),
            }
        )
    }, [tab.server, tab.cube, buildSavePayload, saveView, setDefault])

    // Keyboard shortcuts (work globally in both visual + MDX modes)
    useEffect(() => {
        const onKey = (e) => {
            const ctrl = e.ctrlKey || e.metaKey
            if (!ctrl) return
            if (e.key === 'Enter') {
                e.preventDefault()
                handleExecute()
            }
            if (e.key.toLowerCase() === 's') {
                if (e.shiftKey) {
                    e.preventDefault()
                    handleSaveAs()
                } else if (tab.viewName) {
                    e.preventDefault()
                    handleSave()
                }
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [handleExecute, handleSave, handleSaveAs, tab.viewName])

    // A view with tens of thousands of rows (e.g. a TI source view) froze the browser while the grid was
    // built; past BIG_VIEW_ROWS the grid waits until the user asks for it.
    const resultRows  = result?.Axes?.find?.(a => a.Ordinal === 1)?.Tuples?.length ?? result?.Axes?.[1]?.Tuples?.length ?? 0
    const [bigConfirmed, setBigConfirmed] = useState(null)
    const tooBig      = resultRows > BIG_VIEW_ROWS && bigConfirmed !== result
    const gridResult  = tooBig ? null : result

    const displayResult = useMemo(() => {
        if (!gridResult?.Axes || !Object.values(dimAliases).some(Boolean)) return gridResult
        const axes = result.Axes.map(axis => ({
            ...axis,
            Tuples: axis.Tuples.map(tuple => ({
                ...tuple,
                Members: tuple.Members.map(m => {
                    const dim = m.UniqueName?.match(/^\[([^\]]+)\]/)?.[1]
                    const attr = dim ? dimAliases[dim] : null
                    if (!attr) return m
                    const v = aliasValueMaps[`${dim}:${attr}`]?.[m.Name]
                    return v ? { ...m, Name: v } : m
                })
            }))
        }))
        return { ...gridResult, Axes: axes }
    }, [gridResult, dimAliases, aliasValueMaps])
    const allAxesDims = useMemo(() => [...new Set([...axes.columns, ...axes.rows, ...axes.pages].map(d => d.dimension))], [axes.columns, axes.rows, axes.pages])
    const { data: formatAttrs = {} } = useMultiFormatAttrs(tab.server, allAxesDims)
    const pageMembers = useMemo(() => axes.pages.map(p => p.member).filter(Boolean), [axes.pages])
    const parsed = useMemo(() => {
        return displayResult ? parseCellset(displayResult, formatAttrs, pageMembers, app.settings.numFormat) : null
    }, [displayResult, formatAttrs, allAxesDims, pageMembers, app.settings.numFormat])
    const { colDefs: baseFlatColDefs, rowData } = useMemo(() => buildGridData(parsed), [parsed])

    // Apply persisted widths to the flat fallback grid
    const colDefs = useMemo(() => {
        const savedWidths = flatStorageKey
            ? (() => { try { return JSON.parse(localStorage.getItem(flatStorageKey) || '{}') } catch { return {} } })()
            : {}
        return baseFlatColDefs.map(cd => {
            const saved = savedWidths[cd.field]
            return saved ? { ...cd, width: saved } : cd
        })
    }, [baseFlatColDefs, flatStorageKey])

    const persistFlatWidths = useCallback(() => {
        if (!flatStorageKey) return
        try { localStorage.setItem(flatStorageKey, JSON.stringify(flatSavedWidthsRef.current)) } catch { /* ignore */ }
    }, [flatStorageKey])

    const onFlatColumnResized = useCallback((e) => {
        if (!e.finished || !e.column) return
        flatSavedWidthsRef.current[e.column.getColId()] = e.column.getActualWidth()
        persistFlatWidths()
    }, [persistFlatWidths])

    const handleFlatResetWidths = useCallback(() => {
        flatSavedWidthsRef.current = {}
        if (flatStorageKey) { try { localStorage.removeItem(flatStorageKey) } catch { /* ignore */ } }
        flatGridRef.current?.api?.resetColumnWidths?.()
        flatGridRef.current?.api?.autoSizeAllColumns?.()
    }, [flatStorageKey])

    const handleFlatExportCSV = useCallback(() => {
        flatGridRef.current?.api?.exportDataAsCsv?.()
    }, [])

    // Freeze top — set via the grid API (not a React prop) to avoid AG Grid's
    // re-render crash (issue #10278 / AG-14590). setTimeout defers past the
    // "cannot draw rows while drawing" render stage.
    useEffect(() => {
        const api = flatGridRef.current?.api
        if (!api) return
        const t = setTimeout(() => {
            api.setGridOption('pinnedTopRowData', flatFreezeTop && rowData.length ? [{ ...rowData[0] }] : null)
        }, 0)
        return () => clearTimeout(t)
    }, [flatFreezeTop, rowData])

    // Re-apply visual appearance settings (zebra, row height, font size) — AG
    // Grid doesn't redraw rows when these change.
    useEffect(() => {
        const api = flatGridRef.current?.api
        if (!api) return
        const t = setTimeout(() => {
            api.redrawRows()
            api.refreshHeader?.()
        }, 0)
        return () => clearTimeout(t)
    }, [app.refreshKey])

    // ── Pivot grid data (shared pivot — shared/pivot) ─────────────────────────
    const rowDims = useMemo(() => axes.rows.map(d => d.dimension),    [axes.rows])
    const colDims = useMemo(() => axes.columns.map(d => d.dimension), [axes.columns])

    // element trees for every dimension on rows / columns (any number of them)
    const rowTreeQs = useElementsTrees(tab.server, axes.rows.map(d => ({ dim: d.dimension, hierarchy: d.hierarchy })))
    const colTreeQs = useElementsTrees(tab.server, axes.columns.map(d => ({ dim: d.dimension, hierarchy: d.hierarchy })))
    const rowTreesKey = rowTreeQs.map(q => q.dataUpdatedAt).join()
    const colTreesKey = colTreeQs.map(q => q.dataUpdatedAt).join()

    // a tree per dimension (null = not loaded → the grid lists that dimension flat), with aliases as labels
    const withAlias = (h, dim) => {
        const attr = h && dimAliases[dim]; const map = attr && aliasValueMaps[`${dim}:${attr}`]
        if (!map) return h
        return { ...h, nodes: Object.fromEntries(Object.entries(h.nodes).map(([id, n]) => [id, { ...n, label: map[id] ?? n.label ?? id }])) }
    }
    const hierarchies = useMemo(() =>
        rowDims.map((dim, i) => withAlias(buildHierarchy(rowTreeQs[i]?.data ?? [], dim), dim)),
    [rowDims, rowTreesKey, dimAliases, aliasValueMaps]) // eslint-disable-line react-hooks/exhaustive-deps
    const columnHierarchies = useMemo(() =>
        colDims.map((dim, i) => withAlias(buildHierarchy(colTreeQs[i]?.data ?? [], dim), dim)),
    [colDims, colTreesKey, dimAliases, aliasValueMaps]) // eslint-disable-line react-hooks/exhaustive-deps

    const hierarchyData = useMemo(() => cellsetToHierarchyData(gridResult, formatAttrs, pageMembers, suppressZeros, app.settings.numFormat), [gridResult, formatAttrs, pageMembers, suppressZeros, app.settings.numFormat])

    // the cellset as pivot data: real value + display + kind per cell
    const pivotData = useMemo(() => gridResult ? cellsetToPivot(gridResult, { formatMap: formatAttrs, pageMembers, suppressZeros, useFormat: app.settings.numFormat, measureDimension: cubeDims[cubeDims.length - 1] }) : null,
        [gridResult, formatAttrs, pageMembers, suppressZeros, app.settings.numFormat, cubeDims])

    // after typing, refresh the view once things go quiet (totals and rules recalculate) —
    // not after every cell; the grid keeps its drill-down across the refresh
    const refreshTimer = useRef(null)
    useEffect(() => () => clearTimeout(refreshTimer.current), [])
    const scheduleRefresh = useCallback(() => {
        clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => handleExecute(), 900)
    }, [handleExecute])

    const coordsOf = useCallback((tuple, members) => new Map([
        ...axes.rows.map((d, i) => [d.dimension, tuple[i]]),
        ...axes.columns.map((d, i) => [d.dimension, members[i]]),
        ...axes.pages.filter(p => p.member).map(p => [p.dimension, p.member]),
    ].filter(([, e]) => e != null)), [axes])

    // a typed cell → TM1, straight away; a refusal puts the old value back in the grid
    const handlePivotWrite = useCallback(async ({ tuple, members, value }) => {
        const coordMap = coordsOf(tuple, members)
        const missing  = cubeDims.filter(d => !coordMap.has(d))
        if (missing.length) throw new Error(`Cannot write — move all dimensions to an axis: ${missing.join(', ')}`)
        await post('/api/cells/write', { server: tab.server, cube: tab.cube, dims: cubeDims.map(dim => ({ dim, element: coordMap.get(dim) })), value })
        toast.success('Written')
        scheduleRefresh()
    }, [coordsOf, cubeDims, tab.server, tab.cube, scheduleRefresh])

    const handlePivotContextMenu = useCallback(({ tuple, members, cell, event }) => {
        event?.preventDefault?.()
        const coordMap = coordsOf(tuple, members)
        const dimElemPairs = cubeDims.map(d => ({ dim: d, element: coordMap.get(d) })).filter(p => p.element)
        if (!dimElemPairs.length) return
        setCellCtx({
            x: event?.clientX ?? 400,
            y: event?.clientY ?? 200,
            dimElemPairs,
            value: cell?.d ?? cell?.v ?? null,
            isAllLeaf: tupleIsLeaf(tuple, hierarchies) && tupleIsLeaf(members, columnHierarchies),
            cube: tab.cube,
            server: tab.server,
        })
        if (showLog) setLogTuple(cubeDims.map(d => coordMap.get(d) ?? null))
    }, [coordsOf, cubeDims, hierarchies, columnHierarchies, tab.cube, tab.server, showLog])

    const useHierarchy  = !flatMode && !!(rowDims.length > 0 && pivotData && result)

    const handleCellContextMenu = useCallback((e) => {
        e.event?.preventDefault?.()
        const tupleKey   = e.data?.__tupleKey__
        const colId      = e.colDef?.field
        const rowMembers = (tupleKey ?? '').split('::')
        const rowCoords  = axes.rows.map((d, i) => ({ dim: d.dimension, element: rowMembers[i] }))
        const col        = hierarchyData?.columns?.find(c => c.id === colId)
        const colMembers = col?.members ?? (col?.label ? [col.label] : [])
        const colCoords  = axes.columns.map((d, i) => ({ dim: d.dimension, element: colMembers[i] }))
        const pageCoords = axes.pages.filter(p => p.member).map(p => ({ dim: p.dimension, element: p.member }))
        const coordMap   = new Map([...rowCoords, ...colCoords, ...pageCoords].map(c => [c.dim, c.element]))
        const dimElemPairs = cubeDims.map(d => ({ dim: d, element: coordMap.get(d) })).filter(p => p.element)
        if (!dimElemPairs.length) return
        const isAllLeaf = axes.rows.every((_, i) => e.data?.[`__d${i}_isLeaf__`] ?? true)
        setCellCtx({
            x: e.event?.clientX ?? 400,
            y: e.event?.clientY ?? 200,
            dimElemPairs,
            value: e.data?.[colId],
            isAllLeaf,
            cube: tab.cube,
            server: tab.server,
        })
        if (showLog) setLogTuple(cubeDims.map(d => coordMap.get(d) ?? null))
    }, [axes, hierarchyData, cubeDims, tab.cube, tab.server, showLog])

    const allDims = useMemo(() => [...axes.rows, ...axes.columns, ...axes.pages, ...bench], [axes, bench])
    const usedKeys = useMemo(() => new Set([...axes.rows, ...axes.columns, ...axes.pages].map(entryKey)), [axes])
    const activeDim = activeDrag ? allDims.find(d => entryKey(d) === activeDrag) : null

    const isLoadingView = loadViewAxes.isPending
    const isExecuting   = executeMDX.isPending

    if (sourceMode) {
        return (
            <SourceViewPreview
                key={`${tab.server}:${tab.cube}:${tab.viewName}`}
                server={tab.server}
                cube={tab.cube}
                view={tab.viewName}
                processes={sourceProcesses}
                onOpenFull={() => setSourceOverride(true)}
            />
        )
    }

    return (
        <div className="flex h-full min-h-0">
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <ConflictBanner conflict={openConflict?.id !== dismissedId ? openConflict : null} onDismiss={() => setDismissedId(openConflict?.id)} />
            <ConflictSaveWarning
              conflict={saveConflict}
              onSaveAnyway={() => { setSaveConflict(null); executeSave(tab.viewName) }}
              onCancel={() => setSaveConflict(null)}
              onShowDiff={() => {
                const payload = buildSavePayload()
                setConflictDiff({
                  object_type: 'view',
                  object_name: tab.viewName,
                  detail:      tab.cube,
                  timestamp:   saveConflict.timestamp,
                  action:      'CONFLICT',
                  session_name: null,
                  before_state: saveConflict.after_state ?? (payload.nativeAxes ? { type: 'native', definition: payload.nativeAxes } : { type: 'mdx', mdx: payload.mdx ?? '' }),
                  after_state:  payload.nativeAxes ? { type: 'native', definition: payload.nativeAxes } : { type: 'mdx', mdx: payload.mdx ?? '' },
                })
              }}
            />
            {conflictDiff && <DiffViewerModal entry={conflictDiff} onClose={() => setConflictDiff(null)} />}
            {/* Toolbar */}
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
                        const { openTab } = useStore.getState()
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
            <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="view" />

            {/* AI bar — front door for building this view */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/10 shrink-0">
                <Sparkles size={11} className={cn('shrink-0', hasAI ? 'text-violet-400' : 'text-muted-foreground/40')} />
                {hasAI ? (
                    <>
                        <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleGenerateAI()}
                            placeholder="Describe the view you want…"
                            className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/40" />
                        <button onClick={handleGenerateAI} disabled={!aiPrompt.trim() || generateViewMDX.isPending}
                            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-violet-700 text-white disabled:opacity-40 hover:bg-violet-600 transition-colors shrink-0">
                            {generateViewMDX.isPending ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} Generate
                        </button>
                    </>
                ) : (
                    <span className="flex-1 text-xs text-muted-foreground/40 italic">AI not configured — set AI_PROVIDER in .env</span>
                )}
            </div>

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

            {/* Used In */}
            {tab.viewName && (
                <div className="shrink-0 border-b border-border">
                    <button
                        onClick={() => { setShowUsedIn(v => !v); if (!showUsedIn) refetchUsedIn() }}
                        className="flex items-center gap-1.5 w-full px-3 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                    >
                        {showUsedIn ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        <FileSearch size={10} />
                        <span>Used In</span>
                        {usageData?.processes?.length > 0 && <span className="opacity-60">({usageData.processes.length})</span>}
                        {loadingUsedIn && <Loader2 size={10} className="animate-spin ml-1" />}
                    </button>
                    {showUsedIn && (
                        <div className="px-3 py-1.5 bg-muted/10 max-h-48 overflow-auto space-y-2">
                            {!usageData && !pawBookData && !loadingUsedIn && (
                                <p className="text-[10px] text-muted-foreground italic">Scanning…</p>
                            )}
                            {usageData && usageData.processes.length > 0 && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">
                                        TI Processes ({usageData.processes.length})
                                    </div>
                                    {usageData.processes.map((u, i) => (
                                        <button key={i}
                                            onClick={() => openTab({ id: processTabId(tab.server, u.process), type: 'process', label: u.process, server: tab.server, name: u.process })}
                                            className="flex items-center gap-1.5 w-full px-1 py-0.5 text-[11px] hover:bg-muted rounded text-left">
                                            <Cog size={10} className="shrink-0 text-muted-foreground" />
                                            <span className="font-mono truncate">{u.process}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">
                                    PAW Books ({pawBookData?.books.length ?? 0})
                                </div>
                                {!pawBookData ? (
                                    <p className="text-[10px] text-muted-foreground italic">Scanning…</p>
                                ) : pawBookData.books.length === 0 ? (
                                    <p className="text-[10px] text-muted-foreground italic">None found.</p>
                                ) : (
                                    <div className="space-y-0.5">
                                        {pawBookData.books.map(book => (
                                            <a key={book.id}
                                                href={`${pawBookData?.pawHost || ''}/ui?type=book&path=${encodeURIComponent(book.path)}`}
                                                target="_blank" rel="noreferrer"
                                                className="flex items-center gap-1.5 text-[10px] hover:bg-muted rounded px-1 py-0.5"
                                                title={book.path}>
                                                <BookOpen size={9} className="shrink-0 text-muted-foreground" />
                                                <span className="truncate">{book.name}</span>
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Visual builder */}
            {mode === 'visual' && (
                <div className="shrink-0 border-b border-border bg-muted/10">
                    {!builderCollapsed && (
                        <DndContext sensors={sensors} onDragStart={({ active }) => setActiveDrag(active.id)} onDragEnd={handleDragEnd}>
                            <div className="px-3 py-2 grid grid-cols-4 gap-2">
                                <DropZone id="rows"    label="Rows"    icon={Rows3}    dims={axes.rows}    server={tab.server} onRemove={removeDim} onSubsetChange={setSubset} onMemberChange={setMember} onMembersChange={setMembers} onMemberSetChange={setMemberSet} onHierarchyChange={setHierarchy} usedKeys={usedKeys} onReorder={(f,t) => reorderDim('rows',f,t)}    accent="text-muted-foreground" dimAliases={dimAliases} onAliasChange={handleAliasChange} onBuildSubset={handleBuildSubset} />
                                <DropZone id="columns" label="Columns" icon={Columns3} dims={axes.columns} server={tab.server} onRemove={removeDim} onSubsetChange={setSubset} onMemberChange={setMember} onMembersChange={setMembers} onMemberSetChange={setMemberSet} onHierarchyChange={setHierarchy} usedKeys={usedKeys} onReorder={(f,t) => reorderDim('columns',f,t)} accent="text-muted-foreground" dimAliases={dimAliases} onAliasChange={handleAliasChange} onBuildSubset={handleBuildSubset} />
                                <DropZone id="pages"   label="Filter"  icon={Filter}   dims={axes.pages}   server={tab.server} onRemove={removeDim} onSubsetChange={setSubset} onMemberChange={setMember} onMembersChange={setMembers} onHierarchyChange={setHierarchy} usedKeys={usedKeys} onReorder={(f,t) => reorderDim('pages',f,t)}   accent="text-muted-foreground" dimAliases={dimAliases} onAliasChange={handleAliasChange} onBuildSubset={handleBuildSubset} />
                                <DropZone id="bench"   label="Bench"   icon={LayoutGrid} dims={bench}      server={tab.server} onRemove={() => {}}  onSubsetChange={() => {}}  onMemberChange={() => {}}  onMembersChange={() => {}}  onReorder={() => {}}                           accent="text-muted-foreground" />
                            </div>
                            <DragOverlay>
                                {activeDim && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 rounded border text-xs bg-muted border-primary shadow-lg">
                                        <GripVertical size={11} /><span className="font-mono">{activeDim.dimension}</span>
                                    </div>
                                )}
                            </DragOverlay>
                        </DndContext>
                    )}
                    {/* Collapse / expand toggle for the whole builder row */}
                    <div className="flex items-center gap-2 px-3 py-1">
                        <button onClick={() => setBuilderCollapsed(c => !c)}
                            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors py-0.5 rounded"
                            title={builderCollapsed ? 'Expand view builder' : 'Collapse view builder'}>
                            {builderCollapsed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                            <LayoutGrid size={10} /> View builder
                        </button>
                        {builderCollapsed && (
                            <span className="text-[10px] text-muted-foreground/60 truncate">
                                Rows {axes.rows.length} · Columns {axes.columns.length} · Filter {axes.pages.length} · Bench {bench.length}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* MDX editor */}
            {mode === 'mdx' && (
                <div className="shrink-0 border-b border-border flex flex-col min-h-0" style={{ height: mdxEditorHeight }}>
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
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, handleSave)
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, handleExecute)
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
                <div onMouseDown={startMdxEditorResize}
                    className="shrink-0 h-1.5 cursor-row-resize flex items-center justify-center hover:bg-primary/20 transition-colors group"
                    title="Drag to resize editor">
                    <GripHorizontal size={12} className="text-muted-foreground/40 group-hover:text-primary/60" />
                </div>
            )}

            {/* Truncation warning */}
            {truncated && (
                <div className="shrink-0 px-3 py-1 bg-yellow-500/10 border-b border-yellow-500/30 text-yellow-600 dark:text-yellow-400 text-xs flex items-center gap-1.5">
                    <span>⚠</span>
                    <span>Result capped at 50,000 cells — add filters or subsets to narrow the view.</span>
                </div>
            )}

            {/* Flat-mode hint */}
            {flatMode && (
                <div className="shrink-0 px-3 py-1 bg-sky-500/10 border-b border-sky-500/30 text-sky-600 dark:text-sky-400 text-xs flex items-center gap-1.5">
                    <ArrowUpDown size={11} />
                    <span>Flat view — click a column header to sort. Toggle <span className="font-medium">Flat</span> off to return to the hierarchy view.</span>
                </div>
            )}

            {/* Grid */}
            {tooBig ? (
                <div className="flex-1 flex items-center justify-center text-sm select-none">
                    <div className="text-center max-w-md space-y-3 px-4">
                        <AlertTriangle size={28} className="mx-auto text-amber-500" />
                        <p className="text-foreground">This view has <span className="font-semibold">{resultRows.toLocaleString()}</span> rows.</p>
                        <p className="text-muted-foreground text-xs">Drawing that many rows can freeze the browser. Narrow it with a subset or a title member, or show it anyway.</p>
                        <button
                            onClick={() => setBigConfirmed(result)}
                            className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                            Show all {resultRows.toLocaleString()} rows
                        </button>
                    </div>
                </div>
            ) : !result ? (
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
                            pivot={pivotData}
                            rowHierarchies={hierarchies}
                            colHierarchies={columnHierarchies}
                            rowNames={rowNames}
                            dark={dark}
                            totals={totalsPosition}
                            colTotals={colTotalsPosition}
                            onWrite={handlePivotWrite}
                            onError={e => { toast.error(e.message); scheduleRefresh() }}
                            onContextMenu={handlePivotContextMenu}
                            onDrill={handleDrill}
                            storageKey={tab.server && tab.cube ? `hg::${tab.server}::${tab.cube}::${tab.viewName || 'adhoc'}` : undefined}
                            appearance={app}
                        />
                    </GridErrorBoundary>
                </div>
            ) : !parsed || parsed.grid.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No data returned</div>
            ) : (
                <div ref={flatRootRef} className={cn('flex flex-col flex-1 min-h-0', cn(app.settings.headerTint && 'grid-wrap-accent', app.settings.headerBold && 'grid-wrap-bold'))} style={app.wrapperStyle}>
                    <GridToolbar
                        apiRef={flatGridRef}
                        scopeRef={flatRootRef}
                        onFit={() => flatGridRef.current?.api?.autoSizeAllColumns?.()}
                        onReset={handleFlatResetWidths}
                        onSearch={handleFlatSearch}
                        frozen={flatFreezeTop}
                        onToggleFreeze={() => setFlatFreezeTop(f => !f)}
                        showCsv
                        onCsv={handleFlatExportCSV}
                        appearance={app}
                    />
                    <div className="flex-1 min-h-0">
                        <AgGridReact
                            ref={flatGridRef}
                            theme={app.makeTheme(dark)}
                            columnDefs={colDefs}
                            rowData={rowData}
                            quickFilterText={flatQuickFilter || undefined}
                            suppressMovableColumns
                            enableCellTextSelection
                            defaultColDef={{ sortable: true }}
                            onColumnResized={onFlatColumnResized}
                            onFirstDataRendered={p => { if (!Object.keys(flatSavedWidthsRef.current).length) p.api.autoSizeAllColumns() }}
                            onCellContextMenu={handleCellContextMenu}
                        />
                    </div>
                </div>
            )}
        </div>
        {showLog && (
            <TransactionLogPanel
                server={tab.server}
                cube={tab.cube}
                cubeDims={cubeDims}
                tupleFilter={logTuple}
                onClearFilter={() => setLogTuple(null)}
                onClose={() => { setShowLog(false); setLogTuple(null) }}
            />
        )}
        {cellCtx && (
            <CellContextMenu
                ctx={cellCtx}
                onClose={() => setCellCtx(null)}
                onTrace={(ctx) => { setTraceCtx({ ...ctx, cubeDims }); setCellCtx(null) }}
            />
        )}
        {traceCtx && (
            <TraceSidePanel
                key={`${traceCtx.server}:${traceCtx.cube}:${(traceCtx.dimElemPairs ?? []).map(p => `${p.dim}=${p.element}`).join('|')}`}
                ctx={traceCtx}
                initialStack={traceRef.current?.ctx === traceCtx ? traceRef.current?.stack : null}
                onStackChange={st => { if (traceRef.current) traceRef.current.stack = st }}
                onClose={() => setTraceCtx(null)}
            />
        )}
        </div>
    )
}