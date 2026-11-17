import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { tupleIsLeaf } from '@shared/pivot/tree.js'
import { useWriteCell } from '@/hooks/useApi'

// Typing a value, the cell right-click menu, the transaction log filter and
// the quiet-period refresh after a write.
export default function useCellWrite({ tab, cubeDims, axes, hierarchies, columnHierarchies, hierarchyData, handleExecute }) {
    const writeCell = useWriteCell()
    const [showLog,   setShowLog]   = useState(false)
    const [logTuple,  setLogTuple]  = useState(null)   // null = whole cube, array = filtered cell
    const [cellCtx,  setCellCtx]  = useState(null)

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
        await writeCell.mutateAsync({ server: tab.server, cube: tab.cube, dims: cubeDims.map(dim => ({ dim, element: coordMap.get(dim) })), value })
        toast.success('Written')
        scheduleRefresh()
    }, [coordsOf, cubeDims, tab.server, tab.cube, scheduleRefresh, writeCell])

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

    return {
        showLog, setShowLog, logTuple, setLogTuple, cellCtx, setCellCtx,
        scheduleRefresh, handlePivotWrite, handlePivotContextMenu, handleCellContextMenu,
    }
}
