import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import { useHierarchiesFor, aliasValuesQuery } from '@/hooks/useApi'
import { subsetApplyCallbacks } from '@/lib/subsetCallbacks'
import entryKey from '@/components/view-editor/axes/entry-key.js'

// Axes, bench, suppression / totals preferences, aliases and drag/drop —
// the state behind the visual builder. The grid result is passed into
// handleDragEnd at call time because the drag itself, not the layout, needs it.
export default function useViewLayout({ tab, cubeDims, patchTab, openTab }) {
    const [axes, setAxes] = useState(tab.savedAxes ?? tab.initialAxes ?? { rows: [], columns: [], pages: [] })
    const [benchState, setBenchState] = useState({}) // persists member/subset for benched dims
    const [suppressZeros, setSuppressZeros] = useState('rows')
    const [totalsPosition,    setTotalsPosition]    = useState('top')
    const [colTotalsPosition, setColTotalsPosition] = useState('top')
    const [activeDrag, setActiveDrag] = useState(null)
    const [builderCollapsed, setBuilderCollapsed] = useState(false)

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

    const queryClient = useQueryClient()
    const [dimAliases, setDimAliases]         = useState({})
    const [aliasValueMaps, setAliasValueMaps] = useState({})
    const handleAliasChange = useCallback(async (dim, attr) => {
        setDimAliases(prev => ({ ...prev, [dim]: attr || null }))
        if (!attr) return
        const key = `${dim}:${attr}`
        if (aliasValueMaps[key]) return
        try {
            const map = await queryClient.fetchQuery(aliasValuesQuery(tab.server, dim, attr))
            setAliasValueMaps(prev => ({ ...prev, [key]: map }))
        } catch { /* alias fetch failed — alias display just stays plain */ }
    }, [tab.server, aliasValueMaps, queryClient])

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

    const handleDragEnd = ({ active, over }, result) => {
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

    const allDims = useMemo(() => [...axes.rows, ...axes.columns, ...axes.pages, ...bench], [axes, bench])
    const usedKeys = useMemo(() => new Set([...axes.rows, ...axes.columns, ...axes.pages].map(entryKey)), [axes])
    const activeDim = activeDrag ? allDims.find(d => entryKey(d) === activeDrag) : null

    return {
        axes, setAxes,
        benchState,
        bench, benchSlicers,
        suppressZeros, setSuppressZeros,
        totalsPosition, setTotalsPosition,
        colTotalsPosition, setColTotalsPosition,
        activeDrag, setActiveDrag,
        builderCollapsed, setBuilderCollapsed,
        dimAliases, aliasValueMaps, handleAliasChange,
        sensors,
        reorderDim, handleDragEnd,
        removeDim, setSubset, setMember, setMembers, setHierarchy, setMemberSet, setCustomExpr,
        handleBuildSubset,
        allDims, usedKeys, activeDim,
    }
}
