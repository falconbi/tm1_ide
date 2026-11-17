import { useMemo } from 'react'
import { useElementsTrees, useMultiFormatAttrs } from '@/hooks/useApi'
import { buildHierarchy } from '@shared/pivot/tree.js'
import { cellsetToPivot } from '@shared/pivot/cellset.js'
import { cellsetToHierarchyData, parseCellset, buildGridData } from '@/lib/view-cellset'

// Everything derived from the executed cellset for the grids: aliased display
// members, formats, hierarchy trees and pivot/flat data. No effects.
export default function useViewPivotData({ tab, cubeDims, axes, dimAliases, aliasValueMaps, suppressZeros, app, gridResult }) {
    const displayResult = useMemo(() => {
        if (!gridResult?.Axes || !Object.values(dimAliases).some(Boolean)) return gridResult
        const resultAxes = gridResult.Axes.map(axis => ({
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
        return { ...gridResult, Axes: resultAxes }
    }, [gridResult, dimAliases, aliasValueMaps])
    const allAxesDims = useMemo(() => [...new Set([...axes.columns, ...axes.rows, ...axes.pages].map(d => d.dimension))], [axes.columns, axes.rows, axes.pages])
    const { data: formatAttrs = {} } = useMultiFormatAttrs(tab.server, allAxesDims)
    const pageMembers = useMemo(() => axes.pages.map(p => p.member).filter(Boolean), [axes.pages])
    const parsed = useMemo(() => {
        return displayResult ? parseCellset(displayResult, formatAttrs, pageMembers, app.settings.numFormat) : null
    }, [displayResult, formatAttrs, allAxesDims, pageMembers, app.settings.numFormat])
    const { colDefs: baseFlatColDefs, rowData } = useMemo(() => buildGridData(parsed), [parsed])

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

    return {
        displayResult, formatAttrs, pageMembers, parsed,
        baseFlatColDefs, rowData,
        rowDims, colDims,
        hierarchies, columnHierarchies, hierarchyData, pivotData,
    }
}
