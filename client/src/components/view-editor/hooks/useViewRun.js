import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { buildMDX, widenPlacement } from '@shared/pivot/mdx.js'
import entryKey from '@/components/view-editor/axes/entry-key.js'
import { parseMdxToAxes } from '@/lib/view-editor/parse-mdx.js'

// Executing the view (visual builder or MDX), auto-execute after a change,
// drill-down beyond the view, and the MDX text kept in step with the builder.
export default function useViewRun({ tab, layout, mdx, resultState, executeMDX, rulesVersion }) {
    const { axes, suppressZeros, setSuppressZeros, benchSlicers } = layout
    const { mode, mdx: mdxText, setMdx, setMdxDirty } = mdx
    const { result, setResult, setTruncated } = resultState
    const { setAxes } = layout

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
        const query = mode === 'mdx' ? mdxText : buildMDX({ cube: tab.cube, ...effAxes, bench: benchSlicers, suppressZeros: sz })
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
    }, [mode, mdxText, effAxes, benchSlicers, suppressZeros, tab.server, tab.cube])

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
            if (mdxText.trim()) {
                const parsed = parseMdxToAxes(mdxText)
                if (parsed.rows.length || parsed.columns.length || parsed.pages.length) {
                    setAxes(parsed)
                }
            }
        }
        prevModeRef.current = mode
    }, [mode, mdxText, parseMdxToAxes])

    const isExecuting = executeMDX.isPending

    return { drills, drillRun, rowNames, effAxes, handleDrill, handleExecute, autoExecuted, isExecuting }
}
