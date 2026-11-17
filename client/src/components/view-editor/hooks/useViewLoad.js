import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { buildMDX } from '@shared/pivot/mdx.js'
import { detectComplexMDX } from '@/lib/view-editor/complex-mdx.js'
import { parseMdxToAxes } from '@/lib/view-editor/parse-mdx.js'

// Loading an existing view (or seeding the default layout for a new cube
// view) and the view-type / complexity facts that come with it.
export default function useViewLoad({ tab, cubeDims, layout, mdx, source, resultState, patchTab, loadViewAxes }) {
    const { axes, setAxes, setSuppressZeros } = layout
    const { setMdx, setMode, setMdxDirty } = mdx
    const { setResult, setTruncated } = resultState
    // Loading guard using state (not ref) to survive StrictMode remounts
    const [loadedKey, setLoadedKey] = useState(null)

    // View type + native/complexity tracking
    const [viewType,          setViewType]          = useState(null)
    const [isOriginallyNative, setIsOriginallyNative] = useState(false)
    const [mdxTooComplex,      setMdxTooComplex]      = useState(null)  // null | string[]

    // ── Load existing view ──────────────────────────────────────────────────
    useEffect(() => {
        if (!tab.viewName || !cubeDims.length) return
        // Wait for the cheap source-view check before fetching the cellset. A
        // source view is previewed from the first records instead.
        if (!source.sourceOverride && (source.loadingSourceUsage || source.sourceProcesses.length)) return
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
    }, [tab.viewName, cubeDims, parseMdxToAxes, source.loadingSourceUsage, source.sourceProcesses, source.sourceOverride])

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

    return { loadedKey, viewType, isOriginallyNative, mdxTooComplex }
}
