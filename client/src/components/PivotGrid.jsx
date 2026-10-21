/**
 * PivotGrid — the IDE's wrapper around the shared pivot (shared/pivot/grid.js),
 * the same grid Lenses use (Lens.pivot). The IDE adds its toolbar (search,
 * freeze top row, fit, reset widths, CSV, appearance) and its appearance
 * settings; typing writes each cell straight away (onWrite).
 *
 * Props:
 *   pivot            { columns, rows, data } from cellsetToPivot
 *   rowHierarchies   [hierarchy] per row dimension (shared/pivot/tree.js buildHierarchy); null → flat
 *   colHierarchies   the same for columns
 *   rowNames         header text per row dimension
 *   totals, colTotals  'top' | 'bottom'
 *   onWrite(change) → Promise   write one typed cell ({ tuple, members, value, old }); omit = read-only
 *   onError(e), onContextMenu({ tuple, members, cell, event })
 *   storageKey       remembers column widths; a new key = a new grid
 *   dark, appearance (useGridAppearance instance shared with the View editor)
 */
import { useEffect, useRef, useState } from 'react'
import { createPivotGrid } from '@shared/pivot/grid.js'
import GridToolbar from './GridToolbar'
import { useGridAppearance } from '@/lib/grid-appearance'
import { cn } from '@/lib/utils'

export default function PivotGrid({
    pivot, rowHierarchies, colHierarchies, rowNames,
    totals = 'top', colTotals = 'top',
    onWrite, onError, onContextMenu,
    storageKey, dark = false, appearance,
}) {
    const hostRef  = useRef(null)
    const gridRef  = useRef(null)
    const apiRef   = useRef({ api: null })
    const own      = useGridAppearance()
    const app      = appearance ?? own
    const [frozen, setFrozen] = useState(false)
    // the latest callbacks, without re-creating the grid when they change
    const cb = useRef({})
    useEffect(() => { cb.current = { onWrite, onError, onContextMenu } })

    // one grid per view (storageKey); later data goes in through setPivot
    useEffect(() => {
        const g = createPivotGrid(hostRef.current, {
            pivot, rowHierarchies, colHierarchies, rowNames, totals, colTotals, dark,
            edit: onWrite ? 'immediate' : false,
            onWrite: w => cb.current.onWrite?.(w),
            onError: e => cb.current.onError?.(e),
            onContextMenu: info => cb.current.onContextMenu?.(info),
            storageKey, height: '100%', fit: 'content',
            makeTheme: h => app.makeTheme(dark, h),
        })
        gridRef.current = g
        apiRef.current = { api: g.api }
        return () => { g.destroy(); gridRef.current = null; apiRef.current = { api: null } }
    }, [storageKey]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { gridRef.current?.setPivot(pivot, rowHierarchies, colHierarchies) }, [pivot, rowHierarchies, colHierarchies])

    useEffect(() => {
        gridRef.current?.setOptions({ totals, colTotals, dark, rowNames, makeTheme: h => app.makeTheme(dark, h) })
    }, [totals, colTotals, dark, rowNames, app.refreshKey, app.settings.zebra]) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className={cn('flex flex-col h-full min-h-0', app.settings.headerTint && 'grid-wrap-accent', app.settings.headerBold && 'grid-wrap-bold')} style={app.wrapperStyle}>
            <GridToolbar
                apiRef={apiRef}
                onFit={() => gridRef.current?.fitColumns()}
                onReset={() => gridRef.current?.resetWidths()}
                onSearch={text => { gridRef.current?.quickFilter(text); if (text) setFrozen(false) }}
                frozen={frozen}
                onToggleFreeze={() => { const next = !frozen; setFrozen(next); gridRef.current?.freezeTop(next) }}
                showCsv
                onCsv={() => gridRef.current?.exportCsv()}
                appearance={app}
            />
            <div className="flex-1 min-h-0">
                <div ref={hostRef} style={{ height: '100%' }} />
            </div>
        </div>
    )
}
